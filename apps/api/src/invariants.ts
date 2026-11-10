// Rules the data must always follow. Each check returns the rows that break
// it; an empty list means the database is consistent. Used by the tests after
// every scenario and by `npm run check-db` against a live database.
import type { Queryable } from './db.js'

type Check = { name: string; sql: string }

const checks: Check[] = [
  {
    name: 'reserved count matches the reservations',
    sql: `
      SELECT s.product_id, s.reserved_qty, COALESCE(r.total, 0) AS reservations
      FROM inventory_stock s
      LEFT JOIN (SELECT product_id, SUM(quantity) AS total FROM reservations GROUP BY product_id) r
        ON r.product_id = s.product_id
      WHERE s.reserved_qty <> COALESCE(r.total, 0)
    `,
  },
  {
    name: 'reservations only on pending work of open work orders',
    sql: `
      SELECT r.id AS reservation_id, t.status AS ticket_status, wi.status AS item_status
      FROM reservations r
      JOIN line_items li ON li.id = r.line_item_id
      JOIN work_items wi ON wi.id = li.work_item_id
      JOIN tickets t ON t.id = wi.ticket_id
      WHERE t.status <> 'work_order' OR wi.status <> 'pending'
    `,
  },
  {
    name: 'queue entries only for pending work on checked-in work orders',
    sql: `
      SELECT q.id AS entry_id, t.status AS ticket_status, t.checked_in_at, wi.status AS item_status
      FROM queue_entries q
      JOIN work_items wi ON wi.id = q.work_item_id
      JOIN tickets t ON t.id = wi.ticket_id
      WHERE q.status IN ('waiting', 'on_lift')
        AND (t.status <> 'work_order' OR t.checked_in_at IS NULL OR wi.status <> 'pending')
    `,
  },
  {
    name: 'no job waits in line while something on it is still on order',
    sql: `
      SELECT q.id AS entry_id, po.id AS order_id, po.status
      FROM queue_entries q
      JOIN line_items li ON li.work_item_id = q.work_item_id
      JOIN pending_orders po ON po.line_item_id = li.id
      WHERE q.status = 'waiting' AND po.status IN ('needed', 'ordered')
    `,
  },
  {
    name: 'a car is on at most one lift',
    sql: `
      SELECT wi.ticket_id, COUNT(*) AS lifts
      FROM queue_entries q JOIN work_items wi ON wi.id = q.work_item_id
      WHERE q.status = 'on_lift'
      GROUP BY wi.ticket_id
      HAVING COUNT(*) > 1
    `,
  },
  {
    name: 'invoice numbers have no gaps',
    sql: `
      SELECT c.last_number, COUNT(t.id) AS invoices, MIN(t.invoice_number) AS first
      FROM invoice_counter c
      LEFT JOIN tickets t ON t.invoice_number IS NOT NULL
      GROUP BY c.last_number
      HAVING COUNT(t.id) > 0
        AND (MAX(t.invoice_number) <> c.last_number
             OR COUNT(DISTINCT t.invoice_number) <> MAX(t.invoice_number) - MIN(t.invoice_number) + 1)
    `,
  },
  {
    name: 'paid invoices owe nothing; unpaid invoices owe something',
    sql: `
      SELECT t.id, t.invoice_number, t.paid_at, b.balance
      FROM tickets t JOIN ticket_balances b ON b.ticket_id = t.id
      WHERE t.status = 'invoiced'
        AND ((t.paid_at IS NOT NULL AND b.balance <> 0) OR (t.paid_at IS NULL AND b.balance <= 0))
    `,
  },
]

export type Violation = { check: string; rows: Record<string, unknown>[] }

export async function checkInvariants(db: Queryable): Promise<Violation[]> {
  const violations: Violation[] = []
  for (const check of checks) {
    const result = await db.query(check.sql)
    if (result.rowCount! > 0) violations.push({ check: check.name, rows: result.rows })
  }
  return violations
}

export const invariantNames = checks.map((c) => c.name)
