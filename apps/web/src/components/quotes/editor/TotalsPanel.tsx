import { useState } from 'react'
import { api, formatDate, formatMoney, methodLabels, type Ticket } from '../../../api'
import { Button, Panel } from '../../../ui'
import { paymentLabels, type Run } from './labels'
import PaymentDialog from './PaymentDialog'

type Props = {
  ticket: Ticket
  showCosts: boolean
  busy: boolean
  run: Run
}

type MoneyForm = 'deposit' | 'refund' | 'payment'

// Totals, every deposit/payment/refund, the balance, and the money buttons.
function TotalsPanel({ ticket, showCosts, busy, run }: Props) {
  const [form, setForm] = useState<MoneyForm | null>(null)
  const isWorkOrder = ticket.status === 'work_order'
  const isInvoice = ticket.status === 'invoiced'
  const { totals, balance } = ticket

  const totalCost = ticket.workItems
    .flatMap((w) => (w.status === 'not_performed' ? [] : w.lines))
    .reduce((sum, l) => sum + (l.unitCost ?? 0) * l.quantity, 0)
  const showBalance = ticket.payments.length > 0 || balance.returnFees > 0 || balance.depositKept > 0 || isInvoice
  const taxPercent = (ticket.taxRate * 100).toFixed(3).replace(/\.?0+$/, '')

  return (
    <Panel title="Totals">
      <dl className="ed-totals">
        {totals.discount > 0 && (
          <>
            <dt>Before discounts</dt>
            <dd>{formatMoney(totals.gross)}</dd>
            <dt>Discounts</dt>
            <dd>−{formatMoney(totals.discount)}</dd>
          </>
        )}
        <dt>Subtotal</dt>
        <dd>{formatMoney(totals.subtotal)}</dd>
        <dt>
          Tax {taxPercent}% <span className="ed-muted">on {formatMoney(totals.taxableSubtotal)}</span>
        </dt>
        <dd>{formatMoney(totals.tax)}</dd>
        <dt className="ed-grand">Total</dt>
        <dd className="ed-grand">{formatMoney(totals.total)}</dd>

        {balance.returnFees > 0 && (
          <>
            <dt>Return fee (special order sent back)</dt>
            <dd>{formatMoney(balance.returnFees)}</dd>
          </>
        )}
        {balance.depositKept > 0 && (
          <>
            <dt>Deposit kept (unclaimed order)</dt>
            <dd>{formatMoney(balance.depositKept)}</dd>
          </>
        )}
        {ticket.payments.map((p) => (
          <div key={p.id} className="ed-totals-row">
            <dt>
              {paymentLabels[p.paymentKind]}{' '}
              <span className="ed-muted">
                {methodLabels[p.method].toLowerCase()}, {formatDate(p.createdAt)}
                {p.recordedByName && ` · ${p.recordedByName}`}
                {p.note && ` · ${p.note}`}
              </span>
            </dt>
            <dd>
              {p.paymentKind === 'refund' ? '+' : '−'}
              {formatMoney(p.amount)}
            </dd>
          </div>
        ))}
        {showBalance && (
          <>
            <dt className="ed-balance">{balance.balance < 0 ? 'Credit owed to customer' : 'Balance due'}</dt>
            <dd className="ed-balance">{formatMoney(Math.abs(balance.balance))}</dd>
          </>
        )}

        {showCosts && (
          <>
            <dt className="ed-internal">Our cost (internal)</dt>
            <dd className="ed-internal">{formatMoney(totalCost)}</dd>
            <dt className="ed-internal">Margin before tax (internal)</dt>
            <dd className="ed-internal">{formatMoney(totals.subtotal - totalCost)}</dd>
          </>
        )}
      </dl>

      {(isWorkOrder || (isInvoice && !ticket.paidAt)) && (
        <div className="ed-button-row ed-money-actions">
          {isWorkOrder && (
            <>
              <Button size="sm" onClick={() => setForm('deposit')}>
                Take deposit
              </Button>
              {balance.paid > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setForm('refund')}>
                  Refund
                </Button>
              )}
            </>
          )}
          {isInvoice && (
            <Button size="sm" variant="primary" onClick={() => setForm('payment')}>
              Record payment
            </Button>
          )}
        </div>
      )}

      {form && (
        <PaymentDialog
          title={form === 'deposit' ? 'Take a deposit' : form === 'refund' ? 'Refund' : 'Record a payment'}
          submitLabel={form === 'deposit' ? 'Take deposit' : form === 'refund' ? 'Refund' : 'Record payment'}
          defaultAmount={form === 'payment' ? balance.balance : undefined}
          maxAmount={form === 'refund' ? balance.paid : form === 'payment' ? balance.balance : undefined}
          withNote={form === 'payment'}
          busy={busy}
          onClose={() => setForm(null)}
          onSubmit={async (amount, method, note) => {
            const done = await run(() =>
              form === 'deposit'
                ? api.addDeposit(ticket.id, amount, method)
                : form === 'refund'
                  ? api.refund(ticket.id, amount, method)
                  : api.accountPayment(ticket.id, amount, method, note),
            )
            if (done) setForm(null)
          }}
        />
      )}
    </Panel>
  )
}

export default TotalsPanel
