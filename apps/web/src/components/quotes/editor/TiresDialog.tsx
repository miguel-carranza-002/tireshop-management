import { useEffect, useMemo, useState } from 'react'
import { api, formatDate, formatMoney, type Product, type TireConfig, type WorkItem } from '../../../api'
import { Alert, Button, FormField, Modal } from '../../../ui'
import ProductForm from '../../inventory/ProductForm'

type Props = {
  vehicleTireSize: string | null
  initial?: WorkItem
  busy: boolean
  onSubmit: (config: TireConfig) => void
  onClose: () => void
}

// Compare sizes ignoring punctuation: "225/65R17" matches "2256517".
const squash = (text: string) => text.toUpperCase().replace(/[^0-9A-Z]/g, '')

function TiresDialog({ vehicleTireSize, initial, busy, onSubmit, onClose }: Props) {
  const [products, setProducts] = useState<Product[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  const [customerSupplied, setCustomerSupplied] = useState(initial?.customerSuppliedTires ?? false)
  const [filter, setFilter] = useState(vehicleTireSize ?? '')
  const [productId, setProductId] = useState(initial?.tireProductId ?? '')
  const [customerSize, setCustomerSize] = useState(initial?.customerTireSize ?? vehicleTireSize ?? '')
  const [quantity, setQuantity] = useState(String(initial?.tireQuantity ?? 4))
  const [oldRemoved, setOldRemoved] = useState(initial?.oldTiresRemoved != null ? String(initial.oldTiresRemoved) : '')
  // Adding a tire we don't stock, bought from a supplier for this customer.
  const [addingSupplierTire, setAddingSupplierTire] = useState(false)
  // '' = let the system pick from the tire size.
  const [difficulty, setDifficulty] = useState(initial ? String(initial.difficultyMinutes) : '')

  useEffect(() => {
    const controller = new AbortController()
    api
      .listProducts(controller.signal)
      .then((data) => setProducts(data.products.filter((p) => p.productType === 'tire')))
      .catch((err) => {
        if (!controller.signal.aborted) setLoadError(err instanceof Error ? err.message : 'Could not load tires')
      })
    return () => controller.abort()
  }, [])

  // Matching tires first; everything else stays pickable underneath, so a
  // search that matches nothing never hides the catalog.
  const { matches, others } = useMemo(() => {
    const needle = squash(filter)
    const isMatch = (p: Product) =>
      !needle || squash(`${p.tireSize} ${p.brand} ${p.model} ${p.sku} ${p.supplier ?? ''}`).includes(needle)
    // In stock first, then special order; cheapest first; unpriced last.
    const order = (a: Product, b: Product) =>
      Number(b.availableQty > 0) - Number(a.availableQty > 0) ||
      (a.price ?? Infinity) - (b.price ?? Infinity)
    return { matches: products.filter(isMatch).sort(order), others: products.filter((p) => !isMatch(p)).sort(order) }
  }, [products, filter])
  const selected = products.find((p) => p.id === productId)

  const optionLabel = (p: Product) =>
    `${p.tireSize} · ${p.brand} ${p.model}${p.condition === 'used' ? ' (used)' : ''} · ` +
    `${p.price === null ? 'no price yet' : formatMoney(p.price)} · ` +
    (p.availableQty > 0
      ? `${p.availableQty} available`
      : p.stocked
        ? 'out of stock, will be ordered'
        : `special order${p.supplier ? ` from ${p.supplier}` : ''}`)

  // A catalog tire nobody has priced yet: take today's cost right here.
  const [todaysCost, setTodaysCost] = useState('')
  const [costError, setCostError] = useState<string | null>(null)
  const needsCost = !customerSupplied && selected !== undefined && selected.price === null

  async function saveCost() {
    setCostError(null)
    try {
      const { product } = await api.setProductCost(selected!.id, Number(todaysCost))
      setProducts((list) => list.map((p) => (p.id === product.id ? product : p)))
      setTodaysCost('')
    } catch (err) {
      setCostError(err instanceof Error ? err.message : 'Could not save the cost')
    }
  }

  const valid = Number(quantity) > 0 && !needsCost && (customerSupplied ? customerSize.trim() !== '' : productId !== '')

  function submit() {
    if (!valid) return
    const qty = Number(quantity)
    onSubmit({
      customerSuppliedTires: customerSupplied,
      tireProductId: customerSupplied ? null : productId || null,
      customerTireSize: customerSupplied ? customerSize : null,
      tireQuantity: qty,
      oldTiresRemoved: oldRemoved === '' ? qty : Number(oldRemoved),
      difficultyMinutes: difficulty === '' ? null : Number(difficulty),
    })
  }

  // The supplier tire form is its own form, so it replaces this one for a moment.
  if (addingSupplierTire) {
    return (
      <Modal open width={640} title="Tire from a supplier" onClose={() => setAddingSupplierTire(false)}>
        <ProductForm
          tireOnly
          title="Saved to the catalog as a special-order tire"
          preset={{ stocked: false, tireSize: filter.trim() || vehicleTireSize || '' }}
          onCancel={() => setAddingSupplierTire(false)}
          onSaved={(product) => {
            setProducts((current) => [...current, product])
            setProductId(product.id)
            setAddingSupplierTire(false)
          }}
        />
      </Modal>
    )
  }

  const options = (list: Product[]) =>
    list.map((p) => (
      <option key={p.id} value={p.id}>
        {optionLabel(p)}
      </option>
    ))

  return (
    <Modal
      open
      width={640}
      title={initial ? 'Edit tires' : 'Add tires'}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !valid}>
            {initial ? 'Update tires' : 'Add tires'}
          </Button>
        </>
      }
    >
      <fieldset className="ed-choices ed-choices-row">
        <legend className="visually-hidden">Whose tires</legend>
        <label className="ed-check">
          <input type="radio" checked={!customerSupplied} onChange={() => setCustomerSupplied(false)} />
          Selling tires (in stock or from a supplier)
        </label>
        <label className="ed-check">
          <input type="radio" checked={customerSupplied} onChange={() => setCustomerSupplied(true)} />
          Customer brought their own
        </label>
      </fieldset>

      <div className="ui-form-grid">
        {!customerSupplied && (
          <>
            <FormField label="Search size, brand or SKU">
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="225/65R17" />
            </FormField>
            <FormField label="Tire" required>
              <select value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">
                  {products.length === 0
                    ? 'No tires in the catalog yet'
                    : matches.length === 0
                      ? 'No match: pick from all tires, or add a supplier tire'
                      : 'Pick a tire…'}
                </option>
                {filter.trim() && matches.length > 0 && others.length > 0 ? (
                  <>
                    <optgroup label={`Matching "${filter.trim()}"`}>{options(matches)}</optgroup>
                    <optgroup label="Other tires">{options(others)}</optgroup>
                  </>
                ) : (
                  options([...matches, ...others])
                )}
              </select>
            </FormField>
            {needsCost && (
              <div className="ui-field-wide">
                <Alert tone="warning">
                  <div className="ed-pay-row">
                    <span>No price yet. Today’s cost each:</span>
                    <input
                      className="ed-input"
                      inputMode="decimal"
                      aria-label="Today's cost"
                      value={todaysCost}
                      onChange={(e) => setTodaysCost(e.target.value)}
                      placeholder="0.00"
                    />
                    <Button size="sm" variant="primary" disabled={!(Number(todaysCost) > 0)} onClick={() => void saveCost()}>
                      Save cost &amp; price it
                    </Button>
                  </div>
                  {costError && <div>{costError}</div>}
                </Alert>
              </div>
            )}
            {selected && selected.price !== null && !selected.stocked && selected.costUpdatedAt && (
              <p className="ed-muted ui-field-wide">
                {formatMoney(selected.price)} each, from a cost of {formatMoney(selected.cost)} entered {formatDate(selected.costUpdatedAt)}.
              </p>
            )}
            <p className="ed-muted ui-field-wide">
              {selected && selected.availableQty < Number(quantity || 0) && (
                <>
                  {selected.stocked
                    ? `Only ${Math.max(0, selected.availableQty)} on the shelf; the rest is ordered when the customer accepts.`
                    : `Ordered${selected.supplier ? ` from ${selected.supplier}` : ''} when the customer accepts. A deposit is required.`}{' '}
                </>
              )}
              <button type="button" className="ed-inline-link" onClick={() => setAddingSupplierTire(true)}>
                Tire not listed? Add one from a supplier
              </button>
            </p>
          </>
        )}

        {customerSupplied && (
          <FormField label="Size of the customer’s tires" required wide>
            <input value={customerSize} onChange={(e) => setCustomerSize(e.target.value)} placeholder="245/40R18" />
          </FormField>
        )}

        <FormField label="Number of tires" required>
          <input inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </FormField>
        <FormField label="Old tires removed" hint="For the disposal fee">
          <input
            inputMode="numeric"
            value={oldRemoved}
            onChange={(e) => setOldRemoved(e.target.value)}
            placeholder={`Same as tires (${quantity || 0})`}
          />
        </FormField>
        <FormField label="Difficulty (shop time)">
          <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
            <option value="">Automatic from tire size</option>
            <option value="0">Normal</option>
            <option value="10">+10 min</option>
            <option value="20">+20 min</option>
          </select>
        </FormField>
      </div>

      {loadError && <Alert tone="danger">{loadError}</Alert>}
    </Modal>
  )
}

export default TiresDialog
