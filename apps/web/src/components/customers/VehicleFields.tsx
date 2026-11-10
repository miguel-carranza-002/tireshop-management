import { useState } from 'react'
import { api, type DriveType, type VehicleInput, type VinSuggestion } from '../../api'
import { Alert, Button, FormField } from '../../ui'
import { driveTypeLabels } from './vehicleDraft'
import './VehicleFields.css'

type Props = {
  value: VehicleInput
  onChange: (patch: Partial<VehicleInput>) => void
  autoFocus?: boolean
}

type Fill = { key: keyof VehicleInput; label: string; value: string | boolean; display: string; replaces: boolean }

// Which suggestions to offer: blank fields are ticked; anything that would
// change what's already there starts unticked. Nothing is applied until the
// advisor says so.
function fillsFrom(s: VinSuggestion, v: VehicleInput): Fill[] {
  const fills: Fill[] = []
  const add = (key: keyof VehicleInput, label: string, value: string | boolean | null, current: string | boolean, empty: boolean) => {
    if (value === null || value === '' || value === current) return
    fills.push({ key, label, value, display: typeof value === 'boolean' ? 'yes' : value, replaces: !empty })
  }
  add('year', 'Year', s.year ? String(s.year) : null, v.year, v.year.trim() === '')
  add('make', 'Make', s.make, v.make, v.make.trim() === '')
  add('model', 'Model', s.model, v.model, v.model.trim() === '')
  add('trim', 'Trim', s.trim, v.trim, v.trim.trim() === '')
  // On a vehicle nobody has typed into yet, "car" is just the form's default.
  const untouched = !v.year.trim() && !v.make.trim() && !v.model.trim()
  add('vehicleClass', 'Car or truck', s.vehicleClass, v.vehicleClass, untouched)
  add('driveType', 'Drive type', s.driveType, v.driveType, v.driveType === 'unknown')
  if (s.isEv && !v.isEv) add('isEv', 'Electric vehicle', true, false, true)
  if (s.heavyDuty && !v.heavyDuty) add('heavyDuty', 'Heavy-duty truck', true, false, true)
  return fills
}

// Every vehicle field, shared by the Customers page and the New quote dialog.
function VehicleFields({ value: v, onChange, autoFocus }: Props) {
  const [decoding, setDecoding] = useState(false)
  const [decodeError, setDecodeError] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<{ s: VinSuggestion; fills: Fill[]; picked: Set<string> } | null>(null)

  const special = v.isEv || v.heavyDuty || v.runFlat
  const vinReady = /^[A-HJ-NPR-Z0-9]{17}$/i.test(v.vin.trim())

  async function decode() {
    setDecoding(true)
    setDecodeError(null)
    setSuggestion(null)
    try {
      const { suggestion: s } = await api.decodeVin(v.vin)
      const fills = fillsFrom(s, v)
      setSuggestion({ s, fills, picked: new Set(fills.filter((f) => !f.replaces).map((f) => f.key)) })
    } catch (err) {
      setDecodeError(err instanceof Error ? err.message : 'Could not decode the VIN')
    } finally {
      setDecoding(false)
    }
  }

  function apply() {
    if (!suggestion) return
    const patch: Partial<VehicleInput> = {}
    for (const f of suggestion.fills) {
      if (suggestion.picked.has(f.key)) Object.assign(patch, { [f.key]: f.value })
    }
    onChange(patch)
    setSuggestion(null)
  }

  const text = (key: keyof VehicleInput) => ({
    value: v[key] as string,
    onChange: (e: { target: { value: string } }) => onChange({ [key]: e.target.value }),
  })
  const check = (key: keyof VehicleInput) => ({
    type: 'checkbox' as const,
    checked: v[key] as boolean,
    onChange: (e: { target: { checked: boolean } }) => onChange({ [key]: e.target.checked }),
  })

  return (
    <div className="vf">
      <div className="ui-form-grid">
        <FormField label="VIN" hint="Optional. Decode fills in blank fields from the free NHTSA database (no tire sizes)." wide>
          <span className="vf-vin">
            <input {...text('vin')} maxLength={17} placeholder="17 characters" autoComplete="off" />
            <Button disabled={!vinReady || decoding} onClick={() => void decode()}>
              {decoding ? 'Decoding…' : 'Decode VIN'}
            </Button>
          </span>
        </FormField>

        {decodeError && (
          <div className="ui-field-wide">
            <Alert tone="warning">{decodeError}</Alert>
          </div>
        )}

        {suggestion && (
          <div className="vf-suggest ui-field-wide">
            <p className="vf-suggest-title">From the VIN</p>
            {suggestion.s.warning && <p className="vf-muted">Decoder note: {suggestion.s.warning}</p>}
            {suggestion.fills.length === 0 ? (
              <p className="vf-muted">Nothing new: everything it knows is already filled in.</p>
            ) : (
              <ul className="vf-fills">
                {suggestion.fills.map((f) => (
                  <li key={f.key}>
                    <label>
                      <input
                        type="checkbox"
                        checked={suggestion.picked.has(f.key)}
                        onChange={(e) => {
                          const picked = new Set(suggestion.picked)
                          if (e.target.checked) picked.add(f.key)
                          else picked.delete(f.key)
                          setSuggestion({ ...suggestion, picked })
                        }}
                      />
                      {f.label}: <strong>{f.key === 'driveType' ? driveTypeLabels[f.value as DriveType] : f.display}</strong>
                      {f.replaces && <span className="vf-muted"> (replaces {String(v[f.key])})</span>}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <p className="vf-muted">
              {[suggestion.s.source.driveType && `Drive: ${suggestion.s.source.driveType}`, suggestion.s.source.fuelType && `Fuel: ${suggestion.s.source.fuelType}`, suggestion.s.source.gvwr && `GVWR: ${suggestion.s.source.gvwr}`]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <div className="vf-suggest-actions">
              <Button size="sm" variant="ghost" onClick={() => setSuggestion(null)}>
                Ignore
              </Button>
              {suggestion.fills.length > 0 && (
                <Button size="sm" variant="primary" disabled={suggestion.picked.size === 0} onClick={apply}>
                  Apply {suggestion.picked.size} selected
                </Button>
              )}
            </div>
          </div>
        )}

        <FormField label="Year" required>
          <input {...text('year')} inputMode="numeric" maxLength={4} autoFocus={autoFocus} />
        </FormField>
        <FormField label="Make" required>
          <input {...text('make')} />
        </FormField>
        <FormField label="Model" required>
          <input {...text('model')} />
        </FormField>
        <FormField label="Trim" hint="Trims can differ in wheel and tire size">
          <input {...text('trim')} placeholder="e.g. XLT, Limited" />
        </FormField>
        <FormField label="Car or truck" hint="Sets alignment and tire service prices">
          <select value={v.vehicleClass} onChange={(e) => onChange({ vehicleClass: e.target.value as 'car' | 'truck' })}>
            <option value="car">Car</option>
            <option value="truck">Truck / SUV priced as truck</option>
          </select>
        </FormField>
        <FormField label="Drive type">
          <select value={v.driveType} onChange={(e) => onChange({ driveType: e.target.value as DriveType })}>
            {(Object.keys(driveTypeLabels) as DriveType[]).map((d) => (
              <option key={d} value={d}>
                {driveTypeLabels[d]}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Tire size" hint="Front size if front and rear differ">
          <input {...text('tireSize')} placeholder="225/65R17" />
        </FormField>
        <FormField label="Rear tire size" hint="Only if different (staggered)">
          <input {...text('rearTireSize')} placeholder="Same as front" />
        </FormField>
        <FormField label="License plate">
          <input {...text('licensePlate')} />
        </FormField>
        <div className="vf-checks">
          <label>
            <input {...check('liftedLowered')} /> Lifted / lowered
          </label>
          <label>
            <input {...check('multiLinkSuspension')} /> Luxury / multi-link suspension
          </label>
        </div>
      </div>

      <fieldset className="vf-special">
        <legend>Special tire needs</legend>
        <p className="vf-muted">Only for vehicles where load and speed matter. Leave all off for most cars and trucks.</p>
        <div className="vf-checks">
          <label>
            <input {...check('isEv')} /> Electric vehicle
          </label>
          <label>
            <input {...check('heavyDuty')} /> Heavy-duty truck (¾ ton and up)
          </label>
          <label>
            <input {...check('runFlat')} /> Came with run-flats
          </label>
        </div>
        {special && (
          <div className="ui-form-grid vf-required">
            <FormField label="Required load index" hint="From the door placard or old tire">
              <input {...text('requiredLoadIndex')} inputMode="numeric" placeholder="e.g. 102" />
            </FormField>
            <FormField label="Required speed rating">
              <input {...text('requiredSpeedRating')} maxLength={1} placeholder="e.g. H" />
            </FormField>
            {(v.heavyDuty || v.vehicleClass === 'truck') && (
              <FormField label="Required load range" hint="LT tires: C, D, E…">
                <input {...text('requiredLoadRange')} maxLength={1} placeholder="e.g. E" />
              </FormField>
            )}
          </div>
        )}
      </fieldset>
    </div>
  )
}

export default VehicleFields
