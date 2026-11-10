import { Router } from 'express'
import type { PoolClient } from 'pg'
import { refillLine, syncQueue } from '../allocation.js'
import { pool, withTransaction } from '../db.js'
import {
  asBody,
  ConflictError,
  idParam,
  NotFoundError,
  optionalDate,
  optionalNumber,
  optionalText,
  ValidationError,
} from '../validation.js'

export const ordersRouter = Router()
export const callsRouter = Router()

const orderColumns = `
  po.id::text AS id,
  po.ticket_id::text AS "ticketId",
  po.line_item_id::text AS "lineItemId",
  po.product_id::text AS "productId",
  po.item_kind AS "itemKind",
  po.description,
  po.vendor,
  po.qty_ordered AS "qtyOrdered",
  po.qty_arrived AS "qtyArrived",
  po.unit_cost::float8 AS "unitCost",
  po.status,
  po.returnable,
  po.return_fee::float8 AS "returnFee",
  po.ordered_at AS "orderedAt",
  po.expected_at::text AS "expectedAt",
  (po.status IN ('needed', 'ordered') AND po.expected_at < CURRENT_DATE) AS overdue,
  po.arrived_at AS "arrivedAt",
  po.customer_notified_at AS "customerNotifiedAt",
  po.closed_at AS "closedAt",
  po.created_at AS "createdAt",
  t.quote_number AS "ticketNumber",
  t.status AS "ticketStatus",
  t.checked_in_at AS "checkedInAt",
  c.first_name AS "firstName",
  c.last_name AS "lastName",
  c.phone,
  v.year,
  v.make,
  v.model
`

const orderJoins = `
  FROM pending_orders AS po
  LEFT JOIN tickets AS t ON t.id = po.ticket_id
  LEFT JOIN customers AS c ON c.id = t.customer_id
  LEFT JOIN vehicles AS v ON v.id = t.vehicle_id
`

const views: Record<string, string> = {
  needed: `po.status = 'needed' ORDER BY po.created_at`,
  ordered: `po.status = 'ordered' ORDER BY po.expected_at NULLS LAST, po.ordered_at`,
  // Customer items waiting to be installed. Restock is done once it's on the shelf.
  arrived: `po.status = 'arrived' AND po.ticket_id IS NOT NULL ORDER BY po.arrived_at DESC`,
  closed: `(po.status IN ('installed', 'returned', 'unclaimed', 'cancelled')
            OR (po.status = 'arrived' AND po.ticket_id IS NULL))
           ORDER BY COALESCE(po.closed_at, po.arrived_at, po.updated_at) DESC LIMIT 200`,
}

ordersRouter.get('/', async (req, res) => {
  const view = typeof req.query.view === 'string' ? req.query.view : 'needed'
  const where = views[view]
  if (!where) throw new ValidationError('Unknown view')

  const [rows, counts] = await Promise.all([
    pool.query(`SELECT ${orderColumns} ${orderJoins} WHERE ${where}`),
    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'needed')::int AS needed,
        COUNT(*) FILTER (WHERE status = 'ordered')::int AS ordered,
        COUNT(*) FILTER (WHERE status = 'arrived' AND ticket_id IS NOT NULL)::int AS arrived,
        COUNT(*) FILTER (WHERE status = 'unclaimed')::int AS unclaimed
      FROM pending_orders
    `),
  ])

  res.json({ orders: rows.rows, counts: counts.rows[0] })
})

// Ticket first, then the order row: the same lock order as every ticket path.
async function lockOrder(client: PoolClient, id: string) {
  const owner = await client.query('SELECT ticket_id FROM pending_orders WHERE id = $1', [id])
  if (owner.rowCount === 0) throw new NotFoundError('Order not found')
  if (owner.rows[0].ticket_id) {
    await client.query('SELECT 1 FROM tickets WHERE id = $1 FOR UPDATE', [owner.rows[0].ticket_id])
  }
  const result = await client.query(
    `
      SELECT
        id::text AS id,
        ticket_id::text AS "ticketId",
        line_item_id::text AS "lineItemId",
        product_id::text AS "productId",
        item_kind AS "itemKind",
        qty_ordered AS "qtyOrdered",
        qty_arrived AS "qtyArrived",
        status,
        returnable
      FROM pending_orders
      WHERE id = $1
      FOR UPDATE
    `,
    [id],
  )
  if (result.rowCount === 0) throw new NotFoundError('Order not found')
  return result.rows[0]
}

// Mark several items ordered from one vendor at once.
ordersRouter.post('/mark-ordered', async (req, res) => {
  const body = asBody(req.body)
  const ids = Array.isArray(body.ids) ? body.ids.map(String) : []
  if (ids.length === 0 || ids.some((id) => !/^\d+$/.test(id))) {
    throw new ValidationError('Pick at least one item')
  }
  const vendor = optionalText(body, 'vendor')
  const expectedAt = optionalDate(body, 'expectedAt', 'Expected date')

  const result = await pool.query(
    `
      UPDATE pending_orders
      SET status = 'ordered',
          vendor = COALESCE($2, vendor),
          expected_at = COALESCE($3::date, expected_at),
          ordered_at = NOW(),
          updated_at = NOW()
      WHERE id = ANY($1::bigint[]) AND status = 'needed'
    `,
    [ids, vendor, expectedAt],
  )
  res.json({ updated: result.rowCount })
})

ordersRouter.put('/:id', async (req, res) => {
  const id = idParam(req.params.id)
  const body = asBody(req.body)
  await withTransaction(async (client) => {
    const order = await lockOrder(client, id)
    if (!['needed', 'ordered'].includes(order.status)) {
      throw new ConflictError('Only open orders can be edited')
    }
    await client.query(
      `
        UPDATE pending_orders
        SET vendor = $2, expected_at = $3::date, unit_cost = $4, updated_at = NOW()
        WHERE id = $1
      `,
      [
        id,
        optionalText(body, 'vendor'),
        optionalDate(body, 'expectedAt', 'Expected date'),
        optionalNumber(body, 'unitCost', 'Cost', { money: true }),
      ],
    )
  })
  res.json({ ok: true })
})

// Record a delivery. Tires and sensors go into stock; a customer's share is
// reserved for their ticket straight away. Partial deliveries stay on order.
ordersRouter.post('/:id/receive', async (req, res) => {
  const id = idParam(req.params.id)
  const body = asBody(req.body)

  const result = await withTransaction(async (client) => {
    const order = await lockOrder(client, id)
    if (!['needed', 'ordered'].includes(order.status)) {
      throw new ConflictError('This order is not waiting for a delivery')
    }
    const remaining = order.qtyOrdered - order.qtyArrived
    const qty =
      optionalNumber(body, 'quantity', 'Quantity received', { min: 1, integer: true }) ?? remaining
    if (qty > remaining) {
      throw new ValidationError(`Only ${remaining} still expected on this order`)
    }

    if (order.productId) {
      await client.query(
        'INSERT INTO inventory_stock (product_id) VALUES ($1) ON CONFLICT (product_id) DO NOTHING',
        [order.productId],
      )
      await client.query(
        `UPDATE inventory_stock SET on_hand_qty = on_hand_qty + $2, updated_at = NOW() WHERE product_id = $1`,
        [order.productId, qty],
      )
      await client.query(
        `
          INSERT INTO inventory_movements (product_id, movement_type, quantity_delta, note, pending_order_id, ticket_id)
          VALUES ($1, 'receipt', $2, $3, $4, $5)
        `,
        [order.productId, qty, order.ticketId ? 'Special order received' : 'Restock received', id, order.ticketId],
      )

      // Hold the customer's share for them, as long as that work is still to do.
      if (order.ticketId && order.lineItemId) {
        const open = await client.query(
          `
            SELECT 1
            FROM line_items li
            JOIN work_items wi ON wi.id = li.work_item_id
            JOIN tickets t ON t.id = wi.ticket_id
            WHERE li.id = $1 AND t.status = 'work_order' AND wi.status = 'pending'
          `,
          [order.lineItemId],
        )
        if (open.rowCount! > 0) {
          await client.query(
            `
              INSERT INTO reservations (line_item_id, product_id, quantity)
              VALUES ($1, $2, $3)
              ON CONFLICT (line_item_id)
              DO UPDATE SET quantity = reservations.quantity + EXCLUDED.quantity, updated_at = NOW()
            `,
            [order.lineItemId, order.productId, qty],
          )
          await client.query(
            `UPDATE inventory_stock SET reserved_qty = reserved_qty + $2 WHERE product_id = $1`,
            [order.productId, qty],
          )
        }
      }
    }

    const arrived = order.qtyArrived + qty
    const complete = arrived === order.qtyOrdered
    await client.query(
      `
        UPDATE pending_orders
        SET qty_arrived = $2,
            status = $3,
            ordered_at = COALESCE(ordered_at, NOW()),
            arrived_at = CASE WHEN $4 THEN NOW() ELSE arrived_at END,
            updated_at = NOW()
        WHERE id = $1
      `,
      [id, arrived, complete ? 'arrived' : 'ordered', complete],
    )
    // The last thing a job was waiting on came in: it joins the line now.
    if (order.ticketId) await syncQueue(client, order.ticketId)
    return { arrived, complete }
  })

  res.json(result)
})

// Cancel an order that hasn't arrived.
// - Restock, or for work that's finished or not being done: just cancelled.
// - For a job that's still to be done (the supplier fell through): the job
//   is refilled right away from the shelf, or put back under Needs ordering,
//   so it's never left short. A customer who no longer wants the work: mark
//   the job not performed on the work order instead.
ordersRouter.post('/:id/cancel', async (req, res) => {
  const id = idParam(req.params.id)
  const outcome = await withTransaction(async (client) => {
    const order = await lockOrder(client, id)
    if (!['needed', 'ordered'].includes(order.status)) {
      throw new ConflictError('Only open orders can be cancelled')
    }
    if (order.qtyArrived > 0) {
      throw new ConflictError('Some of this already arrived. Return it to the vendor instead.')
    }
    await client.query(
      `UPDATE pending_orders SET status = 'cancelled', closed_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [id],
    )
    if (!order.ticketId || !order.lineItemId) return 'cancelled'

    const job = await client.query(
      `
        SELECT t.status AS "ticketStatus", t.quote_number AS "ticketNumber", wi.status AS "itemStatus"
        FROM line_items li
        JOIN work_items wi ON wi.id = li.work_item_id
        JOIN tickets t ON t.id = wi.ticket_id
        WHERE li.id = $1
      `,
      [order.lineItemId],
    )
    const { ticketStatus, ticketNumber, itemStatus } = job.rows[0]
    if (ticketStatus !== 'work_order' || itemStatus !== 'pending') {
      await syncQueue(client, order.ticketId)
      return 'cancelled'
    }

    const refill = await refillLine(client, order.ticketId, order.lineItemId, {
      itemKind: order.itemKind,
      returnable: order.returnable,
    })
    if (order.status === 'needed' && (refill === 'ordered' || refill === 'reserved_and_ordered')) {
      // Cancelling would only put the same thing straight back on the list.
      throw new ConflictError(
        `WO-${ticketNumber} still needs this. If the customer doesn't want it any more, ` +
          'mark that job not performed on the work order.',
      )
    }
    await syncQueue(client, order.ticketId)
    return refill
  })
  res.json({ ok: true, outcome })
})

// Take arrived items back out of stock (and out of the customer's reservation).
async function removeArrivedFromStock(
  client: PoolClient,
  order: { id: string; productId: string | null; ticketId: string | null; lineItemId: string | null; qtyArrived: number },
  movementType: 'return_to_vendor' | 'unclaimed',
) {
  if (!order.productId || order.qtyArrived === 0) return
  const qty = order.qtyArrived

  if (order.ticketId && order.lineItemId) {
    const reservation = await client.query(
      'SELECT quantity FROM reservations WHERE line_item_id = $1 FOR UPDATE',
      [order.lineItemId],
    )
    const held: number = reservation.rows[0]?.quantity ?? 0
    const released = Math.min(held, qty)
    if (released > 0) {
      if (released === held) {
        await client.query('DELETE FROM reservations WHERE line_item_id = $1', [order.lineItemId])
      } else {
        await client.query(
          'UPDATE reservations SET quantity = quantity - $2, updated_at = NOW() WHERE line_item_id = $1',
          [order.lineItemId, released],
        )
      }
      await client.query(
        `UPDATE inventory_stock SET reserved_qty = reserved_qty - $2 WHERE product_id = $1`,
        [order.productId, released],
      )
    }
  }

  try {
    await client.query(
      `UPDATE inventory_stock SET on_hand_qty = on_hand_qty - $2, updated_at = NOW() WHERE product_id = $1`,
      [order.productId, qty],
    )
  } catch (error) {
    if ((error as { code?: string }).code === '23514') {
      throw new ConflictError(
        'Not enough of these left on the shelf. Some may already be reserved for other customers or installed.',
      )
    }
    throw error
  }

  await client.query(
    `
      INSERT INTO inventory_movements (product_id, movement_type, quantity_delta, note, pending_order_id, ticket_id)
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [
      order.productId,
      movementType,
      -qty,
      movementType === 'return_to_vendor' ? 'Returned to vendor' : 'Unclaimed special order',
      order.id,
      order.ticketId,
    ],
  )
}

// Send items back to the vendor. The return fee is charged to the customer
// from their deposit when the ticket is settled.
ordersRouter.post('/:id/return', async (req, res) => {
  const id = idParam(req.params.id)
  const body = asBody(req.body)
  await withTransaction(async (client) => {
    const order = await lockOrder(client, id)
    if (!['ordered', 'arrived'].includes(order.status) || order.qtyArrived === 0) {
      throw new ConflictError('Nothing has arrived on this order. Cancel it instead.')
    }
    if (!order.returnable) {
      throw new ConflictError('This item cannot be returned. Mark it unclaimed instead.')
    }
    await removeArrivedFromStock(client, order, 'return_to_vendor')
    await client.query(
      `
        UPDATE pending_orders
        SET status = 'returned', return_fee = $2, closed_at = NOW(), updated_at = NOW()
        WHERE id = $1
      `,
      [id, optionalNumber(body, 'returnFee', 'Return fee', { money: true }) ?? 0],
    )
  })
  res.json({ ok: true })
})

// The customer backed out and it can't go back: keep it aside, never as stock.
ordersRouter.post('/:id/unclaimed', async (req, res) => {
  const id = idParam(req.params.id)
  await withTransaction(async (client) => {
    const order = await lockOrder(client, id)
    if (!order.ticketId) throw new ConflictError('Restock orders are regular stock')
    if (!['ordered', 'arrived'].includes(order.status) || order.qtyArrived === 0) {
      throw new ConflictError('Nothing has arrived on this order. Cancel it instead.')
    }
    await removeArrivedFromStock(client, order, 'unclaimed')
    await client.query(
      `UPDATE pending_orders SET status = 'unclaimed', closed_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [id],
    )
  })
  res.json({ ok: true })
})

// ---------------------------------------------------------------------------
// Calling customers when their tires or rims are in.
// ---------------------------------------------------------------------------

// Orders the customer gets a call about when they arrive: tires, rims, and
// parts for an alignment (a camber kit the customer approved).
const callable = (po: string) => `(
  ${po}.item_kind IN ('tire', 'rim')
  OR EXISTS (
    SELECT 1 FROM line_items cli JOIN work_items cwi ON cwi.id = cli.work_item_id
    WHERE cli.id = ${po}.line_item_id AND cwi.item_type = 'alignment'
  )
)`

// Tickets with tires or rims that arrived and the customer hasn't been told.
callsRouter.get('/', async (_req, res) => {
  const tickets = await pool.query(`
    SELECT
      t.id::text AS "ticketId",
      t.quote_number AS "ticketNumber",
      t.checked_in_at AS "checkedInAt",
      c.first_name AS "firstName",
      c.last_name AS "lastName",
      c.phone,
      v.year, v.make, v.model,
      json_agg(
        json_build_object(
          'id', po.id::text,
          'description', po.description,
          'itemKind', po.item_kind,
          'qtyOrdered', po.qty_ordered,
          'qtyArrived', po.qty_arrived,
          'status', po.status
        ) ORDER BY po.id
      ) AS items,
      bool_and(po.status IN ('arrived', 'installed')) AS "allIn",
      MIN(po.arrived_at) AS "firstArrivedAt"
    FROM tickets AS t
    JOIN customers AS c ON c.id = t.customer_id
    JOIN vehicles AS v ON v.id = t.vehicle_id
    JOIN pending_orders AS po
      ON po.ticket_id = t.id
     AND ${callable('po')}
     AND po.status NOT IN ('cancelled', 'returned', 'unclaimed')
    WHERE t.status = 'work_order'
    GROUP BY t.id, c.id, v.id
    HAVING bool_or(po.status = 'arrived' AND po.customer_notified_at IS NULL)
    ORDER BY bool_and(po.status IN ('arrived', 'installed')) DESC, MIN(po.arrived_at)
  `)

  const ids = tickets.rows.map((t) => t.ticketId)
  const calls = ids.length
    ? await pool.query(
        `
          SELECT id::text AS id, ticket_id::text AS "ticketId", note, called_at AS "calledAt"
          FROM call_logs WHERE ticket_id = ANY($1::bigint[]) ORDER BY called_at
        `,
        [ids],
      )
    : { rows: [] }

  res.json({
    tickets: tickets.rows.map((t) => ({
      ...t,
      calls: calls.rows.filter((c) => c.ticketId === t.ticketId),
    })),
  })
})

callsRouter.post('/:ticketId', async (req, res) => {
  const ticketId = idParam(req.params.ticketId)
  const note = optionalText(asBody(req.body ?? {}), 'note')
  const exists = await pool.query('SELECT 1 FROM tickets WHERE id = $1', [ticketId])
  if (exists.rowCount === 0) throw new NotFoundError('Ticket not found')
  await withTransaction((client) =>
    client.query('INSERT INTO call_logs (ticket_id, note) VALUES ($1, $2)', [ticketId, note]),
  )
  res.status(201).json({ ok: true })
})

// The customer knows their items are in; drop them off the call list.
callsRouter.post('/:ticketId/notified', async (req, res) => {
  const ticketId = idParam(req.params.ticketId)
  const note = optionalText(asBody(req.body ?? {}), 'note')
  await withTransaction(async (client) => {
    const updated = await client.query(
      `
        UPDATE pending_orders
        SET customer_notified_at = NOW(), updated_at = NOW()
        WHERE ticket_id = $1 AND ${callable('pending_orders')}
          AND status = 'arrived' AND customer_notified_at IS NULL
      `,
      [ticketId],
    )
    if (updated.rowCount === 0) throw new ConflictError('Nothing arrived is waiting on a call')
    await client.query('INSERT INTO call_logs (ticket_id, note) VALUES ($1, $2)', [
      ticketId,
      note ?? 'Customer notified',
    ])
  })
  res.json({ ok: true })
})
