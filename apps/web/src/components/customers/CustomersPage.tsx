import { useEffect, useState } from 'react'
import { api, customerName, formatPhone, vehicleLabel, type CustomerDetail, type CustomerSummary, type Vehicle } from '../../api'
import { Alert, Badge, Button, EmptyState, PageHeader, Panel } from '../../ui'
import CustomerForm from './CustomerForm'
import { driveTypeLabels } from './vehicleDraft'
import VehicleForm from './VehicleForm'
import './CustomersPage.css'

type Mode =
  | { kind: 'view' }
  | { kind: 'newCustomer' }
  | { kind: 'editCustomer' }
  | { kind: 'newVehicle' }
  | { kind: 'editVehicle'; vehicleId: string }

type Props = {
  onOpenTicket: (id: string) => void
}

function vehicleFacts(v: Vehicle) {
  return [
    v.trim,
    v.driveType !== 'unknown' && driveTypeLabels[v.driveType].split(' ')[0],
    v.tireSize && `Tires ${v.tireSize}${v.rearTireSize ? ` / ${v.rearTireSize} rear` : ''}`,
    v.licensePlate && `Plate ${v.licensePlate}`,
    v.vin && `VIN ${v.vin}`,
  ]
    .filter(Boolean)
    .join(' · ')
}

function CustomersPage({ onOpenTicket }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CustomerSummary[]>([])
  const [searching, setSearching] = useState(true)
  const [searchError, setSearchError] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loadedCustomer, setCustomer] = useState<CustomerDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>({ kind: 'view' })

  // Bump to re-run the search and reload the open customer after a save.
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      api
        .searchCustomers(query, controller.signal)
        .then((data) => {
          setResults(data.customers)
          setSearchError(null)
        })
        .catch((err) => {
          if (!controller.signal.aborted) setSearchError(err instanceof Error ? err.message : 'Search failed')
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false)
        })
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, refreshKey])

  useEffect(() => {
    if (!selectedId) return
    const controller = new AbortController()
    api
      .getCustomer(selectedId, controller.signal)
      .then((data) => {
        setCustomer(data.customer)
        setDetailError(null)
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setCustomer(null)
        setDetailError(err instanceof Error ? err.message : 'Could not load customer')
      })
    return () => controller.abort()
  }, [selectedId, refreshKey])

  // Only show the loaded record if it is the one currently selected.
  const customer = loadedCustomer && loadedCustomer.id === selectedId ? loadedCustomer : null

  function openCustomer(id: string) {
    setSelectedId(id)
    setMode({ kind: 'view' })
  }

  function afterSave(id?: string) {
    if (id) setSelectedId(id)
    setMode({ kind: 'view' })
    setRefreshKey((k) => k + 1)
  }

  async function newQuote(vehicleId: string) {
    try {
      const data = await api.createTicket(customer!.id, vehicleId)
      onOpenTicket(data.ticket.id)
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Could not start quote')
    }
  }

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle="Search by first name, last name or phone."
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setSelectedId(null)
              setMode({ kind: 'newCustomer' })
            }}
          >
            New customer
          </Button>
        }
      />

      <div className="cu-layout">
        <Panel flush className="cu-list">
          <div className="cu-search">
            <input
              type="search"
              placeholder="e.g. Maria or 555-0123"
              value={query}
              onChange={(e) => {
                setSearching(true)
                setQuery(e.target.value)
              }}
              aria-label="Search customers"
            />
          </div>
          {searchError && <Alert tone="danger">{searchError}</Alert>}
          {!searchError && !searching && results.length === 0 && (
            <EmptyState title={query ? 'No customers match that search.' : 'No customers yet.'} />
          )}
          <ul className="cu-results" aria-busy={searching}>
            {results.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={c.id === selectedId ? 'cu-row cu-row-selected' : 'cu-row'}
                  onClick={() => openCustomer(c.id)}
                >
                  <span className="cu-row-name">
                    {customerName(c)}
                    {c.hasAccount && <Badge>Account</Badge>}
                  </span>
                  <span className="cu-muted">
                    {formatPhone(c.phone) || 'No phone'} · {c.vehicleCount} vehicle{c.vehicleCount === 1 ? '' : 's'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>

        <div className="cu-detail">
          {mode.kind === 'newCustomer' && (
            <Panel>
              <CustomerForm onSaved={(id) => afterSave(id)} onCancel={() => setMode({ kind: 'view' })} onOpenCustomer={openCustomer} />
            </Panel>
          )}

          {mode.kind !== 'newCustomer' && !selectedId && (
            <Panel>
              <EmptyState title="Select a customer, or add a new one." />
            </Panel>
          )}

          {mode.kind !== 'newCustomer' && selectedId && detailError && <Alert tone="danger">{detailError}</Alert>}

          {mode.kind !== 'newCustomer' && customer && (
            <>
              {mode.kind === 'editCustomer' ? (
                <Panel>
                  <CustomerForm
                    key={customer.id}
                    initial={customer}
                    onSaved={() => afterSave()}
                    onCancel={() => setMode({ kind: 'view' })}
                    onOpenCustomer={openCustomer}
                  />
                </Panel>
              ) : (
                <Panel
                  title={
                    <>
                      {customerName(customer)}
                      {customer.hasAccount && (
                        <>
                          {' '}
                          <Badge>Account</Badge>
                        </>
                      )}
                    </>
                  }
                  description={formatPhone(customer.phone) || 'No phone on file'}
                  actions={
                    <Button size="sm" onClick={() => setMode({ kind: 'editCustomer' })}>
                      Edit
                    </Button>
                  }
                >
                  {customer.notes ? <p className="cu-notes">{customer.notes}</p> : <p className="cu-muted">No notes.</p>}
                </Panel>
              )}

              <Panel
                flush
                title="Vehicles"
                actions={
                  mode.kind !== 'newVehicle' && (
                    <Button size="sm" onClick={() => setMode({ kind: 'newVehicle' })}>
                      Add vehicle
                    </Button>
                  )
                }
              >
                {mode.kind === 'newVehicle' && (
                  <div className="cu-vehicle-form">
                    <VehicleForm customerId={customer.id} onSaved={() => afterSave()} onCancel={() => setMode({ kind: 'view' })} />
                  </div>
                )}
                {customer.vehicles.length === 0 && mode.kind !== 'newVehicle' && <EmptyState title="No vehicles yet." />}
                <ul className="cu-vehicles">
                  {customer.vehicles.map((v) =>
                    mode.kind === 'editVehicle' && mode.vehicleId === v.id ? (
                      <li key={v.id} className="cu-vehicle-form">
                        <VehicleForm customerId={customer.id} initial={v} onSaved={() => afterSave()} onCancel={() => setMode({ kind: 'view' })} />
                      </li>
                    ) : (
                      <li key={v.id} className="cu-vehicle">
                        <div>
                          <div className="cu-vehicle-name">
                            {vehicleLabel(v)}
                            <span className="cu-badges">
                              <Badge>{v.vehicleClass === 'car' ? 'Car' : 'Truck'}</Badge>
                              {v.isEv && <Badge tone="accent">EV</Badge>}
                              {v.heavyDuty && <Badge tone="accent">Heavy-duty</Badge>}
                              {v.runFlat && <Badge tone="accent">Run-flat</Badge>}
                              {v.liftedLowered && <Badge tone="warning">Lifted/lowered</Badge>}
                              {v.multiLinkSuspension && <Badge tone="warning">Multi-link</Badge>}
                            </span>
                          </div>
                          <div className="cu-muted">{vehicleFacts(v) || 'No trim, tire size, plate or VIN yet'}</div>
                        </div>
                        <div className="cu-vehicle-actions">
                          <Button size="sm" variant="ghost" onClick={() => setMode({ kind: 'editVehicle', vehicleId: v.id })}>
                            Edit
                          </Button>
                          <Button size="sm" variant="primary" onClick={() => void newQuote(v.id)}>
                            New quote
                          </Button>
                        </div>
                      </li>
                    ),
                  )}
                </ul>
              </Panel>
            </>
          )}
        </div>
      </div>
    </>
  )
}

export default CustomersPage
