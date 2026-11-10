import { useState, type FormEvent } from 'react'
import {
  api,
  customerName,
  formatPhone,
  type Customer,
  type CustomerInput,
} from '../../api'
import { Alert, Button, FormField } from '../../ui'

type Props = {
  initial?: Customer
  onSaved: (id: string) => void
  onCancel: () => void
  onOpenCustomer: (id: string) => void
}

function toInput(c?: Customer): CustomerInput {
  return {
    firstName: c?.firstName ?? '',
    lastName: c?.lastName ?? '',
    phone: formatPhone(c?.phone ?? null),
    hasAccount: c?.hasAccount ?? false,
    notes: c?.notes ?? '',
  }
}

function CustomerForm({ initial, onSaved, onCancel, onOpenCustomer }: Props) {
  const [form, setForm] = useState<CustomerInput>(() => toInput(initial))
  const [duplicates, setDuplicates] = useState<Customer[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function update<K extends keyof CustomerInput>(key: K, value: CustomerInput[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  // Warn (never block) when another customer already has this phone.
  async function checkPhone() {
    if (form.phone.replace(/\D/g, '').length < 7) {
      setDuplicates([])
      return
    }
    try {
      const { duplicates } = await api.checkPhone(form.phone, initial?.id)
      setDuplicates(duplicates)
    } catch {
      setDuplicates([])
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const result = initial
        ? await api.updateCustomer(initial.id, form)
        : await api.createCustomer(form)
      onSaved(result.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save customer')
      setSaving(false)
    }
  }

  return (
    <form className="cu-form" onSubmit={handleSubmit}>
      <h3 className="cu-form-title">{initial ? 'Edit customer' : 'New customer'}</h3>
      <div className="ui-form-grid">
        <FormField label="First name" required>
          <input value={form.firstName} onChange={(e) => update('firstName', e.target.value)} required autoFocus />
        </FormField>
        <FormField label="Last name">
          <input value={form.lastName} onChange={(e) => update('lastName', e.target.value)} />
        </FormField>
        <FormField label="Phone" required hint="How we call when their tires arrive">
          <input
            type="tel"
            required
            value={form.phone}
            onChange={(e) => update('phone', e.target.value)}
            onBlur={checkPhone}
            placeholder="(555) 123-4567"
          />
        </FormField>
        <label className="cu-check">
          <input type="checkbox" checked={form.hasAccount} onChange={(e) => update('hasAccount', e.target.checked)} />
          Business account (can charge to account)
        </label>
        <FormField label="Notes" wide>
          <textarea rows={2} value={form.notes} onChange={(e) => update('notes', e.target.value)} />
        </FormField>
      </div>

      {duplicates.length > 0 && (
        <Alert tone="warning">
          This phone number is already on file for{' '}
          {duplicates.map((d, i) => (
            <span key={d.id}>
              {i > 0 && ', '}
              <button type="button" className="cu-link" onClick={() => onOpenCustomer(d.id)}>
                {customerName(d)}
              </button>
            </span>
          ))}
          . You can still save if this is a different person.
        </Alert>
      )}
      {error && <Alert tone="danger">{error}</Alert>}

      <div className="cu-form-actions">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save customer'}
        </Button>
      </div>
    </form>
  )
}

export default CustomerForm
