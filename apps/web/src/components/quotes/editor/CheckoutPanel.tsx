import { useState } from 'react'
import { formatMoney, type InvoiceInput, type PaymentMethod, type Ticket } from '../../../api'
import { Button, Panel } from '../../../ui'
import { MethodSelect } from './PaymentDialog'

type Props = {
  ticket: Ticket
  busy: boolean
  onInvoice: (input: InvoiceInput) => void
}

type PaymentRow = { method: PaymentMethod; amount: string }

const toCents = (value: string | number) => Math.round(Number(value) * 100)

// Settle a finished work order: take payment (or refund the extra deposit)
// and turn it into an invoice.
function CheckoutPanel({ ticket, busy, onInvoice }: Props) {
  const ready = ticket.invoiceReadiness
  const due = ticket.balance.balance
  const [rows, setRows] = useState<PaymentRow[]>([{ method: 'card', amount: due > 0 ? due.toFixed(2) : '' }])
  const [chargeToAccount, setChargeToAccount] = useState(false)
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>('card')
  const [keepDeposit, setKeepDeposit] = useState(false)

  if (!ready) return null

  if (ready.pendingItems > 0 || ready.openOrders > 0) {
    const todo = [
      ready.pendingItems > 0 &&
        `finish or mark not performed ${ready.pendingItems} work item${ready.pendingItems === 1 ? '' : 's'}`,
      ready.openOrders > 0 &&
        `resolve ${ready.openOrders} open order${ready.openOrders === 1 ? '' : 's'} (return, unclaimed or cancel)`,
    ].filter(Boolean)
    return (
      <Panel title="Invoice">
        <p className="ed-muted">Before invoicing: {todo.join('; ')}.</p>
      </Panel>
    )
  }

  const paying = rows.reduce((sum, r) => sum + (Number(r.amount) > 0 ? toCents(r.amount) : 0), 0)
  const dueCents = toCents(due)
  const rowsValid = rows.every((r) => r.amount === '' || Number(r.amount) >= 0)
  const remaining = (dueCents - paying) / 100

  function submit() {
    if (due > 0) {
      onInvoice({
        payments: rows
          .filter((r) => Number(r.amount) > 0)
          .map((r) => ({ method: r.method, amount: toCents(r.amount) / 100 })),
        chargeToAccount,
      })
    } else if (due < 0) {
      onInvoice(keepDeposit ? { payments: [], keepDeposit: true } : { payments: [], refund: { method: refundMethod } })
    } else {
      onInvoice({ payments: [] })
    }
  }

  let canSubmit = !busy
  let label = 'Create invoice'
  if (due > 0) {
    canSubmit &&= rowsValid && paying <= dueCents && (paying === dueCents || chargeToAccount)
    label =
      paying === dueCents || !chargeToAccount
        ? 'Take payment & invoice'
        : paying === 0
          ? 'Charge to account & invoice'
          : `Take ${formatMoney(paying / 100)}, rest on account`
  } else if (due < 0) {
    label = keepDeposit ? 'Keep deposit & invoice' : `Refund ${formatMoney(-due)} & invoice`
  }

  return (
    <Panel
      className="ed-checkout"
      title="Ready to invoice"
      description={
        due > 0
          ? `The customer owes ${formatMoney(due)}.`
          : due < 0
            ? `${formatMoney(-due)} of their deposit comes back to them.`
            : 'Nothing is owed. The deposit covers everything.'
      }
    >
      <div className="ed-stack">
        {due > 0 && (
          <>
            {rows.map((row, i) => (
              <div key={i} className="ed-pay-row">
                <MethodSelect
                  value={row.method}
                  onChange={(method) => setRows(rows.map((r, j) => (j === i ? { ...r, method } : r)))}
                />
                <input
                  className="ed-input"
                  inputMode="decimal"
                  aria-label="Amount"
                  placeholder="0.00"
                  value={row.amount}
                  onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)))}
                />
                {rows.length > 1 && (
                  <button
                    type="button"
                    className="ed-remove"
                    aria-label="Remove this payment"
                    onClick={() => setRows(rows.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            <div className="ed-pay-row">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setRows([...rows, { method: 'cash', amount: remaining > 0 ? remaining.toFixed(2) : '' }])}
              >
                + Split payment
              </Button>
              {paying !== dueCents && (
                <span className={paying > dueCents ? 'ed-warn' : 'ed-muted'}>
                  {paying > dueCents
                    ? `${formatMoney((paying - dueCents) / 100)} more than owed`
                    : `${formatMoney(remaining)} left`}
                </span>
              )}
            </div>
            {ticket.customer.hasAccount && (
              <label className="ed-check">
                <input
                  type="checkbox"
                  checked={chargeToAccount}
                  onChange={(e) => {
                    setChargeToAccount(e.target.checked)
                    if (e.target.checked) setRows([{ method: 'card', amount: '' }])
                  }}
                />
                Charge {paying > 0 ? 'the rest' : 'it'} to their account
              </label>
            )}
          </>
        )}

        {due < 0 && (
          <fieldset className="ed-choices">
            <legend className="visually-hidden">Leftover deposit</legend>
            <label className="ed-check">
              <input type="radio" checked={!keepDeposit} onChange={() => setKeepDeposit(false)} />
              Refund {formatMoney(-due)} by
              <MethodSelect value={refundMethod} onChange={setRefundMethod} label="Refund method" />
            </label>
            {ready.unclaimedOrders > 0 && (
              <label className="ed-check">
                <input type="radio" checked={keepDeposit} onChange={() => setKeepDeposit(true)} />
                Keep the deposit (their special order can’t be returned)
              </label>
            )}
          </fieldset>
        )}

        <Button variant="primary" disabled={!canSubmit} onClick={submit}>
          {label}
        </Button>
      </div>
    </Panel>
  )
}

export default CheckoutPanel
