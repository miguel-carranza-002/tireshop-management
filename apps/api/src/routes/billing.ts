import { Router } from 'express'
import type { PoolClient } from 'pg'
import { balanceColumns, cents, invoiceReadiness, loadBalance } from '../balances.js'
import { pool, withTransaction } from '../db.js'
import {
  asBody,
  ConflictError,
  idParam,
  NotFoundError,
  optionalBoolean,
  optionalText,
  requiredNumber,
  ValidationError,
  type Body,
} from '../validation.js'
import { loadTicketDetail, lockTicket } from './tickets.js'

// Mounted on /api/tickets next to the ticket routes.
export const billingRouter = Router()
// Mounted on /api/invoices.
export const invoicesRouter = Router()

const paymentMethods = ['cash', 'card', 'other'] as const
type PaymentMethod = (typeof paymentMethods)[number]

function paymentMethod(body: Body, label = 'Payment'): PaymentMethod {
  const method = body.method as PaymentMethod
  if (!paymentMethods.includes(method)) {
    throw new ValidationError(`${label} method must be cash, card or other`)
  }
  return method
}

async function insertPayment(
  client: PoolClient,
  ticketId: string,
  kind: 'deposit' | 'payment' | 'refund',
  method: PaymentMethod,
  amount: number,
  note: string | null = null,
) {
  await client.query(
    `INSERT INTO payments (ticket_id, payment_kind, method, amount, note) VALUES ($1, $2, $3, $4, $5)`,
    [ticketId, kind, method, amount, note],
  )
}

// ---------------------------------------------------------------------------
// Deposits and refunds while the work order is open.
// ---------------------------------------------------------------------------

// Extra deposit, e.g. for a special order added after acceptance.
billingRouter.post('/:id/deposits', async (req, res) => {
  const id = idParam(req.params.id)
  const body = asBody(req.body)
  const amount = requiredNumber(body, 'amount', 'Deposit', { min: 0.01, money: true })
  const method = paymentMethod(body, 'Deposit')
  await withTransaction(async (client) => {
    await lockTicket(client, id, ['work_order'])
    await insertPayment(client, id, 'deposit', method, amount, optionalText(body, 'note'))
  })
  res.status(201).json({ ticket: await loadTicketDetail(pool, id) })
})

// Give money back before invoicing (customer cancelled, deposit too large).
billingRouter.post('/:id/refunds', async (req, res) => {
  const id = idParam(req.params.id)
  const body = asBody(req.body)
  const amount = requiredNumber(body, 'amount', 'Refund', { min: 0.01, money: true })
  const method = paymentMethod(body, 'Refund')
  await withTransaction(async (client) => {
    await lockTicket(client, id, ['work_order'])
    const balance = await loadBalance(client, id)
    if (cents(amount) > cents(balance.paid)) {
      throw new ConflictError(`Only $${balance.paid.toFixed(2)} has been paid on this ticket`)
    }
    await insertPayment(client, id, 'refund', method, amount, optionalText(body, 'note'))
  })
  res.status(201).json({ ticket: await loadTicketDetail(pool, id) })
})

// ---------------------------------------------------------------------------
// Invoicing: settle the work order and give it the next invoice number.
// ---------------------------------------------------------------------------

// Body:
//   payments: [{ method, amount }]  - what the customer pays now (can be split)
//   chargeToAccount: true            - account customers: the rest is owed
//   refund: { method }               - when the deposit is more than the charges
//   keepDeposit: true                - instead of a refund, when a special order
//                                      was left unclaimed
billingRouter.post('/:id/invoice', async (req, res) => {
  const id = idParam(req.params.id)
  const body = asBody(req.body)
  const chargeToAccount = optionalBoolean(body, 'chargeToAccount', false)
  const keepDeposit = optionalBoolean(body, 'keepDeposit', false)
  const paymentsIn = Array.isArray(body.payments) ? body.payments.map(asBody) : []
  const payments = paymentsIn.map((p) => ({
    method: paymentMethod(p),
    amount: requiredNumber(p, 'amount', 'Payment', { min: 0.01, money: true }),
  }))
  const refund = body.refund && typeof body.refund === 'object' ? asBody(body.refund) : null

  await withTransaction(async (client) => {
    await lockTicket(client, id, ['work_order'])

    const ready = await invoiceReadiness(client, id)
    if (ready.pendingItems > 0) {
      throw new ConflictError(
        `${ready.pendingItems} work item${ready.pendingItems === 1 ? ' is' : 's are'} not finished. ` +
          'Mark each one done or not performed first.',
      )
    }
    if (ready.openOrders > 0) {
      throw new ConflictError(
        'Some special-ordered items are still open. Return them, mark them unclaimed or cancel them on the Orders page first.',
      )
    }

    const customer = await client.query(
      `SELECT c.has_account AS "hasAccount" FROM tickets t JOIN customers c ON c.id = t.customer_id WHERE t.id = $1`,
      [id],
    )
    if (chargeToAccount && !customer.rows[0].hasAccount) {
      throw new ValidationError('This customer does not have an account')
    }

    const balance = await loadBalance(client, id)
    const due = cents(balance.balance)
    const paying = payments.reduce((sum, p) => sum + cents(p.amount), 0)

    if (due > 0) {
      if (refund || keepDeposit) throw new ValidationError('There is nothing to refund on this ticket')
      if (paying > due) {
        throw new ValidationError(`That is more than the $${balance.balance.toFixed(2)} owed`)
      }
      if (paying < due && !chargeToAccount) {
        throw new ValidationError(
          `The customer owes $${balance.balance.toFixed(2)}. Take the full amount` +
            (customer.rows[0].hasAccount ? ' or charge it to their account.' : '.'),
        )
      }
      for (const p of payments) await insertPayment(client, id, 'payment', p.method, p.amount)
    } else if (due < 0) {
      const credit = -due / 100
      if (payments.length > 0) throw new ValidationError('The customer does not owe anything')
      if (keepDeposit) {
        if (ready.unclaimedOrders === 0) {
          throw new ConflictError('The deposit is only kept when a special order is left unclaimed')
        }
        await client.query(`UPDATE tickets SET deposit_kept = deposit_kept + $2 WHERE id = $1`, [
          id,
          credit,
        ])
      } else {
        if (!refund) {
          throw new ValidationError(
            `The customer has $${credit.toFixed(2)} coming back. Choose how to refund it.`,
          )
        }
        await insertPayment(client, id, 'refund', paymentMethod(refund, 'Refund'), credit)
      }
    } else if (payments.length > 0 || refund || keepDeposit) {
      throw new ValidationError('This ticket is already settled')
    }

    // Gap-free: the counter row is locked until this transaction commits, and
    // a rollback undoes the increment along with everything else.
    const counter = await client.query(
      `UPDATE invoice_counter SET last_number = last_number + 1 RETURNING last_number`,
    )
    const owed = due > 0 && paying < due
    await client.query(
      `
        UPDATE tickets
        SET status = 'invoiced',
            invoice_number = $2,
            invoiced_at = NOW(),
            invoiced_by = current_app_user(),
            paid_at = CASE WHEN $3::boolean THEN NULL ELSE NOW() END,
            charged_to_account = $3::boolean,
            updated_at = NOW()
        WHERE id = $1
      `,
      [id, counter.rows[0].last_number, owed],
    )
  })
  res.json({ ticket: await loadTicketDetail(pool, id) })
})

// ---------------------------------------------------------------------------
// Invoices and open accounts.
// ---------------------------------------------------------------------------

const invoiceListColumns = `
  t.id::text AS id,
  t.quote_number AS "quoteNumber",
  t.invoice_number AS "invoiceNumber",
  t.invoiced_at AS "invoicedAt",
  t.paid_at AS "paidAt",
  t.charged_to_account AS "chargedToAccount",
  (CURRENT_DATE - t.invoiced_at::date) AS "ageDays",
  c.id::text AS "customerId",
  c.first_name AS "firstName",
  c.last_name AS "lastName",
  c.phone,
  v.year, v.make, v.model,
  ${balanceColumns}
`

// Account invoices still owed, oldest first.
invoicesRouter.get('/open-accounts', async (_req, res) => {
  const result = await pool.query(`
    SELECT ${invoiceListColumns}
    FROM tickets AS t
    JOIN customers AS c ON c.id = t.customer_id
    JOIN vehicles AS v ON v.id = t.vehicle_id
    JOIN ticket_balances AS b ON b.ticket_id = t.id
    WHERE t.status = 'invoiced' AND t.paid_at IS NULL
    ORDER BY c.last_name, c.first_name, t.invoiced_at
  `)
  res.json({ invoices: result.rows })
})

// Record a payment on an account invoice. Marks it paid once the balance hits 0.
invoicesRouter.post('/:id/payments', async (req, res) => {
  const id = idParam(req.params.id)
  const body = asBody(req.body)
  const amount = requiredNumber(body, 'amount', 'Payment', { min: 0.01, money: true })
  const method = paymentMethod(body)
  await withTransaction(async (client) => {
    const ticket = await client.query(
      `SELECT status, paid_at AS "paidAt" FROM tickets WHERE id = $1 FOR UPDATE`,
      [id],
    )
    if (ticket.rowCount === 0) throw new NotFoundError('Invoice not found')
    if (ticket.rows[0].status !== 'invoiced') throw new ConflictError('This is not an invoice yet')
    if (ticket.rows[0].paidAt) throw new ConflictError('This invoice is already paid')

    const balance = await loadBalance(client, id)
    if (cents(amount) > cents(balance.balance)) {
      throw new ValidationError(`That is more than the $${balance.balance.toFixed(2)} owed`)
    }
    await insertPayment(client, id, 'payment', method, amount, optionalText(body, 'note'))
    if (cents(amount) === cents(balance.balance)) {
      await client.query(`UPDATE tickets SET paid_at = NOW(), updated_at = NOW() WHERE id = $1`, [id])
    }
  })
  res.status(201).json({ ticket: await loadTicketDetail(pool, id) })
})
