import { useState } from 'react'
import { loadLevels, noFilters, type LoadLevel, type Season, type TireFilters, type TireType } from '../../../api'
import { Button, FormField } from '../../../ui'
import { seasonLabels, tireTypeLabels } from '../../inventory/tireSpec'

type Props = {
  // Brands the catalog has in this size (and its similar sizes).
  brands: string[]
  value: TireFilters
  onChange: (next: TireFilters) => void
}

const loadLabels: Record<LoadLevel, string> = {
  SL: 'Any',
  XL: 'XL or stronger',
  C: 'C (6-ply) or more',
  D: 'D (8-ply) or more',
  E: 'E (10-ply) or more',
  F: 'F (12-ply)',
}

// The column beside the cards. Each change refills the cards from what matches.
function CompareFilters({ brands, value, onChange }: Props) {
  const set = (patch: Partial<TireFilters>) => onChange({ ...value, ...patch })
  const active = JSON.stringify(value) !== JSON.stringify(noFilters)

  return (
    <div className="cmp-filters">
      <div className="cmp-filters-head">
        <h3 className="ed-section-title">Filters</h3>
        {active && (
          <Button size="sm" variant="ghost" onClick={() => onChange(noFilters)}>
            Clear
          </Button>
        )}
      </div>
      <BrandPicker brands={brands} value={value.brands} onChange={(next) => set({ brands: next })} />
      <label className="cmp-filter-check">
        <input type="checkbox" checked={value.roadHazard} onChange={(e) => set({ roadHazard: e.target.checked })} />
        Road hazard
      </label>
      <FormField label="Warranty">
        <select
          value={value.minWarranty ?? ''}
          onChange={(e) => set({ minWarranty: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">Any</option>
          {[40000, 50000, 60000, 70000].map((m) => (
            <option key={m} value={m}>
              {m / 1000}k+
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Season">
        <select value={value.season ?? ''} onChange={(e) => set({ season: (e.target.value || null) as Season | null })}>
          <option value="">Any</option>
          {(Object.keys(seasonLabels) as Season[]).map((s) => (
            <option key={s} value={s}>
              {seasonLabels[s]}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Type">
        <select
          value={value.tireType ?? ''}
          onChange={(e) => set({ tireType: (e.target.value || null) as TireType | null })}
        >
          <option value="">Any</option>
          {(Object.keys(tireTypeLabels) as TireType[]).map((t) => (
            <option key={t} value={t}>
              {tireTypeLabels[t]}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Load range">
        <select
          value={value.minLoad ?? 'SL'}
          onChange={(e) => set({ minLoad: e.target.value === 'SL' ? null : (e.target.value as LoadLevel) })}
        >
          {loadLevels.map((l) => (
            <option key={l} value={l}>
              {loadLabels[l]}
            </option>
          ))}
        </select>
      </FormField>
      <MaxPrice value={value.maxPrice} onChange={(maxPrice) => set({ maxPrice })} />
    </div>
  )
}

// Type a few letters, pick a brand; picked brands show as tags with ×.
// Enter takes the first suggestion.
function BrandPicker({ brands, value, onChange }: { brands: string[]; value: string[]; onChange: (next: string[]) => void }) {
  const [search, setSearch] = useState('')
  const term = search.trim().toLowerCase()
  const suggestions = term
    ? brands.filter((b) => b.toLowerCase().includes(term) && !value.includes(b)).slice(0, 8)
    : []
  const add = (brand: string) => {
    onChange([...value, brand])
    setSearch('')
  }
  return (
    <FormField label="Brand" hint={brands.length ? `${brands.length} in this size` : undefined}>
      <div className="cmp-brand-picker">
        <input
          className="cmp-brand-search"
          placeholder="Type a brand"
          aria-label="Find a brand"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && suggestions[0]) {
              e.preventDefault()
              add(suggestions[0])
            }
            if (e.key === 'Escape') setSearch('')
          }}
        />
        {suggestions.length > 0 && (
          <ul className="cmp-brand-suggestions" role="listbox" aria-label="Brands">
            {suggestions.map((b) => (
              <li key={b}>
                <button type="button" onClick={() => add(b)}>
                  {b}
                </button>
              </li>
            ))}
          </ul>
        )}
        {term && suggestions.length === 0 && <p className="cmp-muted">No brand matches “{search.trim()}” in this size.</p>}
        {value.length > 0 && (
          <span className="cmp-brand-tags">
            {value.map((b) => (
              <span key={b} className="cmp-brand-tag">
                {b}
                <button type="button" aria-label={`Remove ${b}`} onClick={() => onChange(value.filter((x) => x !== b))}>
                  ×
                </button>
              </span>
            ))}
          </span>
        )}
      </div>
    </FormField>
  )
}

// Applied on Enter or leaving the box, not on every key.
function MaxPrice({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const [draft, setDraft] = useState(value === null ? '' : String(value))
  const [shown, setShown] = useState(value)
  // Cleared from outside (Clear): show it empty again.
  if (shown !== value) {
    setShown(value)
    setDraft(value === null ? '' : String(value))
  }
  const apply = () => {
    const n = Number(draft)
    const next = draft.trim() && n > 0 ? n : null
    if (next !== value) onChange(next)
  }
  return (
    <FormField label="Max per tire">
      <input
        inputMode="decimal"
        placeholder="$"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => {
          if (e.key === 'Enter') apply()
        }}
      />
    </FormField>
  )
}

export default CompareFilters
