import { useState } from 'react'
import { formatMoney, methodLabels, type PaymentMethod } from '../../../api'
import { Button, FormField, InputAffix, Modal } from '../../../ui'

export function MethodSelect({
  value,
  onChange,
  label = 'Method',
}: {
  value: PaymentMethod
  onChange: (method: PaymentMethod) => void
  label?: string
}) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as PaymentMethod)}>
      {(Object.keys(methodLabels) as PaymentMethod[]).map((m) => (
        <option key={m} value={m}>
          {methodLabels[m]}
        </option>
      ))}
    </select>
  )
}

type Props = {
  title: string
  submitLabel: string
  defaultAmount?: number
  maxAmount?: number
  withNote?: boolean
  busy: boolean
  onSubmit: (amount: number, method: PaymentMethod, note: string | null) => void
  onClose: () => void
}

// One amount + method: extra deposits, refunds and account payments.
function PaymentDialog({ title, submitLabel, defaultAmount, maxAmount, withNote, busy, onSubmit, onClose }: Props) {
  const [amount, setAmount] = useState(defaultAmount ? defaultAmount.toFixed(2) : '')
  const [method, setMethod] = useState<PaymentMethod>('card')
  const [note, setNote] = useState('')
  const value = Number(amount)
  const tooMuch = maxAmount !== undefined && value > maxAmount + 0.001
  const valid = amount !== '' && value > 0 && !tooMuch

  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      onSubmit={() => valid && onSubmit(Math.round(value * 100) / 100, method, note.trim() || null)}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !valid}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <div className="ui-form-grid">
        <FormField
          label="Amount"
          error={tooMuch ? `At most ${formatMoney(maxAmount!)}` : undefined}
          hint={maxAmount !== undefined ? `Up to ${formatMoney(maxAmount)}` : undefined}
        >
          <InputAffix prefix="$" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
        </FormField>
        <FormField label="Method">
          <MethodSelect value={method} onChange={setMethod} />
        </FormField>
        {withNote && (
          <FormField label="Note" wide>
            <input value={note} placeholder="e.g. cheque #1234" onChange={(e) => setNote(e.target.value)} />
          </FormField>
        )}
      </div>
    </Modal>
  )
}

export default PaymentDialog
