import { useState } from 'react'
import { formatMoney, type OrderRow } from '../../api'
import { Button, FormField, InputAffix, Modal } from '../../ui'

function Footer({ onClose, label, disabled }: { onClose: () => void; label: string; disabled: boolean }) {
  return (
    <>
      <Button variant="ghost" onClick={onClose}>
        Cancel
      </Button>
      <Button type="submit" variant="primary" disabled={disabled}>
        {label}
      </Button>
    </>
  )
}

// How many came in (part of an order can arrive first).
export function ReceiveDialog({
  order,
  busy,
  onReceive,
  onClose,
}: {
  order: OrderRow
  busy: boolean
  onReceive: (quantity: number) => void
  onClose: () => void
}) {
  const remaining = order.qtyOrdered - order.qtyArrived
  const [qty, setQty] = useState(String(remaining))
  const n = Number(qty)
  const valid = Number.isInteger(n) && n >= 1 && n <= remaining
  return (
    <Modal
      open
      title={`Receive ${order.description}`}
      onClose={onClose}
      onSubmit={() => valid && onReceive(n)}
      footer={<Footer onClose={onClose} label="Receive" disabled={busy || !valid} />}
    >
      <FormField
        label="How many arrived?"
        hint={`${remaining} still expected${order.qtyArrived > 0 ? ` (${order.qtyArrived} already in)` : ''}`}
        error={qty !== '' && !valid ? `Between 1 and ${remaining}` : undefined}
      >
        <input inputMode="numeric" autoFocus value={qty} onChange={(e) => setQty(e.target.value)} />
      </FormField>
      {order.ticketId && <p className="ui-dialog-message">Tires are added to stock and reserved for WO-{order.ticketNumber}.</p>}
    </Modal>
  )
}

// Vendor and expected date: marking orders placed, or correcting one.
export function OrderDetailsDialog({
  title,
  submitLabel,
  initial,
  showCost,
  busy,
  vendors,
  onSave,
  onClose,
}: {
  title: string
  submitLabel: string
  initial: { vendor: string; expectedAt: string; unitCost: number | null }
  showCost: boolean
  busy: boolean
  vendors: string[]
  onSave: (values: { vendor: string; expectedAt: string; unitCost: number | null }) => void
  onClose: () => void
}) {
  const [vendor, setVendor] = useState(initial.vendor)
  const [expectedAt, setExpectedAt] = useState(initial.expectedAt)
  const [cost, setCost] = useState(initial.unitCost === null ? '' : String(initial.unitCost))
  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      onSubmit={() => onSave({ vendor: vendor.trim(), expectedAt, unitCost: cost === '' ? null : Number(cost) })}
      footer={<Footer onClose={onClose} label={submitLabel} disabled={busy} />}
    >
      <div className="ui-form-grid">
        <FormField label="Vendor">
          <input autoFocus value={vendor} onChange={(e) => setVendor(e.target.value)} list="order-vendors" placeholder="e.g. ATD" />
          <datalist id="order-vendors">
            {vendors.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </FormField>
        <FormField label="Expected">
          <input type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} />
        </FormField>
        {showCost && (
          <FormField label="Our cost each" hint="Internal only">
            <InputAffix prefix="$" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
          </FormField>
        )}
      </div>
    </Modal>
  )
}

// Send arrived items back; the vendor's fee comes out of the customer's deposit.
export function ReturnDialog({
  order,
  busy,
  onReturn,
  onClose,
}: {
  order: OrderRow
  busy: boolean
  onReturn: (fee: number) => void
  onClose: () => void
}) {
  const [fee, setFee] = useState('0')
  const n = Number(fee)
  return (
    <Modal
      open
      title={`Return ${order.qtyArrived} × ${order.description}`}
      onClose={onClose}
      onSubmit={() => n >= 0 && onReturn(n)}
      footer={<Footer onClose={onClose} label="Return to vendor" disabled={busy || !(n >= 0)} />}
    >
      <FormField label="Return fee charged by the vendor" hint="0 if none. It's charged to the customer from their deposit.">
        <InputAffix prefix="$" inputMode="decimal" autoFocus value={fee} onChange={(e) => setFee(e.target.value)} />
      </FormField>
      {order.unitCost !== null && <p className="ui-dialog-message">We paid {formatMoney(order.unitCost)} each.</p>}
    </Modal>
  )
}
