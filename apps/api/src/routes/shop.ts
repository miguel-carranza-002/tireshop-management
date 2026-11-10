import { Router } from 'express'
import type { PoolClient } from 'pg'
import { syncQueue } from '../allocation.js'
import { pool, withTransaction, type Queryable } from '../db.js'
import { tireJobMinutes, type Settings } from '../pricing.js'
import {
  asBody,
  ConflictError,
  idParam,
  NotFoundError,
  optionalBoolean,
  optionalId,
  optionalText,
  ValidationError,
} from '../validation.js'
import { loadSettings } from './settings.js'
import { loadTicketDetail, lockWorkItem, repriceTpms, tireInfoFor, type WorkItem } from './tickets.js'

export const shopRouter = Router()
// Mounted on /api/work-items next to the editing routes.
export const workItemStatusRouter = Router()

type Queue = 'tires' | 'mechanic' | 'alignment'
const queues: Queue[] = ['tires', 'mechanic', 'alignment']

// ---------------------------------------------------------------------------
// Finishing work
// ---------------------------------------------------------------------------

async function openOrdersFor(client: PoolClient, workItemId: string) {
  const result = await client.query(
    `
      SELECT po.description, po.qty_ordered - po.qty_arrived AS missing
      FROM pending_orders po
      JOIN line_items li ON li.id = po.line_item_id
      WHERE li.work_item_id = $1 AND po.status IN ('needed', 'ordered')
    `,
    [workItemId],
  )
  return result.rows as { description: string; missing: number }[]
}

async function finishQueueEntry(client: PoolClient, workItemId: string, status: string) {
  await client.query(
    `
      UPDATE queue_entries
      SET status = $2, lift_id = NULL, finished_at = NOW()
      WHERE work_item_id = $1 AND status IN ('waiting', 'on_lift')
    `,
    [workItemId, status],
  )
}

// The work is done: take its tires and sensors out of stock, mark
// special-order items installed, and close its queue entry.
export async function completeWorkItem(client: PoolClient, workItemId: string) {
  const { ticketId, workItem } = await lockWorkItem(client, workItemId, ['work_order'], null)
  const current = await client.query('SELECT status FROM work_items WHERE id = $1', [workItemId])
  if (current.rows[0].status !== 'pending') {
    throw new ConflictError('This work is already finished')
  }

  const missing = await openOrdersFor(client, workItemId)
  if (missing.length > 0) {
    throw new ConflictError(
      `Still waiting on ${missing.map((m) => `${m.missing} × ${m.description}`).join(', ')}. ` +
        'Receive it on the Orders page, or cancel the order.',
    )
  }

  const short = await client.query(
    `
      SELECT li.description
      FROM line_items li
      LEFT JOIN reservations r ON r.line_item_id = li.id
      WHERE li.work_item_id = $1 AND li.product_id IS NOT NULL
        AND COALESCE(r.quantity, 0) < CEIL(li.quantity)
    `,
    [workItemId],
  )
  if (short.rowCount! > 0) {
    throw new ConflictError(
      `Not enough reserved for ${short.rows.map((r) => r.description).join(', ')}. Check stock before finishing.`,
    )
  }

  const used = await client.query(
    `
      DELETE FROM reservations
      WHERE line_item_id IN (SELECT id FROM line_items WHERE work_item_id = $1)
      RETURNING product_id, quantity
    `,
    [workItemId],
  )
  for (const row of used.rows) {
    await client.query(
      `
        UPDATE inventory_stock
        SET on_hand_qty = on_hand_qty - $2, reserved_qty = reserved_qty - $2, updated_at = NOW()
        WHERE product_id = $1
      `,
      [row.product_id, row.quantity],
    )
    await client.query(
      `
        INSERT INTO inventory_movements (product_id, movement_type, quantity_delta, note, ticket_id)
        VALUES ($1, 'consumption', $2, $3, $4)
      `,
      [row.product_id, -row.quantity, `Installed (${workItem.itemType})`, ticketId],
    )
  }

  await client.query(
    `
      UPDATE pending_orders
      SET status = 'installed', closed_at = NOW(), updated_at = NOW()
      WHERE status = 'arrived'
        AND line_item_id IN (SELECT id FROM line_items WHERE work_item_id = $1)
    `,
    [workItemId],
  )

  await client.query(
    `
      UPDATE work_items
      SET status = 'completed', completed_at = NOW(), started_at = COALESCE(started_at, NOW())
      WHERE id = $1
    `,
    [workItemId],
  )
  await finishQueueEntry(client, workItemId, 'done')
  await syncQueue(client, ticketId)
  return ticketId
}

// The work won't be done: free its stock, cancel what wasn't ordered yet,
// and take it out of its queue. It stays on the work order but off the invoice.
export async function markNotPerformed(
  client: PoolClient,
  workItemId: string,
  reason: string,
  suspensionIssue: boolean,
) {
  const { ticketId, workItem } = await lockWorkItem(client, workItemId, ['work_order'], null)
  const current = await client.query('SELECT status FROM work_items WHERE id = $1', [workItemId])
  if (current.rows[0].status !== 'pending') {
    throw new ConflictError('This work is already finished')
  }
  if (suspensionIssue && workItem.itemType !== 'alignment') {
    throw new ValidationError('Only an alignment can fail on suspension')
  }

  const released = await client.query(
    `
      DELETE FROM reservations
      WHERE line_item_id IN (SELECT id FROM line_items WHERE work_item_id = $1)
      RETURNING product_id, quantity
    `,
    [workItemId],
  )
  for (const row of released.rows) {
    await client.query(
      `UPDATE inventory_stock SET reserved_qty = reserved_qty - $2, updated_at = NOW() WHERE product_id = $1`,
      [row.product_id, row.quantity],
    )
  }

  await client.query(
    `
      UPDATE pending_orders
      SET status = 'cancelled', closed_at = NOW(), updated_at = NOW()
      WHERE status = 'needed'
        AND line_item_id IN (SELECT id FROM line_items WHERE work_item_id = $1)
    `,
    [workItemId],
  )

  // Ordered or arrived special orders need a decision: return or unclaimed.
  const decide = await client.query(
    `
      SELECT COUNT(*)::int AS n FROM pending_orders
      WHERE status IN ('ordered', 'arrived') AND ticket_id IS NOT NULL
        AND line_item_id IN (SELECT id FROM line_items WHERE work_item_id = $1)
    `,
    [workItemId],
  )

  await client.query(
    `UPDATE work_items SET status = 'not_performed', not_performed_reason = $2 WHERE id = $1`,
    [workItemId, reason],
  )
  await finishQueueEntry(client, workItemId, suspensionIssue ? 'suspension_issue' : 'removed')
  await syncQueue(client, ticketId)
  // Sensors on this job no longer count toward the car's 2+ sensor price.
  await repriceTpms(client, ticketId)

  return { ticketId, ordersToResolve: decide.rows[0].n as number }
}

workItemStatusRouter.post('/:id/complete', async (req, res) => {
  const id = idParam(req.params.id)
  const ticketId = await withTransaction((client) => completeWorkItem(client, id))
  res.json({ ticket: await loadTicketDetail(pool, ticketId) })
})

workItemStatusRouter.post('/:id/not-performed', async (req, res) => {
  const id = idParam(req.params.id)
  const body = asBody(req.body)
  const reason = optionalText(body, 'reason')
  if (!reason) throw new ValidationError('Say why the work was not performed')
  const suspension = optionalBoolean(body, 'suspensionIssue', false)
  const result = await withTransaction((client) => markNotPerformed(client, id, reason, suspension))
  res.json({
    ticket: await loadTicketDetail(pool, result.ticketId),
    ordersToResolve: result.ordersToResolve,
  })
})

// ---------------------------------------------------------------------------
// The shop floor: lifts, queues, readiness and wait estimates.
// ---------------------------------------------------------------------------

type Entry = {
  id: string
  workItemId: string
  ticketId: string
  ticketNumber: number
  queue: Queue
  status: 'waiting' | 'on_lift'
  readyOverride: boolean | null
  liftId: string | null
  enqueuedAt: Date
  startedAt: Date | null
  itemType: WorkItem['itemType']
  title: string | null
  customerSuppliedTires: boolean
  tireProductId: string | null
  tireQuantity: number | null
  customerTireSize: string | null
  difficultyMinutes: number
  laborHours: number
  openOrders: number
  otherPending: string[]
  firstName: string
  lastName: string | null
  year: number
  make: string
  model: string
  licensePlate: string | null
}

async function loadActiveEntries(db: Queryable): Promise<Entry[]> {
  const result = await db.query(`
    SELECT
      q.id::text AS id,
      q.work_item_id::text AS "workItemId",
      t.id::text AS "ticketId",
      t.quote_number AS "ticketNumber",
      q.queue,
      q.status,
      q.ready_override AS "readyOverride",
      q.lift_id::text AS "liftId",
      q.enqueued_at AS "enqueuedAt",
      q.started_at AS "startedAt",
      wi.item_type AS "itemType",
      wi.title,
      wi.customer_supplied_tires AS "customerSuppliedTires",
      wi.tire_product_id::text AS "tireProductId",
      wi.tire_quantity AS "tireQuantity",
      wi.customer_tire_size AS "customerTireSize",
      wi.difficulty_minutes AS "difficultyMinutes",
      COALESCE((
        SELECT SUM(li.quantity) FROM line_items li
        WHERE li.work_item_id = wi.id AND li.line_kind = 'labor'
      ), 0)::float8 AS "laborHours",
      (
        SELECT COUNT(*) FROM pending_orders po
        JOIN line_items li ON li.id = po.line_item_id
        WHERE li.work_item_id = wi.id AND po.status IN ('needed', 'ordered')
      )::int AS "openOrders",
      ARRAY(
        SELECT other.item_type FROM work_items other
        WHERE other.ticket_id = t.id AND other.id <> wi.id AND other.status = 'pending'
      ) AS "otherPending",
      c.first_name AS "firstName",
      c.last_name AS "lastName",
      v.year, v.make, v.model,
      v.license_plate AS "licensePlate"
    FROM queue_entries q
    JOIN work_items wi ON wi.id = q.work_item_id
    JOIN tickets t ON t.id = wi.ticket_id
    JOIN customers c ON c.id = t.customer_id
    JOIN vehicles v ON v.id = t.vehicle_id
    WHERE q.status IN ('waiting', 'on_lift')
    ORDER BY q.enqueued_at, q.id
  `)
  return result.rows
}

const otherLabels: Record<string, string> = {
  tires: 'tires',
  mechanic: 'mechanic work',
  alignment: 'alignment',
  other: 'other work',
}

// Why a job can or can't go on a lift right now. waitingOnParts marks
// mechanic jobs left out of the wait estimate.
function readiness(entry: Entry, entries: Entry[]) {
  const onOtherLift = entries.find(
    (e) => e.ticketId === entry.ticketId && e.id !== entry.id && e.status === 'on_lift',
  )

  let ready = true
  let reason: string | null = null
  let waitingOnParts = false

  if (onOtherLift) {
    ready = false
    reason = `On the ${onOtherLift.queue} lift right now`
  } else if (entry.itemType === 'tires' && entry.openOrders > 0) {
    ready = false
    reason = 'Waiting on tires to arrive'
  } else if (entry.itemType === 'mechanic' && entry.openOrders > 0) {
    ready = false
    waitingOnParts = true
    reason = 'Waiting on parts'
  } else if (entry.itemType === 'alignment') {
    // Alignment is the last step: everything else on the car comes first.
    const blocking = entry.otherPending.filter((type) => type !== 'other')
    if (blocking.length > 0) {
      ready = false
      reason = `Waiting on ${blocking.map((t) => otherLabels[t]).join(' and ')}`
    }
  }

  // "Force ready" can't put a car on two lifts at once.
  if (entry.readyOverride === true && !onOtherLift) {
    return { ready: true, reason: 'Marked ready by advisor', waitingOnParts: false, auto: ready }
  }
  if (entry.readyOverride === false) {
    return { ready: false, reason: 'Held by advisor', waitingOnParts, auto: ready }
  }
  return { ready, reason, waitingOnParts, auto: ready }
}

async function jobMinutes(db: Queryable, entry: Entry, settings: Settings) {
  if (entry.itemType === 'alignment') return settings.alignmentMinutes
  if (entry.itemType === 'mechanic') {
    // No labor on the job yet: assume an hour so the estimate errs high.
    return entry.laborHours > 0 ? Math.ceil(entry.laborHours * 60) : 60
  }
  const tire = await tireInfoFor(db, entry as unknown as WorkItem, settings)
  return tireJobMinutes(settings, tire, entry.tireQuantity ?? 4, entry.difficultyMinutes)
}

type EnrichedEntry = Entry &
  ReturnType<typeof readiness> & {
    jobMinutes: number
    elapsedMinutes: number
    remainingMinutes: number
  }

type QueueRow = EnrichedEntry & { position: number; waitMinutes: number }

type QueueData = {
  lifts: number
  entries: QueueRow[]
  nextEntryId: string | null
  newCarWaitMinutes: number
}

type Lift = { id: string; name: string; queue: Queue; entry: EnrichedEntry | null }

export async function buildShopFloor(db: Queryable = pool): Promise<{
  lifts: Lift[]
  queues: Record<Queue, QueueData>
  generatedAt: string
}> {
  const settings = await loadSettings(db)
  const [entries, liftRows] = await Promise.all([
    loadActiveEntries(db),
    db.query(`SELECT id::text AS id, name, queue FROM lifts ORDER BY sort_order, id`),
  ])
  const now = Date.now()

  const enriched: EnrichedEntry[] = []
  for (const entry of entries) {
    const minutes = await jobMinutes(db, entry, settings)
    const elapsed = entry.startedAt ? Math.floor((now - new Date(entry.startedAt).getTime()) / 60000) : 0
    enriched.push({
      ...entry,
      ...readiness(entry, entries),
      jobMinutes: minutes,
      elapsedMinutes: entry.status === 'on_lift' ? elapsed : 0,
      remainingMinutes: entry.status === 'on_lift' ? Math.max(0, minutes - elapsed) : minutes,
    })
  }

  const lifts: Lift[] = liftRows.rows.map((lift) => ({
    ...lift,
    entry: enriched.find((e) => e.status === 'on_lift' && e.liftId === lift.id) ?? null,
  }))
  const liftCount = (queue: Queue) => Math.max(1, lifts.filter((l) => l.queue === queue).length)

  // Wait = time left on cars being worked on + every car ahead, ready or not
  // (mechanic jobs waiting on parts excepted), shared across the queue's lifts.
  function buildQueue(queue: Queue): QueueData {
    const inQueue = enriched.filter((e) => e.queue === queue)
    const running = inQueue
      .filter((e) => e.status === 'on_lift')
      .reduce((sum, e) => sum + e.remainingMinutes, 0)
    const counts = (e: EnrichedEntry) => !(queue === 'mechanic' && e.waitingOnParts)

    let ahead = 0
    const rows = inQueue
      .filter((e) => e.status === 'waiting')
      .map((entry, index) => {
        const waitMinutes = Math.ceil((running + ahead) / liftCount(queue))
        if (counts(entry)) ahead += entry.jobMinutes
        return { ...entry, position: index + 1, waitMinutes }
      })

    return {
      lifts: liftCount(queue),
      entries: rows,
      nextEntryId: rows.find((r) => r.ready)?.id ?? null,
      // What to tell a customer who joins this queue now.
      newCarWaitMinutes: Math.ceil((running + ahead) / liftCount(queue)),
    }
  }

  return {
    lifts,
    queues: {
      tires: buildQueue('tires'),
      mechanic: buildQueue('mechanic'),
      alignment: buildQueue('alignment'),
    },
    generatedAt: new Date().toISOString(),
  }
}

shopRouter.get('/', async (_req, res) => {
  res.json(await buildShopFloor())
})

// Just the "join now" waits, for the quote screen.
shopRouter.get('/estimates', async (_req, res) => {
  const floor = await buildShopFloor()
  res.json({
    estimates: Object.fromEntries(queues.map((q) => [q, floor.queues[q].newCarWaitMinutes])),
  })
})

// Accepted work that isn't on the shop floor yet: the car isn't here, or a
// job is still waiting on tires or parts. None of it counts toward waits.
shopRouter.get('/upcoming', async (_req, res) => {
  const result = await pool.query(`
    SELECT
      t.id::text AS id,
      t.quote_number AS "ticketNumber",
      t.planned_for::text AS "plannedFor",
      t.checked_in_at AS "checkedInAt",
      t.accepted_at AS "acceptedAt",
      c.first_name AS "firstName",
      c.last_name AS "lastName",
      c.phone,
      v.year, v.make, v.model,
      v.license_plate AS "licensePlate",
      (
        SELECT json_agg(json_build_object(
          'id', wi.id::text,
          'itemType', wi.item_type,
          'title', wi.title,
          'tireQuantity', wi.tire_quantity,
          'queued', EXISTS (SELECT 1 FROM queue_entries q WHERE q.work_item_id = wi.id)
        ) ORDER BY wi.sort_order, wi.id)
        FROM work_items wi
        WHERE wi.ticket_id = t.id AND wi.status = 'pending'
      ) AS items,
      (
        SELECT json_agg(json_build_object(
          'id', po.id::text,
          'description', po.description,
          'status', po.status,
          'qtyOrdered', po.qty_ordered,
          'qtyArrived', po.qty_arrived,
          'expectedAt', po.expected_at::text,
          'vendor', po.vendor
        ) ORDER BY po.id)
        FROM pending_orders po
        WHERE po.ticket_id = t.id AND po.status IN ('needed', 'ordered', 'arrived')
      ) AS orders,
      (
        SELECT MAX(po.expected_at)::text FROM pending_orders po
        WHERE po.ticket_id = t.id AND po.status IN ('needed', 'ordered')
      ) AS "expectedBy",
      EXISTS (
        SELECT 1 FROM pending_orders po WHERE po.ticket_id = t.id AND po.status = 'needed'
      ) AS "needsOrdering",
      NOT EXISTS (
        SELECT 1 FROM pending_orders po
        WHERE po.ticket_id = t.id AND po.status IN ('needed', 'ordered')
      ) AS "allIn",
      (
        SELECT MAX(po.customer_notified_at) FROM pending_orders po WHERE po.ticket_id = t.id
      ) AS "customerNotifiedAt"
    FROM tickets AS t
    JOIN customers AS c ON c.id = t.customer_id
    JOIN vehicles AS v ON v.id = t.vehicle_id
    WHERE t.status = 'work_order'
      AND (
        t.checked_in_at IS NULL
        OR EXISTS (
          SELECT 1 FROM work_items wi
          WHERE wi.ticket_id = t.id
            AND wi.status = 'pending'
            AND wi.item_type IN ('tires', 'mechanic', 'alignment')
            AND NOT EXISTS (SELECT 1 FROM queue_entries q WHERE q.work_item_id = wi.id)
        )
      )
    ORDER BY
      COALESCE(
        t.planned_for,
        (
          SELECT MAX(po.expected_at) FROM pending_orders po
          WHERE po.ticket_id = t.id AND po.status IN ('needed', 'ordered')
        )
      ) NULLS LAST,
      t.accepted_at
  `)
  res.json({ tickets: result.rows })
})

// Lock order everywhere is ticket first, then its rows; doing the same here
// keeps two advisors' clicks from deadlocking each other.
async function lockEntry(client: PoolClient, id: string) {
  const owner = await client.query(
    `
      SELECT wi.ticket_id::text AS "ticketId"
      FROM queue_entries q JOIN work_items wi ON wi.id = q.work_item_id
      WHERE q.id = $1
    `,
    [id],
  )
  if (owner.rowCount === 0) throw new NotFoundError('Queue entry not found')
  await client.query('SELECT 1 FROM tickets WHERE id = $1 FOR UPDATE', [owner.rows[0].ticketId])
  const result = await client.query(
    `
      SELECT q.id::text AS id, q.work_item_id::text AS "workItemId", q.queue, q.status,
             q.lift_id::text AS "liftId"
      FROM queue_entries q WHERE q.id = $1 FOR UPDATE
    `,
    [id],
  )
  if (result.rowCount === 0) throw new NotFoundError('Queue entry not found')
  return { ...result.rows[0], ticketId: owner.rows[0].ticketId as string }
}

// Put a car on a lift. Defaults to a free lift for its queue; the advisor
// can pick another free lift (e.g. a quick tire job on the idle mechanic lift).
shopRouter.post('/entries/:id/start', async (req, res) => {
  const id = idParam(req.params.id)
  const body = asBody(req.body ?? {})
  await withTransaction(async (client) => {
    const entry = await lockEntry(client, id)
    if (entry.status !== 'waiting') throw new ConflictError('This car is not waiting')

    // A car is on one lift at a time. Not even "force" or "Force ready" skips this.
    const onLift = await client.query(
      `
        SELECT l.name FROM queue_entries q
        JOIN work_items wi ON wi.id = q.work_item_id
        JOIN lifts l ON l.id = q.lift_id
        WHERE wi.ticket_id = $1 AND q.status = 'on_lift'
      `,
      [entry.ticketId],
    )
    if (onLift.rowCount! > 0) {
      throw new ConflictError(
        `This car is on ${onLift.rows[0].name} right now. Finish that job or send it back in line first.`,
      )
    }

    const floor = await buildShopFloor(client)
    const row = floor.queues[entry.queue as Queue].entries.find((e) => e.id === id)
    if (row && !row.ready && !optionalBoolean(body, 'force', false)) {
      throw new ConflictError(`Not ready: ${row.reason ?? 'not ready'}`)
    }

    const busy = new Set(floor.lifts.filter((l) => l.entry).map((l) => l.id))
    let liftId = optionalId(body, 'liftId')
    if (liftId) {
      if (!floor.lifts.some((l) => l.id === liftId)) throw new ValidationError('Unknown lift')
      if (busy.has(liftId)) throw new ConflictError('That lift is busy')
    } else {
      liftId = floor.lifts.find((l) => l.queue === entry.queue && !busy.has(l.id))?.id ?? null
      if (!liftId) throw new ConflictError('No free lift for this job. Pick another lift to move it.')
    }

    await client.query(
      `UPDATE queue_entries SET status = 'on_lift', lift_id = $2, started_at = NOW() WHERE id = $1`,
      [id, liftId],
    )
    await client.query(
      `UPDATE work_items SET started_at = COALESCE(started_at, NOW()) WHERE id = $1`,
      [entry.workItemId],
    )
  })
  res.json(await buildShopFloor())
})

// Off the lift and back into line, keeping its original place.
shopRouter.post('/entries/:id/back', async (req, res) => {
  const id = idParam(req.params.id)
  await withTransaction(async (client) => {
    const entry = await lockEntry(client, id)
    if (entry.status !== 'on_lift') throw new ConflictError('This car is not on a lift')
    await client.query(
      `UPDATE queue_entries SET status = 'waiting', lift_id = NULL, started_at = NULL WHERE id = $1`,
      [id],
    )
    await syncQueue(client, entry.ticketId)
  })
  res.json(await buildShopFloor())
})

shopRouter.post('/entries/:id/done', async (req, res) => {
  const id = idParam(req.params.id)
  await withTransaction(async (client) => {
    const entry = await lockEntry(client, id)
    await completeWorkItem(client, entry.workItemId)
  })
  res.json(await buildShopFloor())
})

shopRouter.post('/entries/:id/not-performed', async (req, res) => {
  const id = idParam(req.params.id)
  const body = asBody(req.body)
  const reason = optionalText(body, 'reason')
  if (!reason) throw new ValidationError('Say why the work was not performed')
  const suspension = optionalBoolean(body, 'suspensionIssue', false)
  const result = await withTransaction(async (client) => {
    const entry = await lockEntry(client, id)
    return markNotPerformed(client, entry.workItemId, reason, suspension)
  })
  res.json({ ...(await buildShopFloor()), ordersToResolve: result.ordersToResolve, ticketId: result.ticketId })
})

// After a failed alignment: a new quote for the same vehicle with an empty
// suspension-repair item, if the advisor decides it's worth quoting.
shopRouter.post('/follow-up/:ticketId', async (req, res) => {
  const ticketId = idParam(req.params.ticketId)
  const settings = await loadSettings()
  const created = await withTransaction(async (client) => {
    const source = await client.query(
      'SELECT customer_id, vehicle_id FROM tickets WHERE id = $1',
      [ticketId],
    )
    if (source.rowCount === 0) throw new NotFoundError('Ticket not found')
    const ticket = await client.query(
      `
        INSERT INTO tickets (customer_id, vehicle_id, tax_rate, valid_until, notes)
        VALUES ($1, $2, $3, CURRENT_DATE + $4::int, $5)
        RETURNING id::text AS id, quote_number
      `,
      [
        source.rows[0].customer_id,
        source.rows[0].vehicle_id,
        settings.productsTaxRate,
        settings.quoteValidDays,
        'Follow-up: alignment could not be completed due to suspension',
      ],
    )
    await client.query(
      `INSERT INTO work_items (ticket_id, item_type, title) VALUES ($1, 'mechanic', 'Suspension repair')`,
      [ticket.rows[0].id],
    )
    return ticket.rows[0].id as string
  })
  res.status(201).json({ ticketId: created })
})

// Advisor override: true = ready, false = hold, null = automatic.
shopRouter.put('/entries/:id/ready', async (req, res) => {
  const id = idParam(req.params.id)
  const value = asBody(req.body).override
  if (value !== true && value !== false && value !== null) {
    throw new ValidationError('override must be true, false or null')
  }
  await withTransaction(async (client) => {
    const entry = await lockEntry(client, id)
    if (entry.status !== 'waiting') throw new ConflictError('Only waiting cars can be changed')
    await client.query('UPDATE queue_entries SET ready_override = $2 WHERE id = $1', [id, value])
  })
  res.json(await buildShopFloor())
})
