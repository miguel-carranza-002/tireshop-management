import { useEffect, useState } from 'react'
import {
  api,
  customerName,
  formatPhone,
  vehicleLabel,
  type Customer,
  type CustomerDetail,
  type CustomerSummary,
  type VehicleInput,
} from '../../api'
import { Alert, Button, FormField, Modal } from '../../ui'
import VehicleFields from '../customers/VehicleFields'
import { toVehicleInput, vehicleIsComplete } from '../customers/vehicleDraft'

type Props = {
  onCreated: (ticketId: string) => void
  onClose: () => void
}

type NewCustomer = { firstName: string; lastName: string; phone: string }

// What the search box held, split into a starting name or phone.
function draftFromSearch(query: string): NewCustomer {
  const q = query.trim()
  if (/^[\d\s()+.-]{7,}$/.test(q)) return { firstName: '', lastName: '', phone: q }
  const [first = '', ...rest] = q.split(/\s+/)
  return { firstName: first, lastName: rest.join(' '), phone: '' }
}

// Start a quote: pick a customer and vehicle, or add them right here.
function NewQuoteDialog({ onCreated, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CustomerSummary[]>([])
  const [customer, setCustomer] = useState<CustomerDetail | null>(null)
  const [vehicleId, setVehicleId] = useState('')
  // Adding a customer (with their first vehicle), or a vehicle to the picked customer.
  const [newCustomer, setNewCustomer] = useState<NewCustomer | null>(null)
  const [newVehicle, setNewVehicle] = useState<VehicleInput | null>(null)
  const [phoneMatches, setPhoneMatches] = useState<Customer[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (customer || newCustomer) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      api
        .searchCustomers(query, controller.signal)
        .then((data) => setResults(data.customers))
        .catch(() => {})
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, customer, newCustomer])

  async function pickCustomer(id: string) {
    setError(null)
    try {
      const data = await api.getCustomer(id)
      setCustomer(data.customer)
      setNewCustomer(null)
      setPhoneMatches([])
      const vehicles = data.customer.vehicles
      setVehicleId(vehicles.length === 1 ? vehicles[0].id : '')
      // No vehicles yet: go straight to adding one.
      setNewVehicle(vehicles.length === 0 ? toVehicleInput() : null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load customer')
    }
  }

  function startNewCustomer() {
    setNewCustomer(draftFromSearch(query))
    setNewVehicle(toVehicleInput())
    setError(null)
  }

  // Warn (never block) when the phone is already on file.
  async function checkPhone(phone: string) {
    if (phone.replace(/\D/g, '').length < 7) return setPhoneMatches([])
    try {
      setPhoneMatches((await api.checkPhone(phone)).duplicates)
    } catch {
      setPhoneMatches([])
    }
  }

  const customerReady =
    !newCustomer || (newCustomer.firstName.trim() !== '' && newCustomer.phone.replace(/\D/g, '').length >= 7)
  const vehicleReady = newVehicle ? vehicleIsComplete(newVehicle) : vehicleId !== ''
  const canStart = !saving && (customer !== null || newCustomer !== null) && customerReady && vehicleReady

  async function start() {
    if (!canStart) return
    setSaving(true)
    setError(null)
    let customerId = customer?.id ?? null
    try {
      if (newCustomer) {
        const created = await api.createCustomer({ ...newCustomer, hasAccount: false, notes: '' })
        customerId = created.id
      }
      let useVehicle = vehicleId
      if (newVehicle) useVehicle = (await api.createVehicle(customerId!, newVehicle)).vehicle.id
      const data = await api.createTicket(customerId!, useVehicle)
      onCreated(data.ticket.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the quote')
      setSaving(false)
      // The customer was saved but something after it failed: carry on from
      // that customer so a retry doesn't create them twice.
      if (newCustomer && customerId) {
        const vehicle = newVehicle
        await pickCustomer(customerId)
        if (vehicle) setNewVehicle(vehicle)
      }
    }
  }

  const footer = (
    <>
      <Button variant="ghost" onClick={onClose}>
        Cancel
      </Button>
      <Button type="submit" variant="primary" disabled={!canStart}>
        {saving
          ? 'Starting…'
          : newCustomer
            ? 'Add customer & start quote'
            : newVehicle
              ? 'Add vehicle & start quote'
              : 'Start quote'}
      </Button>
    </>
  )

  return (
    <Modal open width={newVehicle ? 720 : 560} title="New quote" onClose={onClose} onSubmit={() => void start()} footer={footer}>
      {/* 1. Find the customer, or add a new one */}
      {!customer && !newCustomer && (
        <>
          <FormField label="Customer">
            <input
              type="search"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or phone"
            />
          </FormField>
          <ul className="qp-picker">
            {results.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => void pickCustomer(c.id)}>
                  <strong>{customerName(c)}</strong>
                  <span className="ed-muted">
                    {formatPhone(c.phone) || 'No phone'} · {c.vehicleCount} vehicle{c.vehicleCount === 1 ? '' : 's'}
                  </span>
                </button>
              </li>
            ))}
            {results.length === 0 && <li className="qp-picker-empty">No customers match.</li>}
          </ul>
          <div>
            <Button onClick={startNewCustomer}>
              + New customer{query.trim() ? `: ${query.trim()}` : ''}
            </Button>
          </div>
        </>
      )}

      {newCustomer && (
        <section className="ed-dialog-section">
          <div className="qp-section-head">
            <h3 className="ed-section-title">New customer</h3>
            <Button size="sm" variant="ghost" onClick={() => setNewCustomer(null)}>
              Back to search
            </Button>
          </div>
          <div className="ui-form-grid">
            <FormField label="First name" required>
              <input
                autoFocus
                value={newCustomer.firstName}
                onChange={(e) => setNewCustomer({ ...newCustomer, firstName: e.target.value })}
              />
            </FormField>
            <FormField label="Last name">
              <input value={newCustomer.lastName} onChange={(e) => setNewCustomer({ ...newCustomer, lastName: e.target.value })} />
            </FormField>
            <FormField label="Phone" required hint="How we call when their tires arrive">
              <input
                type="tel"
                value={newCustomer.phone}
                onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                onBlur={(e) => void checkPhone(e.target.value)}
                placeholder="(555) 123-4567"
              />
            </FormField>
          </div>
          {phoneMatches.length > 0 && (
            <Alert tone="warning">
              This phone is already on file:{' '}
              {phoneMatches.map((m, i) => (
                <span key={m.id}>
                  {i > 0 && ', '}
                  <button type="button" className="ed-inline-link" onClick={() => void pickCustomer(m.id)}>
                    use {customerName(m)}
                  </button>
                </span>
              ))}
            </Alert>
          )}
        </section>
      )}

      {/* 2. Their vehicle: pick one, or add one */}
      {customer && (
        <div className="qp-picked">
          <div>
            <strong>{customerName(customer)}</strong>
            {customer.phone && <span className="ed-muted"> · {formatPhone(customer.phone)}</span>}
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setCustomer(null)
              setNewVehicle(null)
            }}
          >
            Change
          </Button>
        </div>
      )}

      {customer && customer.vehicles.length > 0 && !newVehicle && (
        <fieldset className="qp-vehicles">
          <legend className="ui-field-label">Vehicle</legend>
          {customer.vehicles.map((v) => (
            <label key={v.id} className={vehicleId === v.id ? 'qp-vehicle qp-vehicle-on' : 'qp-vehicle'}>
              <input type="radio" name="vehicle" checked={vehicleId === v.id} onChange={() => setVehicleId(v.id)} />
              <span>
                {vehicleLabel(v)}
                {v.trim && ` ${v.trim}`}
                <span className="ed-muted">
                  {v.licensePlate && ` · ${v.licensePlate}`}
                  {v.tireSize && ` · ${v.tireSize}`}
                </span>
              </span>
            </label>
          ))}
          <div>
            <Button size="sm" variant="ghost" onClick={() => setNewVehicle(toVehicleInput())}>
              + Add a vehicle
            </Button>
          </div>
        </fieldset>
      )}

      {newVehicle && (
        <section className="ed-dialog-section">
          <div className="qp-section-head">
            <h3 className="ed-section-title">{newCustomer ? 'Their vehicle' : 'New vehicle'}</h3>
            {customer && customer.vehicles.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setNewVehicle(null)}>
                Pick an existing vehicle
              </Button>
            )}
          </div>
          <VehicleFields value={newVehicle} onChange={(patch) => setNewVehicle({ ...newVehicle, ...patch })} />
        </section>
      )}

      {error && <Alert tone="danger">{error}</Alert>}
    </Modal>
  )
}

export default NewQuoteDialog
