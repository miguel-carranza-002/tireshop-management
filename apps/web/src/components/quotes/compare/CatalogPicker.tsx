import { useEffect, useMemo, useState } from 'react'
import { api, formatMoney, type Product } from '../../../api'
import { Alert, Badge, Button, Table } from '../../../ui'
import { kindLabel, specLabel } from '../../inventory/tireSpec'
import OrderInCost from './OrderInCost'
import { readyToCompare } from './labels'

type Props = {
  // Starts the search on the size being compared.
  size: string | null
  // Already on the comparison, so not offered again.
  exclude: string[]
  busy: boolean
  // cost: today's distributor cost, or null for a tire that can go on as it is.
  onAdd: (product: Product, cost: number | null) => void
  onClose: () => void
}

const MAX_ROWS = 30
// 225/50ZR17 and 225/50R17 are the same size for searching.
const squash = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/(\d)zr(\d)/g, '$1r$2')

// Any new tire in the catalog, any size: search by brand, model or size
// ("milestar 2656517", "patagonia", "265/65R17").
function CatalogPicker({ size, exclude, busy, onAdd, onClose }: Props) {
  const [products, setProducts] = useState<Product[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState(size ?? '')

  useEffect(() => {
    const controller = new AbortController()
    api
      .listProducts(controller.signal)
      .then((data) => setProducts(data.products.filter((p) => p.productType === 'tire' && p.condition === 'new')))
      .catch((err) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not load the catalog')
      })
    return () => controller.abort()
  }, [])

  const matches = useMemo(() => {
    if (!products) return []
    const terms = search.split(/\s+/).map(squash).filter(Boolean)
    if (terms.length === 0) return []
    return products
      .filter((p) => !exclude.includes(p.id))
      .filter((p) => {
        const text = squash(`${p.brand} ${p.model} ${p.tireSize ?? ''} ${p.sizeAlt ?? ''}`)
        return terms.every((t) => text.includes(t))
      })
      .sort(
        (a, b) =>
          b.onHandQty - b.reservedQty - (a.onHandQty - a.reservedQty) ||
          `${a.brand} ${a.model} ${a.tireSize}`.localeCompare(`${b.brand} ${b.model} ${b.tireSize}`),
      )
  }, [products, search, exclude])

  return (
    <section className="cmp-add">
      <div className="cmp-pick-head">
        <h3 className="ed-section-title">Add from the tire catalog</h3>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Done
        </Button>
      </div>
      <input
        className="ed-input cmp-pick-search"
        autoFocus
        placeholder="Brand, model or size: milestar 2656517"
        aria-label="Search the tire catalog"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {error && <Alert tone="danger">{error}</Alert>}
      {!products && !error && <p className="cmp-muted">Loading the catalog…</p>}
      {products && search.trim() && matches.length === 0 && (
        <p className="cmp-muted">Nothing in the catalog matches. Use + New tire to add one that isn’t in the system.</p>
      )}
      {matches.length > 0 && (
        <Table>
          <thead>
            <tr>
              <th scope="col">Tire</th>
              <th scope="col">On hand</th>
              <th scope="col" className="num">
                Price
              </th>
              <th scope="col">
                <span className="visually-hidden">Add</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {matches.slice(0, MAX_ROWS).map((p) => {
              const available = p.onHandQty - p.reservedQty
              return (
                <tr key={p.id}>
                  <td>
                    <strong>{p.brand}</strong> {p.model}
                    <div className="cmp-muted">
                      {[p.tireSize, specLabel(p), kindLabel(p)].filter(Boolean).join(' · ')}
                    </div>
                  </td>
                  <td>
                    {available > 0 ? <Badge tone="success">{available} on hand</Badge> : <Badge>Order in</Badge>}
                  </td>
                  <td className="num">{readyToCompare(p) ? formatMoney(p.price) : '—'}</td>
                  <td className="num cmp-row-actions">
                    {readyToCompare(p) ? (
                      <Button size="sm" disabled={busy} onClick={() => onAdd(p, null)}>
                        Add
                      </Button>
                    ) : (
                      <OrderInCost
                        lastCost={p.cost}
                        lastCostAt={p.costUpdatedAt}
                        busy={busy}
                        onSave={(cost) => onAdd(p, cost)}
                      />
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
      {matches.length > MAX_ROWS && (
        <p className="cmp-muted">
          Showing {MAX_ROWS} of {matches.length}. Type more to narrow it down.
        </p>
      )}
    </section>
  )
}

export default CatalogPicker
