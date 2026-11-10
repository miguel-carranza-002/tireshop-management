import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  api,
  formatMoney,
  tirePriceFromCost,
  type Product,
  type ProductInput,
  type Season,
  type ShopSettings,
  type TireLine,
  type TireType,
} from '../../api'
import { Alert, Button, FormField, InputAffix } from '../../ui'
import { parseSidewall, seasonLabels, tireTypeLabels } from './tireSpec'
import './ProductForm.css'

type Props = {
  initial?: Product
  // Starting values for a new product, e.g. a supplier tire from the quote screen.
  preset?: Partial<Pick<ProductInput, 'stocked' | 'tireSize' | 'brand' | 'model' | 'supplier'>>
  // Only tires (the quote's tire dialog); hides the product type choice.
  tireOnly?: boolean
  title?: string
  onSaved: (product: Product) => void
  onCancel: () => void
}

type Draft = {
  productType: 'tire' | 'tpms_sensor'
  sku: string
  brand: string
  model: string
  tireSize: string
  loadIndex: string
  loadIndexDual: string
  speedRating: string
  loadRange: string
  extraLoad: boolean
  sizeAlt: string
  treadDepth32nds: string
  utqgTreadwear: string
  utqgTraction: string
  utqgTemperature: string
  maxLoadLbs: string
  maxLoadPsi: string
  sidewall: string
  sizeWarrantyMiles: string
  cost: string
  price: string
  condition: 'new' | 'used'
  stocked: boolean
  minQty: string
  initialQty: string
  supplier: string
  tireClassOverride: 'car' | 'truck' | null
  // Tire line (shared by every size of the brand + model)
  tireType: TireType | ''
  season: Season | ''
  warrantyMiles: string
  roadHazard: boolean
  runFlat: boolean
  evRated: boolean
  severeSnow: boolean
}

const str = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n))

function toDraft(p?: Product, preset?: Props['preset']): Draft {
  return {
    productType: p?.productType ?? 'tire',
    sku: p?.sku ?? '',
    brand: p?.brand ?? preset?.brand ?? '',
    model: p?.model ?? preset?.model ?? '',
    tireSize: p?.tireSize ?? preset?.tireSize ?? '',
    loadIndex: str(p?.loadIndex),
    loadIndexDual: str(p?.loadIndexDual),
    speedRating: p?.speedRating ?? '',
    loadRange: p?.loadRange ?? '',
    extraLoad: p?.extraLoad ?? false,
    sizeAlt: p?.sizeAlt ?? '',
    treadDepth32nds: str(p?.treadDepth32nds),
    utqgTreadwear: str(p?.utqgTreadwear),
    utqgTraction: p?.utqgTraction ?? '',
    utqgTemperature: p?.utqgTemperature ?? '',
    maxLoadLbs: str(p?.maxLoadLbs),
    maxLoadPsi: str(p?.maxLoadPsi),
    sidewall: p?.sidewall ?? '',
    sizeWarrantyMiles: str(p?.sizeWarrantyMiles),
    cost: str(p?.cost),
    price: str(p?.price),
    condition: p?.condition ?? 'new',
    stocked: p?.stocked ?? preset?.stocked ?? true,
    minQty: p ? String(p.minQty) : '',
    initialQty: '',
    supplier: p?.supplier ?? preset?.supplier ?? '',
    tireClassOverride: p?.tireClassOverride ?? null,
    tireType: p?.tireType ?? '',
    season: p?.season ?? '',
    warrantyMiles: str(p?.lineWarrantyMiles),
    roadHazard: p?.roadHazard ?? false,
    runFlat: p?.runFlat ?? false,
    evRated: p?.evRated ?? false,
    severeSnow: p?.severeSnow ?? false,
  }
}

const num = (s: string) => (s.trim() === '' ? null : Number(s))
const sameLine = (l: TireLine, brand: string, model: string) =>
  l.brand.toLowerCase() === brand.trim().toLowerCase() && l.model.toLowerCase() === model.trim().toLowerCase()

function ProductForm({ initial, preset, tireOnly, title, onSaved, onCancel }: Props) {
  const [d, setD] = useState<Draft>(() => toDraft(initial, preset))
  const [lines, setLines] = useState<TireLine[]>([])
  const [settings, setSettings] = useState<ShopSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The line whose details were last filled in, so typing doesn't refill them.
  const [filledFrom, setFilledFrom] = useState<string | null>(initial?.tireLineId ?? null)

  useEffect(() => {
    const controller = new AbortController()
    api.listTireLines(controller.signal).then((r) => setLines(r.lines)).catch(() => {})
    api.getSettings(controller.signal).then((r) => setSettings(r.settings)).catch(() => {})
    return () => controller.abort()
  }, [])

  const isTire = d.productType === 'tire'
  const line = useMemo(() => lines.find((l) => sameLine(l, d.brand, d.model)), [lines, d.brand, d.model])
  const otherSizes = line ? line.sizeCount - (initial?.tireLineId === line.id ? 1 : 0) : 0
  const keepsMinimum = d.stocked && d.condition === 'new'

  function set(patch: Partial<Draft>) {
    const next = { ...d, ...patch }
    // A new size of a tire line we already have: bring in its details once.
    const match = lines.find((l) => sameLine(l, next.brand, next.model))
    if (match && match.id !== filledFrom) {
      setFilledFrom(match.id)
      setD({
        ...next,
        tireType: match.tireType ?? '',
        season: match.season ?? '',
        warrantyMiles: str(match.warrantyMiles),
        roadHazard: match.roadHazard,
        runFlat: match.runFlat,
        evRated: match.evRated,
        severeSnow: match.severeSnow,
      })
      return
    }
    setD(next)
  }

  // A full sidewall string fills the spec fields it contains.
  function readSize() {
    const s = parseSidewall(d.tireSize)
    if (!s.size) return
    set({
      tireSize: s.size,
      ...(s.loadIndex && { loadIndex: String(s.loadIndex) }),
      ...(s.loadIndexDual && { loadIndexDual: String(s.loadIndexDual) }),
      ...(s.speedRating && { speedRating: s.speedRating }),
      ...(s.loadRange && { loadRange: s.loadRange }),
      ...(s.extraLoad && { extraLoad: true }),
    })
  }

  const suggested = settings && num(d.cost) !== null ? tirePriceFromCost(settings, num(d.cost)!) : null

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    // Saving straight after pasting a sidewall string (Enter, no blur): read
    // it now, filling only spec fields that are still empty.
    const s = isTire ? parseSidewall(d.tireSize) : {}
    const input: ProductInput & { initialQty?: number } = {
      productType: d.productType,
      sku: d.sku,
      brand: d.brand,
      model: d.model,
      tireSize: isTire ? (s.size ?? d.tireSize) : '',
      loadIndex: isTire ? (num(d.loadIndex) ?? s.loadIndex ?? null) : null,
      loadIndexDual: isTire ? (num(d.loadIndexDual) ?? s.loadIndexDual ?? null) : null,
      speedRating: isTire ? d.speedRating || (s.speedRating ?? '') : '',
      loadRange: isTire ? d.loadRange || (s.loadRange ?? '') : '',
      extraLoad: isTire && (d.extraLoad || !!s.extraLoad),
      sizeAlt: isTire ? d.sizeAlt.trim() || null : null,
      treadDepth32nds: isTire ? num(d.treadDepth32nds) : null,
      utqgTreadwear: isTire ? num(d.utqgTreadwear) : null,
      utqgTraction: isTire ? d.utqgTraction.trim() || null : null,
      utqgTemperature: isTire ? d.utqgTemperature.trim() || null : null,
      maxLoadLbs: isTire ? num(d.maxLoadLbs) : null,
      maxLoadPsi: isTire ? num(d.maxLoadPsi) : null,
      sidewall: isTire ? d.sidewall.trim() || null : null,
      sizeWarrantyMiles: isTire ? num(d.sizeWarrantyMiles) : null,
      cost: num(d.cost),
      price: num(d.price),
      condition: d.condition,
      stocked: d.stocked,
      minQty: keepsMinimum ? Number(d.minQty || 0) : 0,
      supplier: d.supplier,
      tireClassOverride: d.tireClassOverride,
      initialQty: initial || !d.stocked ? undefined : Number(d.initialQty || 0),
      line: isTire
        ? {
            tireType: d.tireType,
            season: d.season,
            warrantyMiles: num(d.warrantyMiles),
            roadHazard: d.roadHazard,
            runFlat: d.runFlat,
            evRated: d.evRated,
            severeSnow: d.severeSnow,
            // Line notes are edited on the tire line; keep them as they are.
            notes: line?.notes ?? '',
          }
        : undefined,
    }
    try {
      const { product } = initial ? await api.updateProduct(initial.id, input) : await api.createProduct(input)
      onSaved(product)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save product')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="pf" onSubmit={handleSubmit}>
      {title !== '' && <h3 className="pf-title">{title ?? (initial ? 'Edit product' : 'New product')}</h3>}

      <section className="pf-section">
        <div className="ui-form-grid pf-grid-3">
          {!tireOnly && (
            <FormField label="Type">
              <select value={d.productType} onChange={(e) => set({ productType: e.target.value as Draft['productType'] })}>
                <option value="tire">Tire</option>
                <option value="tpms_sensor">TPMS sensor</option>
              </select>
            </FormField>
          )}
          <FormField label="Brand" required>
            <input value={d.brand} onChange={(e) => set({ brand: e.target.value })} list="pf-brands" />
          </FormField>
          <FormField label="Model" required>
            <input value={d.model} onChange={(e) => set({ model: e.target.value })} list="pf-models" />
          </FormField>
          {isTire && (
            <FormField label="Size" required hint="Or paste the sidewall: LT265/70R17 121/118S E">
              <input value={d.tireSize} onChange={(e) => set({ tireSize: e.target.value })} onBlur={readSize} placeholder="225/65R17" />
            </FormField>
          )}
        </div>
        <datalist id="pf-brands">
          {[...new Set(lines.map((l) => l.brand))].map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
        <datalist id="pf-models">
          {lines
            .filter((l) => !d.brand.trim() || l.brand.toLowerCase() === d.brand.trim().toLowerCase())
            .map((l) => (
              <option key={l.id} value={l.model} />
            ))}
        </datalist>
      </section>

      {isTire && (
        <section className="pf-section">
          <h4 className="pf-heading">This size</h4>
          <div className="ui-form-grid pf-grid-5">
            <FormField label="Load index">
              <input inputMode="numeric" value={d.loadIndex} onChange={(e) => set({ loadIndex: e.target.value })} placeholder="102" />
            </FormField>
            <FormField label="Second load index" hint="LT dual rating">
              <input inputMode="numeric" value={d.loadIndexDual} onChange={(e) => set({ loadIndexDual: e.target.value })} placeholder="118" />
            </FormField>
            <FormField label="Speed rating">
              <input maxLength={1} value={d.speedRating} onChange={(e) => set({ speedRating: e.target.value.toUpperCase() })} placeholder="H" />
            </FormField>
            <FormField label="Load range" hint="LT tires">
              <input maxLength={1} value={d.loadRange} onChange={(e) => set({ loadRange: e.target.value.toUpperCase() })} placeholder="E" />
            </FormField>
            <label className="pf-check pf-check-field">
              <input type="checkbox" checked={d.extraLoad} onChange={(e) => set({ extraLoad: e.target.checked })} /> XL / reinforced
            </label>
            <FormField label="Tread depth" hint="When new">
              <InputAffix suffix="/32" inputMode="numeric" value={d.treadDepth32nds} onChange={(e) => set({ treadDepth32nds: e.target.value })} placeholder="10" />
            </FormField>
            <FormField label="UTQG treadwear">
              <input inputMode="numeric" value={d.utqgTreadwear} onChange={(e) => set({ utqgTreadwear: e.target.value })} placeholder="540" />
            </FormField>
            <FormField label="Traction · temp" hint="e.g. A · B">
              <span className="pf-pair">
                <input aria-label="UTQG traction" maxLength={2} value={d.utqgTraction} onChange={(e) => set({ utqgTraction: e.target.value.toUpperCase() })} placeholder="A" />
                <input aria-label="UTQG temperature" maxLength={1} value={d.utqgTemperature} onChange={(e) => set({ utqgTemperature: e.target.value.toUpperCase() })} placeholder="B" />
              </span>
            </FormField>
            <FormField label="Max load" hint="Per tire, at pressure">
              <span className="pf-pair">
                <InputAffix suffix="lb" inputMode="numeric" value={d.maxLoadLbs} onChange={(e) => set({ maxLoadLbs: e.target.value })} placeholder="1874" />
                <InputAffix suffix="psi" inputMode="numeric" value={d.maxLoadPsi} onChange={(e) => set({ maxLoadPsi: e.target.value })} placeholder="50" />
              </span>
            </FormField>
            <FormField label="Sidewall" hint="BW, ROBL, RWL…">
              <input value={d.sidewall} onChange={(e) => set({ sidewall: e.target.value.toUpperCase() })} />
            </FormField>
            <FormField label="Warranty, this size" hint="Only if different from the line">
              <InputAffix suffix="miles" inputMode="numeric" value={d.sizeWarrantyMiles} onChange={(e) => set({ sizeWarrantyMiles: e.target.value })} />
            </FormField>
            <FormField label="Other size name" hint="e.g. 33X12.50R20LT">
              <input value={d.sizeAlt} onChange={(e) => set({ sizeAlt: e.target.value.toUpperCase() })} />
            </FormField>
          </div>
        </section>
      )}

      {isTire && (
        <section className="pf-section">
          <h4 className="pf-heading">
            Tire line
            <span className="pf-note">
              {line && otherSizes > 0
                ? ` · shared with ${otherSizes} other size${otherSizes === 1 ? '' : 's'} of ${line.brand} ${line.model}`
                : ' · shared by every size of this brand and model'}
            </span>
          </h4>
          <div className="ui-form-grid pf-grid-3">
            <FormField label="Type">
              <select value={d.tireType} onChange={(e) => set({ tireType: e.target.value as TireType | '' })}>
                <option value="">Not set</option>
                {(Object.keys(tireTypeLabels) as TireType[]).map((t) => (
                  <option key={t} value={t}>
                    {tireTypeLabels[t]}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Season">
              <select value={d.season} onChange={(e) => set({ season: e.target.value as Season | '' })}>
                <option value="">Not set</option>
                {(Object.keys(seasonLabels) as Season[]).map((s) => (
                  <option key={s} value={s}>
                    {seasonLabels[s]}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Warranty">
              <InputAffix suffix="miles" inputMode="numeric" value={d.warrantyMiles} onChange={(e) => set({ warrantyMiles: e.target.value })} placeholder="60000" />
            </FormField>
            <div className="pf-checks">
              <label className="pf-check">
                <input type="checkbox" checked={d.roadHazard} onChange={(e) => set({ roadHazard: e.target.checked })} /> Road hazard included
              </label>
              <label className="pf-check">
                <input type="checkbox" checked={d.severeSnow} onChange={(e) => set({ severeSnow: e.target.checked })} /> Severe snow (3PMSF)
              </label>
              <label className="pf-check">
                <input type="checkbox" checked={d.runFlat} onChange={(e) => set({ runFlat: e.target.checked })} /> Run-flat
              </label>
              <label className="pf-check">
                <input type="checkbox" checked={d.evRated} onChange={(e) => set({ evRated: e.target.checked })} /> EV-rated
              </label>
            </div>
          </div>
        </section>
      )}

      <section className="pf-section">
        <h4 className="pf-heading">Price &amp; stock</h4>
        <label className="pf-check">
          <input type="checkbox" checked={d.stocked} onChange={(e) => set({ stocked: e.target.checked })} />
          We keep this on the shelf <span className="pf-note">(uncheck for a tire bought from a supplier when a customer wants it)</span>
        </label>
        <div className="ui-form-grid pf-grid-3">
          <FormField label="Our cost" required={d.stocked} hint={d.stocked ? undefined : 'Optional: can be entered when quoting'}>
            <InputAffix prefix="$" inputMode="decimal" value={d.cost} onChange={(e) => set({ cost: e.target.value })} />
          </FormField>
          <FormField
            label="Price to customer (each)"
            required={d.stocked}
            hint={
              suggested !== null && (
                <>
                  Markup gives {formatMoney(suggested)}{' '}
                  <button type="button" className="pf-link" onClick={() => set({ price: suggested.toFixed(2) })}>
                    use it
                  </button>
                </>
              )
            }
          >
            <InputAffix prefix="$" inputMode="decimal" value={d.price} onChange={(e) => set({ price: e.target.value })} />
          </FormField>
          <FormField label="Supplier">
            <input value={d.supplier} onChange={(e) => set({ supplier: e.target.value })} placeholder="e.g. ATD, Tire Rack" />
          </FormField>
          {isTire && (
            <FormField label="Condition">
              <select value={d.condition} onChange={(e) => set({ condition: e.target.value as Draft['condition'] })}>
                <option value="new">New</option>
                <option value="used">Used</option>
              </select>
            </FormField>
          )}
          {keepsMinimum && (
            <FormField label="Minimum to keep on hand" hint="0 = no low-stock alert">
              <input inputMode="numeric" value={d.minQty} onChange={(e) => set({ minQty: e.target.value })} />
            </FormField>
          )}
          {!initial && d.stocked && (
            <FormField label="On the shelf right now">
              <input inputMode="numeric" value={d.initialQty} onChange={(e) => set({ initialQty: e.target.value })} placeholder="0" />
            </FormField>
          )}
          {isTire && (
            <FormField label="Car or truck tire">
              <select
                value={d.tireClassOverride ?? ''}
                onChange={(e) => set({ tireClassOverride: (e.target.value || null) as Draft['tireClassOverride'] })}
              >
                <option value="">Automatic from size</option>
                <option value="car">Car</option>
                <option value="truck">Truck</option>
              </select>
            </FormField>
          )}
          <FormField label="SKU" hint="Made from brand, model and size if blank">
            <input value={d.sku} onChange={(e) => set({ sku: e.target.value })} />
          </FormField>
        </div>
      </section>

      {error && <Alert tone="danger">{error}</Alert>}

      <div className="pf-actions">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? 'Saving…' : initial ? 'Save product' : 'Add product'}
        </Button>
      </div>
    </form>
  )
}

export default ProductForm
