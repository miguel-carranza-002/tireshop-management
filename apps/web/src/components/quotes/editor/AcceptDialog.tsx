import { useState } from 'react'
import { formatMoney, type AcceptInput, type OrderKind, type PaymentMethod, type Ticket } from '../../../api'
import { Alert, Button, FormField, InputAffix, Modal } from '../../../ui'
import { typeLabels } from './labels'
import { MethodSelect } from './PaymentDialog'

type Props = {
  ticket: Ticket
  busy: boolean
  onAccept: (input: AcceptInput) => void
  onClose: () => void
}

// Everything that happens when the customer says yes, shown before it happens.
function AcceptDialog({ ticket, busy, onAccept, onClose }: Props) {
  // Parts and Other lines that could need ordering.
  const orderable = ticket.workItems
    .filter((w) => w.status !== 'not_performed')
    .flatMap((w) =>
      w.lines.filter((l) => l.lineKind === 'part' || l.lineKind === 'custom').map((l) => ({ line: l, workItem: w })),
    )

  const [orders, setOrders] = useState<Record<string, { order: boolean; kind: OrderKind }>>(() =>
    Object.fromEntries(
      orderable.map(({ line }) => [
        line.id,
        line.lineKind === 'part' ? { order: true, kind: 'part' as OrderKind } : { order: false, kind: 'other' as OrderKind },
      ]),
    ),
  )

  // Only special orders need a deposit: tires we don't stock, and rims. A
  // stocked tire that's just out becomes shelf stock if the customer walks.
  const tireShortfall = ticket.stockCheck.some((s) => s.productType === 'tire' && !s.stocked && s.shortfall > 0)
  const rimOrdered = Object.values(orders).some((o) => o.order && o.kind === 'rim')
  const depositRequired = tireShortfall || rimOrdered
  const anythingToOrder =
    ticket.stockCheck.some((s) => s.shortfall > 0) || Object.values(orders).some((o) => o.order)

  const [depositAmount, setDepositAmount] = useState(depositRequired ? String(ticket.minDeposit) : '')
  const [method, setMethod] = useState<PaymentMethod>('card')
  const [overrideReason, setOverrideReason] = useState('')
  // Walk-ins are here now; special orders usually come back later.
  const [checkIn, setCheckIn] = useState(!anythingToOrder)
  const [ackExpired, setAckExpired] = useState(false)
  const [plannedFor, setPlannedFor] = useState('')

  const amount = Number(depositAmount || 0)
  const depositShort = depositRequired && amount < ticket.minDeposit
  const canSubmit = !busy && (!ticket.expired || ackExpired) && (!depositShort || overrideReason.trim() !== '')

  function submit() {
    if (!canSubmit) return
    onAccept({
      orderLines: Object.entries(orders)
        .filter(([, o]) => o.order)
        .map(([lineItemId, o]) => ({ lineItemId, itemKind: o.kind })),
      deposit: amount > 0 ? { amount, method } : null,
      depositOverrideReason: depositShort ? overrideReason.trim() : null,
      checkIn,
      acknowledgeExpired: ackExpired,
      plannedFor: plannedFor || null,
    })
  }

  return (
    <Modal
      open
      width={640}
      title={`Accept quote Q-${ticket.quoteNumber}`}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!canSubmit}>
            {busy ? 'Accepting…' : `Accept & create WO-${ticket.quoteNumber}`}
          </Button>
        </>
      }
    >
      {ticket.stockCheck.length > 0 && (
        <section className="ed-dialog-section">
          <h3 className="ed-section-title">Tires &amp; sensors</h3>
          <ul className="ed-plain-list">
            {ticket.stockCheck.map((s) => {
              const reserve = Math.min(s.needed, Math.max(0, s.available))
              return (
                <li key={s.productId}>
                  <strong>
                    {s.brand} {s.model} {s.tireSize ?? ''}
                  </strong>
                  {' — '}
                  {reserve > 0 && `reserve ${reserve} from stock`}
                  {reserve > 0 && s.shortfall > 0 && ', '}
                  {s.shortfall > 0 && (
                    <span className="ed-warn">
                      order {s.shortfall} for this customer
                      {s.restockQty > 0 && ` + ${s.restockQty} to restock the shelf`}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {orderable.length > 0 && (
        <section className="ed-dialog-section">
          <h3 className="ed-section-title">Parts &amp; other items to order</h3>
          <ul className="ed-plain-list">
            {orderable.map(({ line, workItem }) => {
              const choice = orders[line.id]
              return (
                <li key={line.id} className="ed-pay-row">
                  <label className="ed-check">
                    <input
                      type="checkbox"
                      checked={choice.order}
                      onChange={(e) => setOrders((o) => ({ ...o, [line.id]: { ...choice, order: e.target.checked } }))}
                    />
                    Order {line.quantity} × {line.description}
                    <span className="ed-muted"> ({workItem.title ?? typeLabels[workItem.itemType]})</span>
                  </label>
                  {line.lineKind === 'custom' && choice.order && (
                    <select
                      className="ed-input"
                      value={choice.kind}
                      onChange={(e) =>
                        setOrders((o) => ({ ...o, [line.id]: { ...choice, kind: e.target.value as OrderKind } }))
                      }
                      aria-label={`What is ${line.description}?`}
                    >
                      <option value="other">Other item</option>
                      <option value="rim">Rim (can’t be returned)</option>
                    </select>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section className="ed-dialog-section">
        <h3 className="ed-section-title">Deposit</h3>
        <p className="ed-muted">
          {depositRequired
            ? `Special-order tires and rims need a deposit of at least ${formatMoney(ticket.minDeposit)}.`
            : 'Not required. Leave blank for no deposit.'}
        </p>
        <div className="ui-form-grid">
          <FormField label="Amount">
            <InputAffix
              prefix="$"
              inputMode="decimal"
              value={depositAmount}
              placeholder="0.00"
              onChange={(e) => setDepositAmount(e.target.value)}
            />
          </FormField>
          <FormField label="Paid by">
            <MethodSelect value={method} onChange={setMethod} />
          </FormField>
          {depositShort && (
            <FormField label="Reason for skipping or lowering the deposit" required wide>
              <input
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="e.g. Small order, regular customer"
              />
            </FormField>
          )}
        </div>
      </section>

      <section className="ed-dialog-section">
        <h3 className="ed-section-title">Vehicle</h3>
        <label className="ed-check">
          <input type="checkbox" checked={checkIn} onChange={(e) => setCheckIn(e.target.checked)} />
          The vehicle is here now. Check it in.
        </label>
        {anythingToOrder && (
          <p className="ed-muted">
            Items we don’t have go straight onto Orders → Needs ordering, so they can’t be forgotten. Work
            waiting on them stays under Coming up on the shop floor and only joins the line once everything has
            arrived.
          </p>
        )}
        {(anythingToOrder || !checkIn) && (
          <div className="ui-form-grid">
            <FormField label="Planned for" hint="Optional">
              <input type="date" value={plannedFor} onChange={(e) => setPlannedFor(e.target.value)} />
            </FormField>
          </div>
        )}
      </section>

      {ticket.expired && (
        <Alert tone="warning">
          <label className="ed-check">
            <input type="checkbox" checked={ackExpired} onChange={(e) => setAckExpired(e.target.checked)} />
            This quote expired. I checked the prices are still right.
          </label>
        </Alert>
      )}
    </Modal>
  )
}

export default AcceptDialog
