import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { api, formatDate, formatDateTime, formatMoney, type Product, type StockMovement } from '../../api'
import { Alert, Badge, Button, EmptyState, PageHeader, Panel, Table, Tabs } from '../../ui'
import ProductForm from './ProductForm'
import TireLines from './TireLines'
import { kindLabel, specLabel } from './tireSpec'
import './InventoryPage.css'

type Filter = 'all' | 'stocked' | 'special'
type Mode = 'edit' | 'cost' | 'stock' | 'history'
type Open = { productId: string; mode: Mode } | null

const filters: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'stocked', label: 'On the shelf' },
  { id: 'special', label: 'Special order' },
]

const movementLabels: Record<string, string> = {
  receipt: 'Received',
  consumption: 'Installed',
  adjustment: 'Count adjustment',
  return: 'Returned',
  return_to_vendor: 'Sent back to vendor',
  unclaimed: 'Unclaimed special order',
}

const squash = (text: string) => text.toUpperCase().replace(/[^0-9A-Z]/g, '')

// Stock received outside an order, or a shelf count.
function StockForm({ product, onSaved, onCancel }: { product: Product; onSaved: (p: Product) => void; onCancel: () => void }) {
  const [mode, setMode] = useState<'receive' | 'count'>('receive')
  const [quantity, setQuantity] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const { product: updated } = await api.changeStock(product.id, mode, Number(quantity), note.trim() || null)
      onSaved(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change stock')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="iv-inline" onSubmit={submit}>
      <select className="iv-input" value={mode} onChange={(e) => setMode(e.target.value as 'receive' | 'count')} aria-label="Change">
        <option value="receive">Received</option>
        <option value="count">Counted on the shelf</option>
      </select>
      <input
        className="iv-input iv-qty"
        inputMode="numeric"
        aria-label="Quantity"
        placeholder={mode === 'receive' ? '+ qty' : String(product.onHandQty)}
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        autoFocus
      />
      <input
        className="iv-input iv-grow"
        placeholder={mode === 'receive' ? 'Note (e.g. invoice #)' : 'Note (e.g. Monday count)'}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <Button type="submit" size="sm" variant="primary" disabled={saving || quantity === ''}>
        {mode === 'receive' ? 'Add to stock' : 'Set on hand'}
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <span className="iv-muted iv-full">
        {mode === 'receive'
          ? 'For tires bought outside of an order. Orders are received on the Orders page.'
          : `On hand is ${product.onHandQty}; ${product.reservedQty} reserved for customers.`}
      </span>
      {error && <span className="iv-error iv-full">{error}</span>}
    </form>
  )
}

// Today's cost from the supplier. A special-order tire's price follows the
// Settings markup unless a price is typed; stocked items keep their price.
function CostForm({ product, onSaved, onCancel }: { product: Product; onSaved: (p: Product) => void; onCancel: () => void }) {
  const [cost, setCost] = useState(product.cost === null ? '' : String(product.cost))
  const [price, setPrice] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const { product: updated } = await api.setProductCost(product.id, Number(cost), price === '' ? undefined : Number(price))
      onSaved(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the cost')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="iv-inline" onSubmit={submit}>
      <input
        className="iv-input iv-money"
        inputMode="decimal"
        aria-label="Today's cost"
        placeholder="Cost"
        value={cost}
        onChange={(e) => setCost(e.target.value)}
        autoFocus
      />
      <input
        className="iv-input iv-money"
        inputMode="decimal"
        aria-label="Price (optional)"
        placeholder={product.stocked ? 'Keep price' : 'Auto price'}
        value={price}
        onChange={(e) => setPrice(e.target.value)}
      />
      <Button type="submit" size="sm" variant="primary" disabled={saving || cost === '' || !(Number(cost) >= 0)}>
        Save cost
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <span className="iv-muted iv-full">
        {product.stocked ? 'Stocked items keep their price unless you type a new one.' : 'Leave the price blank to use the markup from Settings.'}
        {product.costUpdatedAt && ` Last cost ${formatMoney(product.cost)} on ${formatDate(product.costUpdatedAt)}.`}
      </span>
      {error && <span className="iv-error iv-full">{error}</span>}
    </form>
  )
}

function History({ productId }: { productId: string }) {
  const [movements, setMovements] = useState<StockMovement[] | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    api
      .productMovements(productId, controller.signal)
      .then((data) => setMovements(data.movements))
      .catch(() => {})
    return () => controller.abort()
  }, [productId])
  if (!movements) return <p className="iv-muted">Loading…</p>
  if (movements.length === 0) return <p className="iv-muted">No stock changes yet.</p>
  return (
    <ul className="iv-history">
      {movements.map((m) => (
        <li key={m.id}>
          <span className="iv-muted">{formatDateTime(m.createdAt)}</span>{' '}
          <strong className={m.quantityDelta > 0 ? 'iv-plus' : 'iv-minus'}>
            {m.quantityDelta > 0 ? '+' : ''}
            {m.quantityDelta}
          </strong>{' '}
          {movementLabels[m.movementType] ?? m.movementType}
          {m.note && <span className="iv-muted"> · {m.note}</span>}
        </li>
      ))}
    </ul>
  )
}

function InventoryPage() {
  const [products, setProducts] = useState<Product[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('stocked')
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState<Open>(null)
  const [view, setView] = useState<'products' | 'lines'>('products')

  useEffect(() => {
    const controller = new AbortController()
    api
      .listProducts(controller.signal)
      .then((data) => setProducts(data.products))
      .catch((err) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not load inventory')
      })
    return () => controller.abort()
  }, [])

  function replace(product: Product) {
    setProducts((current) => {
      const list = current ?? []
      return list.some((p) => p.id === product.id) ? list.map((p) => (p.id === product.id ? product : p)) : [product, ...list]
    })
  }

  const shown = useMemo(() => {
    const needle = squash(search)
    return (products ?? []).filter((p) => {
      if (filter === 'stocked' && !p.stocked) return false
      if (filter === 'special' && p.stocked) return false
      return (
        !needle ||
        squash(`${p.tireSize ?? ''} ${p.sizeAlt ?? ''} ${p.brand} ${p.model} ${p.sku} ${p.supplier ?? ''}`).includes(needle)
      )
    })
  }, [products, search, filter])

  const done = (product: Product) => {
    replace(product)
    setOpen(null)
  }

  return (
    <>
      <PageHeader
        title="Inventory"
        subtitle="Tires and sensors on the shelf, plus special-order tires you buy from suppliers. Prices here are used for new quotes; existing quotes keep theirs."
        actions={
          view === 'products' &&
          !adding && (
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add product
            </Button>
          )
        }
      />

      {adding && (
        <Panel className="iv-add">
          <ProductForm onCancel={() => setAdding(false)} onSaved={(p) => (replace(p), setAdding(false))} />
        </Panel>
      )}

      <Panel flush>
        <Tabs
          label="Inventory view"
          tabs={[
            { id: 'products', label: 'Products & sizes', count: products?.length },
            { id: 'lines', label: 'Tire lines' },
          ]}
          value={view}
          onChange={(v) => {
            setView(v)
            setAdding(false)
          }}
        />

        {view === 'lines' && <TireLines />}

        {view === 'products' && (
          <>
            <div className="iv-toolbar">
              <input
                className="iv-search"
                type="search"
                placeholder="Search size, brand, model, SKU or supplier"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search inventory"
              />
              <div className="iv-segmented" role="group" aria-label="Show">
                {filters.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={filter === f.id}
                    className={filter === f.id ? 'iv-seg iv-seg-on' : 'iv-seg'}
                    onClick={() => setFilter(f.id)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <span className="iv-muted">{products ? `${shown.length} of ${products.length}` : ''}</span>
            </div>

            {error && <Alert tone="danger">{error}</Alert>}
            {!error && !products && <EmptyState title="Loading inventory…" />}
            {products && shown.length === 0 && (
              <EmptyState title={products.length === 0 ? 'No products yet.' : 'Nothing matches.'}>
                {products.length === 0 && 'Use Add product to enter your first tire.'}
              </EmptyState>
            )}

            {shown.length > 0 && (
              <Table>
                <thead>
                  <tr>
                    <th scope="col">Product</th>
                    <th scope="col">Supplier</th>
                    <th scope="col" className="num">
                      Cost
                    </th>
                    <th scope="col" className="num">
                      Price
                    </th>
                    <th scope="col" className="num">
                      On hand
                    </th>
                    <th scope="col" className="num">
                      Reserved
                    </th>
                    <th scope="col" className="num">
                      Available
                    </th>
                    <th scope="col" className="num">
                      Min
                    </th>
                    <th scope="col" className="num">
                      On order
                    </th>
                    <th scope="col">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => {
                    const mode = open?.productId === p.id ? open.mode : null
                    const toggle = (m: Mode) => setOpen(mode === m ? null : { productId: p.id, mode: m })
                    const low = p.stocked && p.minQty > 0 && p.availableQty < p.minQty
                    const details = [specLabel(p), kindLabel(p), p.warrantyMiles && `${p.warrantyMiles.toLocaleString()} mi`]
                      .filter(Boolean)
                      .join(' · ')
                    return [
                      <tr key={p.id} className={mode ? 'iv-row-open' : undefined}>
                        <td>
                          <span className="iv-name">
                            {p.productType === 'tire' ? `${p.tireSize} · ` : ''}
                            {p.brand} {p.model}
                          </span>
                          <span className="iv-tags">
                            {p.productType === 'tpms_sensor' && <Badge>TPMS sensor</Badge>}
                            {p.condition === 'used' && <Badge>used</Badge>}
                            {!p.stocked && <Badge tone="warning">special order</Badge>}
                          </span>
                          <div className="iv-muted">{details || p.sku}</div>
                        </td>
                        <td>{p.supplier ?? <span className="iv-muted">—</span>}</td>
                        <td className="num">
                          {formatMoney(p.cost)}
                          {!p.stocked && p.costUpdatedAt && <div className="iv-muted">{formatDate(p.costUpdatedAt)}</div>}
                        </td>
                        <td className="num">{p.price === null ? <span className="iv-warn">no price yet</span> : formatMoney(p.price)}</td>
                        <td className="num">{p.onHandQty}</td>
                        <td className="num">{p.reservedQty}</td>
                        <td className={low || (p.stocked && p.availableQty <= 0) ? 'num iv-warn' : 'num'}>
                          <strong>{p.availableQty}</strong>
                        </td>
                        <td className="num">{p.stocked && p.condition === 'new' ? p.minQty : '—'}</td>
                        <td className="num">{p.onOrderQty || ''}</td>
                        <td className="iv-actions">
                          {(['edit', 'cost', 'stock', 'history'] as Mode[]).map((m) => (
                            <Button key={m} size="sm" variant={mode === m ? 'secondary' : 'ghost'} onClick={() => toggle(m)}>
                              {m === 'edit' ? 'Edit' : m === 'cost' ? 'Cost' : m === 'stock' ? 'Stock' : 'History'}
                            </Button>
                          ))}
                        </td>
                      </tr>,
                      mode && (
                        <tr key={`${p.id}-${mode}`} className="iv-detail">
                          <td colSpan={10}>
                            {mode === 'edit' && <ProductForm initial={p} onCancel={() => setOpen(null)} onSaved={done} />}
                            {mode === 'cost' && <CostForm product={p} onCancel={() => setOpen(null)} onSaved={done} />}
                            {mode === 'stock' && <StockForm product={p} onCancel={() => setOpen(null)} onSaved={done} />}
                            {mode === 'history' && <History productId={p.id} />}
                          </td>
                        </tr>
                      ),
                    ]
                  })}
                </tbody>
              </Table>
            )}
          </>
        )}
      </Panel>
    </>
  )
}

export default InventoryPage
