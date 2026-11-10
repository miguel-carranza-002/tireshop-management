// Reserving stock and creating pending orders when work is accepted.
// Every function expects to run inside a transaction.
import type { PoolClient } from 'pg'
import type { Queryable } from './db.js'
import { ConflictError } from './validation.js'

type StockRow = {
  onHand: number
  reserved: number
  stocked: boolean
  condition: 'new' | 'used'
  minQty: number
  productType: 'tire' | 'tpms_sensor'
}

// Lock a product's stock row so two acceptances can't reserve the same tire.
export async function lockStock(client: PoolClient, productId: string): Promise<StockRow> {
  await client.query(
    'INSERT INTO inventory_stock (product_id) VALUES ($1) ON CONFLICT (product_id) DO NOTHING',
    [productId],
  )
  const result = await client.query(
    `
      SELECT
        s.on_hand_qty AS "onHand",
        s.reserved_qty AS reserved,
        p.stocked,
        p.condition,
        p.min_qty AS "minQty",
        p.product_type AS "productType"
      FROM inventory_stock AS s
      JOIN products AS p ON p.id = s.product_id
      WHERE s.product_id = $1
      FOR UPDATE OF s
    `,
    [productId],
  )
  return result.rows[0]
}

// Restock already on its way for this product (not tied to a customer).
export async function openRestockQty(db: Queryable, productId: string) {
  const result = await db.query(
    `
      SELECT COALESCE(SUM(qty_ordered - qty_arrived), 0)::int AS qty
      FROM pending_orders
      WHERE product_id = $1 AND ticket_id IS NULL AND status IN ('needed', 'ordered')
    `,
    [productId],
  )
  return result.rows[0].qty as number
}

type ProductLine = {
  id: string
  productId: string
  description: string
  quantity: number
  unitCost: number | null
}

// Reserve what's on the shelf; order the rest. For a stocked new item, also
// order enough to bring the shelf back up to its minimum (counting restock
// that's already on order, so two tickets don't both reorder the shelf).
export async function allocateProductLine(
  client: PoolClient,
  ticketId: string,
  line: ProductLine,
) {
  const stock = await lockStock(client, line.productId)
  const available = Math.max(0, stock.onHand - stock.reserved)
  const needed = Math.ceil(line.quantity)
  const reserve = Math.min(available, needed)
  const shortfall = needed - reserve

  if (reserve > 0) {
    await client.query(
      'INSERT INTO reservations (line_item_id, product_id, quantity) VALUES ($1, $2, $3)',
      [line.id, line.productId, reserve],
    )
    await client.query(
      `UPDATE inventory_stock SET reserved_qty = reserved_qty + $2, updated_at = NOW() WHERE product_id = $1`,
      [line.productId, reserve],
    )
  }

  let restock = 0

  if (shortfall > 0) {
    await client.query(
      `
        INSERT INTO pending_orders (
          ticket_id, line_item_id, product_id, item_kind, description, qty_ordered, unit_cost, vendor
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, (SELECT supplier FROM products WHERE id = $3))
      `,
      [ticketId, line.id, line.productId, stock.productType, line.description, shortfall, line.unitCost],
    )

    if (stock.stocked && stock.condition === 'new') {
      restock = Math.max(0, stock.minQty - (await openRestockQty(client, line.productId)))
      if (restock > 0) {
        await addRestockOrder(client, {
          productId: line.productId,
          itemKind: stock.productType,
          description: `${line.description} (restock)`,
          qty: restock,
          unitCost: line.unitCost,
        })
      }
    }
  }

  return { reserved: reserve, shortfall, restock }
}

// Add to the product's open 'needed' restock row, or start one.
export async function addRestockOrder(
  client: PoolClient,
  order: { productId: string; itemKind: string; description: string; qty: number; unitCost: number | null },
) {
  const updated = await client.query(
    `
      UPDATE pending_orders
      SET qty_ordered = qty_ordered + $2, updated_at = NOW()
      WHERE id = (
        SELECT id FROM pending_orders
        WHERE product_id = $1 AND ticket_id IS NULL AND status = 'needed'
        ORDER BY id LIMIT 1
      )
    `,
    [order.productId, order.qty],
  )
  if (updated.rowCount === 0) {
    await client.query(
      `
        INSERT INTO pending_orders (product_id, item_kind, description, qty_ordered, unit_cost, vendor)
        VALUES ($1, $2, $3, $4, $5, (SELECT supplier FROM products WHERE id = $1))
      `,
      [order.productId, order.itemKind, order.description, order.qty, order.unitCost],
    )
  }
}

export type OrderKind = 'part' | 'rim' | 'other'

// Parts, rims and other items that aren't kept in inventory.
export async function orderNonInventoryLine(
  client: PoolClient,
  ticketId: string,
  line: { id: string; description: string; quantity: number; unitCost: number | null },
  itemKind: OrderKind,
) {
  await client.query(
    `
      INSERT INTO pending_orders (
        ticket_id, line_item_id, item_kind, description, qty_ordered, unit_cost, returnable
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      ticketId,
      line.id,
      itemKind,
      line.description,
      Math.ceil(line.quantity),
      line.unitCost,
      itemKind !== 'rim', // rims can never be returned
    ],
  )
}

// Undo a line's reservation and its not-yet-ordered pending orders.
export async function releaseLine(client: PoolClient, lineId: string) {
  const orders = await client.query(
    `SELECT status FROM pending_orders WHERE line_item_id = $1 AND status <> 'cancelled'`,
    [lineId],
  )
  if (orders.rows.some((o) => o.status !== 'needed')) {
    throw new ConflictError(
      'Part of this has already been ordered. Cancel or return that order first.',
    )
  }
  await client.query(`DELETE FROM pending_orders WHERE line_item_id = $1`, [lineId])

  const released = await client.query(
    'DELETE FROM reservations WHERE line_item_id = $1 RETURNING product_id, quantity',
    [lineId],
  )
  for (const row of released.rows) {
    await client.query(
      `UPDATE inventory_stock SET reserved_qty = reserved_qty - $2, updated_at = NOW() WHERE product_id = $1`,
      [row.product_id, row.quantity],
    )
  }
}

const queueFor: Record<string, string | undefined> = {
  tires: 'tires',
  mechanic: 'mechanic',
  alignment: 'alignment',
}

// Keep a ticket's lift-queue entries in step with what can actually be done.
// Only a checked-in work order is on the shop floor, and a job joins the line
// only once nothing on it is still to be ordered or on its way. Alignment also
// waits until the car's other work has everything in. Work that's waiting stays
// off the floor (it shows under Coming up) and joins the back of the line when
// the last order arrives. A job leaves the line (or its lift) again if
// something new has to be ordered for it.
export async function syncQueue(client: PoolClient, ticketId: string) {
  const ticket = await client.query(
    `SELECT status, checked_in_at AS "checkedInAt" FROM tickets WHERE id = $1`,
    [ticketId],
  )
  const t = ticket.rows[0]
  if (!t || t.status !== 'work_order' || !t.checkedInAt) return

  const items = await client.query(
    `
      SELECT
        wi.id::text AS id,
        wi.item_type AS "itemType",
        EXISTS (
          SELECT 1 FROM pending_orders po
          JOIN line_items li ON li.id = po.line_item_id
          WHERE li.work_item_id = wi.id AND po.status IN ('needed', 'ordered')
        ) AS "waitingOnOrders",
        q.id::text AS "entryId",
        q.status AS "entryStatus"
      FROM work_items wi
      LEFT JOIN queue_entries q ON q.work_item_id = wi.id
      WHERE wi.ticket_id = $1 AND wi.status = 'pending'
      ORDER BY wi.sort_order, wi.id
    `,
    [ticketId],
  )
  const otherWorkWaiting = items.rows.some(
    (i) => i.waitingOnOrders && (i.itemType === 'tires' || i.itemType === 'mechanic'),
  )

  for (const item of items.rows) {
    const queue = queueFor[item.itemType]
    if (!queue) continue
    const blocked = item.waitingOnOrders || (item.itemType === 'alignment' && otherWorkWaiting)
    // A job that needs something ordered (e.g. a camber kit found during the
    // alignment) comes off the line, or off the lift, until it arrives.
    if (blocked && (item.entryStatus === 'waiting' || item.entryStatus === 'on_lift')) {
      await client.query('DELETE FROM queue_entries WHERE id = $1', [item.entryId])
    } else if (!blocked && !item.entryId) {
      await client.query(`INSERT INTO queue_entries (work_item_id, queue) VALUES ($1, $2)`, [
        item.id,
        queue,
      ])
    }
  }
}

export type RefillOutcome = 'covered' | 'reserved' | 'ordered' | 'reserved_and_ordered'

// Make sure a line on pending work is fully covered again, e.g. after its
// supplier order was cancelled: take what's on the shelf, and put the rest
// back under Needs ordering. Never leaves a job silently short.
export async function refillLine(
  client: PoolClient,
  ticketId: string,
  lineId: string,
  orderDefaults: { itemKind: string; returnable: boolean },
): Promise<RefillOutcome> {
  const lineResult = await client.query(
    `
      SELECT li.product_id::text AS "productId", li.description,
             li.quantity::float8 AS quantity, li.unit_cost::float8 AS "unitCost"
      FROM line_items li WHERE li.id = $1
    `,
    [lineId],
  )
  const line = lineResult.rows[0]
  const needed = Math.ceil(line.quantity)

  if (!line.productId) {
    // Rims, parts, one-offs: never on the shelf, so only an order covers them.
    const covered = await client.query(
      `
        SELECT COALESCE(SUM(qty_ordered), 0)::int AS qty FROM pending_orders
        WHERE line_item_id = $1 AND status IN ('needed', 'ordered', 'arrived', 'installed')
      `,
      [lineId],
    )
    const missing = needed - covered.rows[0].qty
    if (missing <= 0) return 'covered'
    await client.query(
      `
        INSERT INTO pending_orders (
          ticket_id, line_item_id, item_kind, description, qty_ordered, unit_cost, returnable
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [ticketId, lineId, orderDefaults.itemKind, line.description, missing, line.unitCost, orderDefaults.returnable],
    )
    return 'ordered'
  }

  const stock = await lockStock(client, line.productId)
  const counts = await client.query(
    `
      SELECT
        (SELECT COALESCE(SUM(quantity), 0)::int FROM reservations WHERE line_item_id = $1) AS reserved,
        (
          SELECT COALESCE(SUM(qty_ordered - qty_arrived), 0)::int FROM pending_orders
          WHERE line_item_id = $1 AND status IN ('needed', 'ordered')
        ) AS outstanding
    `,
    [lineId],
  )
  const missing = needed - counts.rows[0].reserved - counts.rows[0].outstanding
  if (missing <= 0) return 'covered'

  const take = Math.min(Math.max(0, stock.onHand - stock.reserved), missing)
  if (take > 0) {
    await client.query(
      `
        INSERT INTO reservations (line_item_id, product_id, quantity) VALUES ($1, $2, $3)
        ON CONFLICT (line_item_id)
        DO UPDATE SET quantity = reservations.quantity + EXCLUDED.quantity, updated_at = NOW()
      `,
      [lineId, line.productId, take],
    )
    await client.query(
      `UPDATE inventory_stock SET reserved_qty = reserved_qty + $2, updated_at = NOW() WHERE product_id = $1`,
      [line.productId, take],
    )
  }
  const rest = missing - take
  if (rest > 0) {
    await client.query(
      `
        INSERT INTO pending_orders (
          ticket_id, line_item_id, product_id, item_kind, description, qty_ordered, unit_cost, vendor
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, (SELECT supplier FROM products WHERE id = $3))
      `,
      [ticketId, lineId, line.productId, stock.productType, line.description, rest, line.unitCost],
    )
  }
  return take > 0 && rest > 0 ? 'reserved_and_ordered' : take > 0 ? 'reserved' : 'ordered'
}
