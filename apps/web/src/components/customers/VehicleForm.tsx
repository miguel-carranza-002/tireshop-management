import { useState, type FormEvent } from 'react'
import { api, type Vehicle, type VehicleInput } from '../../api'
import { Alert, Button } from '../../ui'
import VehicleFields from './VehicleFields'
import { toVehicleInput } from './vehicleDraft'

type Props = {
  customerId: string
  initial?: Vehicle
  onSaved: () => void
  onCancel: () => void
}

// Add or edit a vehicle on the Customers page.
function VehicleForm({ customerId, initial, onSaved, onCancel }: Props) {
  const [form, setForm] = useState<VehicleInput>(() => toVehicleInput(initial))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      if (initial) await api.updateVehicle(initial.id, form)
      else await api.createVehicle(customerId, form)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save vehicle')
      setSaving(false)
    }
  }

  return (
    <form className="vf-form" onSubmit={handleSubmit}>
      <h3 className="vf-form-title">{initial ? 'Edit vehicle' : 'Add vehicle'}</h3>
      <VehicleFields value={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} autoFocus={!initial} />
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="vf-form-actions">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save vehicle'}
        </Button>
      </div>
    </form>
  )
}

export default VehicleForm
