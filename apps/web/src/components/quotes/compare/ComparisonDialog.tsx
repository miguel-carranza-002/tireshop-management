import { useEffect, useMemo, useState } from 'react'
import {
  api,
  formatMoney,
  noFilters,
  type CompareOption,
  type Comparison,
  type Product,
  type Ticket,
  type Tier,
  type TireFilters,
  type TireRequest,
} from '../../../api'
import { Alert, Badge, Button, FormField, Modal, Table, Tabs } from '../../../ui'
import ProductForm from '../../inventory/ProductForm'
import { specLabel } from '../../inventory/tireSpec'
import CatalogPicker from './CatalogPicker'
import CompareFilters from './CompareFilters'
import OptionCard, { AvailabilityBadge } from './OptionCard'
import OrderInCost from './OrderInCost'
import RequestBox from './RequestBox'
import { readyToCompare, slotTiers } from './labels'
import './Compare.css'

export type CompareTarget = {
  // A Tires item to fill or replace (its options, or its tire).
  workItemId?: string
  quantity?: number
  axle?: 'front' | 'rear' | null
}

type Props = {
  ticket: Ticket
  target: CompareTarget
  busy: boolean
  onPick: (productId: string, quantity: number, axle: 'front' | 'rear' | null) => void
  onQuote: (input: { size: string; quantity: number; axle: 'front' | 'rear' | null; productIds: string[] }) => void
  onClose: () => void
}

type Ready = Extract<Comparison, { needsSize: false }>

// Cheap / medium / premium for the vehicle's size, everything else in the
// size below, other sizes when it's safe, and used tires on their own line.
function ComparisonDialog({ ticket, target, busy, onPick, onQuote, onClose }: Props) {
  const vehicle = ticket.vehicle
  const staggered = !!vehicle.rearTireSize && vehicle.rearTireSize !== vehicle.tireSize
  const [axle, setAxle] = useState<'front' | 'rear' | null>(target.axle ?? (staggered ? 'front' : null))
  const [quantity, setQuantity] = useState(target.quantity ?? (staggered ? 2 : 4))
  const [sizeDraft, setSizeDraft] = useState('')
  const [size, setSize] = useState<string | null>(null)
  const [data, setData] = useState<Comparison | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [customerView, setCustomerView] = useState(false)
  // The three cards, as product ids, and which of them go on the quote.
  const [slots, setSlots] = useState<string[]>([])
  const [included, setIncluded] = useState<Set<string>>(new Set())
  const [costError, setCostError] = useState<string | null>(null)
  // A tire that isn't in the system yet, saved to the catalog from here.
  const [adding, setAdding] = useState(false)
  // Searching the whole catalog (any size); what was picked stays listed.
  const [picking, setPicking] = useState(false)
  const [extra, setExtra] = useState<string[]>([])
  // Brand, warranty, season… narrow the cards; the size always comes first.
  const [filters, setFilters] = useState<TireFilters>(noFilters)

  useEffect(() => {
    const controller = new AbortController()
    api
      .tireComparison(ticket.id, { quantity, size, axle, extra, filters }, controller.signal)
      .then((c) => {
        setData(c)
        setError(null)
        if (!c.needsSize) {
          const ids = c.tiers.map((t) => t.option.id)
          // Cards already shown stay put; a tire priced since then fills an
          // empty spot (up to three) and is quoted like the others.
          setSlots((current) => {
            if (current.length === 0 || !current.every((id) => findIn(c, id))) return ids
            const added = ids.filter((id) => !current.includes(id)).slice(0, 3 - current.length)
            if (added.length > 0) setIncluded((inc) => new Set([...inc, ...added]))
            return [...current, ...added]
          })
          setIncluded((current) => (current.size > 0 ? current : new Set(ids)))
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not load tires')
      })
    return () => controller.abort()
  }, [ticket.id, quantity, size, axle, extra, filters, reload])

  const ready = data && !data.needsSize ? (data as Ready) : null
  const all = useMemo(() => (ready ? allOptions(ready) : []), [ready])
  const byId = (id: string) => all.find((o) => o.id === id)
  const cards = slots.map(byId).filter(Boolean) as CompareOption[]
  const cardTiers: Tier[] = cards.length === 1 ? ['option'] : cards.length === 2 ? ['cheap', 'premium'] : slotTiers
  const isQuote = ticket.status === 'quote'
  const quoting = cards.filter((c) => included.has(c.id))

  async function saveCost(productId: string, cost: number, addToCards = false) {
    setCostError(null)
    try {
      await api.setProductCost(productId, cost)
      if (addToCards) putInSlot(productId)
      setReload((n) => n + 1)
    } catch (err) {
      setCostError(err instanceof Error ? err.message : 'Could not save the cost')
    }
  }

  // From the catalog: today's cost first if it needs one, then onto a card.
  async function addFromCatalog(p: Product, cost: number | null) {
    setCostError(null)
    try {
      if (cost !== null) await api.setProductCost(p.id, cost)
      setExtra((current) => (current.includes(p.id) ? current : [...current, p.id]))
      putInSlot(p.id)
      setReload((n) => n + 1)
    } catch (err) {
      setCostError(err instanceof Error ? err.message : 'Could not save the cost')
    }
  }

  function resetForSize() {
    setSlots([])
    setIncluded(new Set())
    setExtra([])
  }

  // From the typed request: a size or count only when it named one; the
  // filters are replaced, since the sentence describes the whole ask.
  function applyRequest(r: TireRequest) {
    setSlots([])
    setIncluded(new Set())
    setExtra([])
    if (r.axle && staggered && r.axle !== axle) {
      setAxle(r.axle)
      setSize(null)
    }
    if (r.size) {
      setSize(r.size)
      setSizeDraft('')
    }
    if (r.quantity) setQuantity(r.quantity)
    setFilters(r.filters)
  }

  function swap(slot: number, productId: string) {
    const replaced = slots[slot]
    setSlots(slots.map((id, i) => (i === slot ? productId : id)))
    setIncluded((inc) => {
      const next = new Set(inc)
      if (next.delete(replaced)) next.add(productId)
      return next
    })
  }

  function putInSlot(productId: string) {
    if (slots.includes(productId)) return
    if (slots.length < 3) {
      setSlots([...slots, productId])
      setIncluded(new Set([...included, productId]))
    } else swap(1, productId)
  }

  const row = (o: CompareOption, extra?: React.ReactNode) => (
    <tr key={o.id}>
      <td>
        <strong>{o.brand}</strong> {o.model}
        <div className="cmp-muted">
          {o.tireSize}
          {specLabel(o) && ` · ${specLabel(o)}`}
          {o.warrantyMiles ? ` · ${o.warrantyMiles.toLocaleString()} mi` : ''}
        </div>
        {o.warnings.length > 0 && <div className="cmp-row-warn">{o.warnings.join(' · ')}</div>}
        {!customerView && !!o.misses?.length && <div className="cmp-row-miss">Doesn’t match: {o.misses.join(' · ')}</div>}
      </td>
      <td>
        <AvailabilityBadge option={o} customerView={customerView} />
      </td>
      <td className="num">{formatMoney(o.price)}</td>
      <td className="num">
        <strong>{formatMoney(o.outTheDoor?.total)}</strong>
      </td>
      <td className="num cmp-row-actions">
        {extra}
        {!customerView && !slots.includes(o.id) && readyToCompare(o) && (
          <Button size="sm" variant="ghost" onClick={() => putInSlot(o.id)}>
            Compare
          </Button>
        )}
        {readyToCompare(o) && (
          <Button size="sm" disabled={busy} onClick={() => onPick(o.id, quantity, axle)}>
            Pick
          </Button>
        )}
      </td>
    </tr>
  )

  const tableHead = (
    <thead>
      <tr>
        <th scope="col">Tire</th>
        <th scope="col">Availability</th>
        <th scope="col" className="num">
          Each
        </th>
        <th scope="col" className="num">
          Out the door
        </th>
        <th scope="col">
          <span className="visually-hidden">Actions</span>
        </th>
      </tr>
    </thead>
  )

  return (
    <Modal
      open
      width={1180}
      title={customerView ? 'Your tire options' : 'Compare tires'}
      onClose={onClose}
      footer={
        <>
          {!customerView && isQuote && quoting.length > 0 && ready && (
            <span className="cmp-muted cmp-footer-note">
              Quoting locks these prices for the quote’s guarantee. The customer picks one later.
            </span>
          )}
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {isQuote && !customerView && ready && (
            <Button
              variant="primary"
              disabled={busy || quoting.length === 0}
              onClick={() => onQuote({ size: ready.size, quantity, axle, productIds: quoting.map((c) => c.id) })}
            >
              Quote {quoting.length} option{quoting.length === 1 ? '' : 's'}
            </Button>
          )}
        </>
      }
    >
      {!customerView && <RequestBox ticketId={ticket.id} quantity={quantity} onRead={applyRequest} />}

      <div className="cmp-controls">
        {staggered && (
          <Tabs
            label="Axle"
            tabs={[
              { id: 'front', label: `Front · ${vehicle.tireSize}` },
              { id: 'rear', label: `Rear · ${vehicle.rearTireSize}` },
            ]}
            value={axle ?? 'front'}
            onChange={(a) => {
              resetForSize()
              setSize(null)
              setAxle(a)
            }}
          />
        )}
        <FormField label="Number of tires">
          <select
            value={quantity}
            onChange={(e) => {
              setQuantity(Number(e.target.value))
            }}
          >
            {[...new Set([1, 2, 4, 5, 6, quantity])].sort((a, b) => a - b).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Size" hint={size ? 'Just for this comparison' : data?.vehicleSize ? 'From the vehicle' : undefined}>
          <span className="cmp-size">
            <input
              value={sizeDraft || size || data?.vehicleSize || ''}
              placeholder="225/65R17"
              onChange={(e) => setSizeDraft(e.target.value)}
            />
            <Button
              size="sm"
              disabled={!sizeDraft.trim()}
              onClick={() => {
                resetForSize()
                setSize(sizeDraft.trim())
                setSizeDraft('')
              }}
            >
              Show
            </Button>
          </span>
        </FormField>
        {!customerView && !adding && !picking && ready && (
          <span className="cmp-add-buttons">
            <Button size="sm" onClick={() => setPicking(true)}>
              + From catalog
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
              + New tire
            </Button>
          </span>
        )}
        <label className="cmp-customer-toggle">
          <input type="checkbox" checked={customerView} onChange={(e) => setCustomerView(e.target.checked)} />
          Customer view
        </label>
      </div>

      <div className={ready && !customerView ? 'cmp-layout' : 'cmp-layout cmp-layout-full'}>
        {ready && !customerView && (
          <aside className="cmp-side" aria-label="Filters">
            <CompareFilters
              brands={ready.brands ?? []}
              value={filters}
              onChange={(next) => {
                // New filters, new picks: the cards fill again from what matches.
                setSlots([])
                setIncluded(new Set())
                setFilters(next)
              }}
            />
          </aside>
        )}
        <div className="cmp-main">
          {error && <Alert tone="danger">{error}</Alert>}
          {!customerView && ready?.filterNote && <Alert tone="warning">{ready.filterNote}</Alert>}
          {costError && <Alert tone="danger">{costError}</Alert>}
          {data?.banner && <Alert tone="warning">{data.banner}</Alert>}
          {data?.needsSize && (
            <Alert tone="warning">This vehicle has no tire size. Enter one above to compare. Nothing is guessed from the year, make and model.</Alert>
          )}
          {!data && !error && <p className="cmp-muted">Loading…</p>}

          {picking && ready && (
            <CatalogPicker
              size={ready.size}
              exclude={[...slots, ...extra]}
              busy={busy}
              onAdd={(p, cost) => void addFromCatalog(p, cost)}
              onClose={() => setPicking(false)}
            />
          )}

          {adding && (
            <section className="cmp-add">
              <ProductForm
                tireOnly
                title={`New tire${ready ? ` in ${ready.size}` : ''}`}
                preset={{ stocked: false, tireSize: ready?.size ?? sizeDraft.trim() }}
                onCancel={() => setAdding(false)}
                onSaved={(p) => {
                  setAdding(false)
                  // Saved with today's cost: straight onto a card.
                  if (p.price !== null) {
                    setExtra((current) => [...current, p.id])
                    putInSlot(p.id)
                  }
                  setReload((n) => n + 1)
                }}
              />
              <p className="cmp-muted">
                For a tire that isn’t in the system yet. It’s saved to the catalog as a special-order tire; enter today’s cost
                from the distributor to put it on a card.
              </p>
            </section>
          )}

          {ready && !adding && !picking && (
            <>
              {cards.length === 0 ? (
                <Alert tone="info">
                  Nothing on the shelf in {ready.size} for {quantity} tire{quantity === 1 ? '' : 's'}.{' '}
                  {customerView
                    ? ''
                    : ready.orderIn.length > 0
                      ? 'Add one from the order-in list below with today’s cost, or use + From catalog / + New tire.'
                      : 'Use + From catalog or + New tire above with the distributor’s cost.'}
                </Alert>
              ) : (
                <div className="cmp-cards">
                  {cards.map((o, i) => (
                    <OptionCard
                      key={o.id}
                      option={o}
                      tier={cardTiers[i]}
                      quantity={quantity}
                      customerView={customerView}
                      included={isQuote ? included.has(o.id) : undefined}
                      onToggleInclude={
                        isQuote
                          ? () =>
                              setIncluded((inc) => {
                                const next = new Set(inc)
                                if (!next.delete(o.id)) next.add(o.id)
                                return next
                              })
                          : undefined
                      }
                      onPick={() => onPick(o.id, quantity, axle)}
                      swapChoices={[
                        ...ready.tiers.map((t) => t.option),
                        ...ready.others,
                        ...ready.added.filter(readyToCompare),
                        ...ready.alternates.options,
                      ].filter(
                        (c) => !slots.includes(c.id),
                      )}
                      onSwap={(pid) => swap(i, pid)}
                      onCost={(cost) => void saveCost(o.id, cost)}
                      busy={busy}
                    />
                  ))}
                </div>
              )}

              {!customerView && ready.others.filter((o) => !slots.includes(o.id)).length + ready.tiers.filter((t) => !slots.includes(t.option.id)).length > 0 && (
                <section className="cmp-section">
                  <h3 className="ed-section-title">More in {ready.size}</h3>
                  <Table>
                    {tableHead}
                    <tbody>
                      {[...ready.tiers.map((t) => t.option), ...ready.others].filter((o) => !slots.includes(o.id)).map((o) => row(o))}
                    </tbody>
                  </Table>
                </section>
              )}

              {!customerView && ready.added.filter((o) => !slots.includes(o.id)).length > 0 && (
                <section className="cmp-section">
                  <h3 className="ed-section-title">Added from the catalog</h3>
                  <Table>
                    {tableHead}
                    <tbody>
                      {ready.added
                        .filter((o) => !slots.includes(o.id))
                        .map((o) =>
                          row(
                            o,
                            o.diffPercent !== undefined && (
                              <Badge tone="warning">
                                {o.diffPercent > 0 ? '+' : ''}
                                {o.diffPercent}% height
                              </Badge>
                            ),
                          ),
                        )}
                    </tbody>
                  </Table>
                </section>
              )}

              {!customerView && ready.orderIn.filter((o) => !slots.includes(o.id)).length > 0 && (
                <section className="cmp-section">
                  <h3 className="ed-section-title">Order in · enter today’s cost from the distributor to add one</h3>
                  <Table>
                    {tableHead}
                    <tbody>
                      {ready.orderIn
                        .filter((o) => !slots.includes(o.id))
                        .map((o) =>
                          row(
                            o,
                            !readyToCompare(o) && (
                              <OrderInCost
                                lastCost={o.cost}
                                lastCostAt={o.costUpdatedAt}
                                onSave={(c) => void saveCost(o.id, c, true)}
                                busy={busy}
                              />
                            ),
                          ),
                        )}
                    </tbody>
                  </Table>
                </section>
              )}

              <section className="cmp-section">
                <h3 className="ed-section-title">Different size</h3>
                {!ready.alternates.allowed ? (
                  <p className="cmp-muted">{ready.alternates.reason}</p>
                ) : ready.alternates.options.length === 0 ? (
                  <p className="cmp-muted">
                    {ready.alternates.sizes.length === 0
                      ? 'No nearby size is within 3% of the original height.'
                      : `Nothing on the shelf in ${ready.alternates.sizes.map((s) => s.size).join(' or ')}.`}
                  </p>
                ) : (
                  <Table>
                    {tableHead}
                    <tbody>
                      {ready.alternates.options.map((o) =>
                        row(
                          o,
                          <Badge tone="warning">
                            {o.diffPercent! > 0 ? '+' : ''}
                            {o.diffPercent}% height
                          </Badge>,
                        ),
                      )}
                    </tbody>
                  </Table>
                )}
              </section>

              {ready.used.length > 0 && (
                <section className="cmp-section">
                  <h3 className="ed-section-title">Used</h3>
                  <Table>
                    {tableHead}
                    <tbody>{ready.used.map((o) => row(o, <Badge>{o.availableQty} in stock</Badge>))}</tbody>
                  </Table>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

function allOptions(c: Ready) {
  return [...c.tiers.map((t) => t.option), ...c.others, ...c.orderIn, ...c.added, ...c.used, ...c.alternates.options]
}

function findIn(c: Comparison, id: string) {
  return !c.needsSize && allOptions(c as Ready).some((o) => o.id === id)
}

export default ComparisonDialog
