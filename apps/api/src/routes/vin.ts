// Optional VIN decoding through NHTSA's free vPIC service
// (https://vpic.nhtsa.dot.gov/api/). It identifies the vehicle but has no tire
// sizes. Results are only suggestions: the screen fills empty fields after the
// advisor accepts them, and nothing depends on this service being reachable.
import { Router } from 'express'
import { ConflictError, ValidationError } from '../validation.js'

export const vinRouter = Router()

export type VinSuggestion = {
  year: number | null
  make: string | null
  model: string | null
  trim: string | null
  vehicleClass: 'car' | 'truck' | null
  driveType: '2wd' | 'awd' | '4wd' | null
  isEv: boolean
  heavyDuty: boolean
  // What vPIC said about the decode, e.g. a bad check digit.
  warning: string | null
  // The raw values the suggestions came from, shown so the advisor can judge.
  source: { driveType: string | null; fuelType: string | null; gvwr: string | null; vehicleType: string | null }
}

const blank = (v: unknown) => (typeof v === 'string' && v.trim() !== '' && v !== 'Not Applicable' ? v.trim() : null)

// "FORD" -> "Ford", "MERCEDES-BENZ" -> "Mercedes-Benz"; short ones stay (BMW, GMC).
function titleCase(make: string) {
  if (make.length <= 3) return make
  return make.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase())
}

export function driveTypeFrom(value: string | null): VinSuggestion['driveType'] {
  if (!value) return null
  if (/awd|all[- ]wheel/i.test(value)) return 'awd'
  if (/4wd|4x4|4-wheel|four[- ]wheel/i.test(value)) return '4wd'
  if (/fwd|rwd|4x2|2wd|front[- ]wheel|rear[- ]wheel/i.test(value)) return '2wd'
  return null
}

// GVWR "Class 2H: 9,001 - 10,000 lb" and up is a 3/4-ton truck or heavier
// (F-250, 2500, Sprinter...), where load range matters.
export function heavyDutyFrom(gvwr: string | null) {
  const m = gvwr?.match(/Class\s*(\d)([A-Z])?/i)
  if (!m) return false
  const n = Number(m[1])
  return n >= 3 || (n === 2 && (m[2] ?? '').toUpperCase() >= 'H')
}

// Turn one vPIC DecodeVinValues result into suggestions for the vehicle form.
export function suggestionFromVpic(r: Record<string, unknown>): VinSuggestion {
  const year = Number(blank(r.ModelYear))
  const make = blank(r.Make)
  const fuel = [blank(r.FuelTypePrimary), blank(r.FuelTypeSecondary)].filter(Boolean).join(' / ') || null
  const electrification = blank(r.ElectrificationLevel)
  const vehicleType = blank(r.VehicleType)
  const errorCode = blank(r.ErrorCode) ?? '0'
  return {
    year: Number.isInteger(year) && year > 1900 ? year : null,
    make: make ? titleCase(make) : null,
    model: blank(r.Model),
    // Only the real trim field: vPIC's "Series" is often a family name
    // ("F-Series Super Duty - Single Rear Wheel"), not what the advisor means.
    trim: blank(r.Trim),
    vehicleClass: vehicleType === 'TRUCK' ? 'truck' : vehicleType === 'PASSENGER CAR' ? 'car' : null,
    driveType: driveTypeFrom(blank(r.DriveType)),
    // Battery electric only; hybrids run on ordinary tires.
    isEv: /^electric$/i.test(blank(r.FuelTypePrimary) ?? '') || /BEV/.test(electrification ?? ''),
    heavyDuty: heavyDutyFrom(blank(r.GVWR)),
    warning: errorCode.split(',').every((c) => c.trim() === '0') ? null : blank(r.ErrorText),
    source: { driveType: blank(r.DriveType), fuelType: fuel, gvwr: blank(r.GVWR), vehicleType },
  }
}

vinRouter.get('/:vin', async (req, res) => {
  const vin = String(req.params.vin ?? '').toUpperCase().replace(/\s+/g, '')
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
    throw new ValidationError('A VIN is 17 letters and numbers (never I, O or Q)')
  }

  let data: { Results?: Record<string, unknown>[] }
  try {
    const response = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`,
      { signal: AbortSignal.timeout(8000) },
    )
    if (!response.ok) throw new Error(`vPIC answered ${response.status}`)
    data = await response.json()
  } catch {
    throw new ConflictError('The VIN lookup service could not be reached. Enter the vehicle by hand.')
  }

  const result = data.Results?.[0]
  const suggestion = result ? suggestionFromVpic(result) : null
  if (!suggestion || (!suggestion.make && !suggestion.model)) {
    throw new ConflictError('That VIN was not recognized. Check it, or enter the vehicle by hand.')
  }
  res.json({ suggestion })
})
