import type { Queryable } from './db.js'
import { NotFoundError } from './validation.js'

// What a customer owes on a ticket (view ticket_balances).
export type Balance = {
  total: number
  returnFees: number
  depositKept: number
  charges: number
  deposits: number
  payments: number
  refunds: number
  paid: number
  balance: number
}

export const balanceColumns = `
  b.total::float8 AS total,
  b.return_fees::float8 AS "returnFees",
  b.deposit_kept::float8 AS "depositKept",
  b.charges::float8 AS charges,
  b.deposits::float8 AS deposits,
  b.payments::float8 AS payments,
  b.refunds::float8 AS refunds,
  b.paid::float8 AS paid,
  b.balance::float8 AS balance
`

export async function loadBalance(db: Queryable, ticketId: string): Promise<Balance> {
  const result = await db.query(
    `SELECT ${balanceColumns} FROM ticket_balances AS b WHERE b.ticket_id = $1`,
    [ticketId],
  )
  if (result.rowCount === 0) throw new NotFoundError('Ticket not found')
  return result.rows[0]
}

// Money is compared in whole cents so float noise never blocks a payment.
export const cents = (amount: number) => Math.round(amount * 100)

// Whether a work order can be invoiced yet.
export type InvoiceReadiness = {
  pendingItems: number
  openOrders: number
  unclaimedOrders: number
}

export async function invoiceReadiness(db: Queryable, ticketId: string): Promise<InvoiceReadiness> {
  const result = await db.query(
    `
      SELECT
        (SELECT COUNT(*)::int FROM work_items WHERE ticket_id = $1 AND status = 'pending') AS "pendingItems",
        (
          SELECT COUNT(*)::int FROM pending_orders
          WHERE ticket_id = $1 AND status IN ('needed', 'ordered', 'arrived')
        ) AS "openOrders",
        (
          SELECT COUNT(*)::int FROM pending_orders
          WHERE ticket_id = $1 AND status = 'unclaimed'
        ) AS "unclaimedOrders"
    `,
    [ticketId],
  )
  return result.rows[0]
}
