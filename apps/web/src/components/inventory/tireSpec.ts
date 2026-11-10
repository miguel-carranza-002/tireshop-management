import type { Season, TireType } from '../../api'

export type SidewallSpec = {
  size?: string
  loadIndex?: number
  loadIndexDual?: number
  speedRating?: string
  loadRange?: string
  extraLoad?: boolean
}

// Read what a sidewall-style string says: "LT265/70R17 121/118S E",
// "225/65R17 102H", "245/40ZR18 97Y XL", "35x12.50R20 121Q". Only the parts
// that are there come back; nothing is guessed.
export function parseSidewall(text: string): SidewallSpec {
  const t = text.toUpperCase().replace(/\s+/g, ' ').trim()
  const spec: SidewallSpec = {}

  const size = t.match(/(?:P|LT|ST|T)?\s?\d{3}\/\d{2}\s?Z?R\s?\d{2}(?:\.\d)?|\d{2}(?:\.\d+)?X\d{1,2}(?:\.\d+)?\s?R\s?\d{2}/)
  if (!size) return spec
  spec.size = size[0].replace(/\s+/g, '')

  const rest = t.slice((size.index ?? 0) + size[0].length)
  const loadSpeed = rest.match(/\b(\d{2,3})(?:\/(\d{2,3}))?\s?([LMNPQRSTUHVWYZ])\b/)
  if (loadSpeed) {
    spec.loadIndex = Number(loadSpeed[1])
    if (loadSpeed[2]) spec.loadIndexDual = Number(loadSpeed[2])
    spec.speedRating = loadSpeed[3]
  }
  if (/\b(XL|RF|REINFORCED|EXTRA LOAD)\b/.test(rest)) spec.extraLoad = true
  const range = rest.match(/\b(?:LR|LOAD RANGE)\s?([B-H])\b/) ?? rest.match(/(?:^|\s)([C-F])(?:\s|$)/)
  if (range) spec.loadRange = range[1]
  return spec
}

export const seasonLabels: Record<Season, string> = {
  all_season: 'All-season',
  all_weather: 'All-weather',
  summer: 'Summer',
  winter: 'Winter',
}

export const tireTypeLabels: Record<TireType, string> = {
  touring: 'Touring',
  performance: 'Performance',
  highway: 'Highway',
  all_terrain: 'All-terrain',
  rugged_terrain: 'Rugged-terrain',
  mud_terrain: 'Mud-terrain',
}

// "Performance · All-weather"
export function kindLabel(p: { tireType: TireType | null; season: Season | null }) {
  return [p.tireType && tireTypeLabels[p.tireType], p.season && seasonLabels[p.season]].filter(Boolean).join(' · ')
}

// Supplier sidewall codes we know; anything else shows as written.
const sidewallNames: Record<string, string> = {
  BW: 'Blackwall',
  BSW: 'Blackwall',
  BLK: 'Blackwall',
  ROBL: 'Raised outline black letters',
  RBL: 'Raised black letters',
  RWL: 'Raised white letters',
  OWL: 'Outline white letters',
  VSB: 'Vertical serrated band',
  WSW: 'Whitewall',
}
export const sidewallLabel = (code: string | null) => (code ? (sidewallNames[code] ?? code) : null)

export function warrantyLabel(miles: number | null) {
  if (miles === null) return null
  return miles === 0 ? 'No mileage warranty' : `${miles.toLocaleString()} mile warranty`
}

// "540 A B" (treadwear, traction, temperature)
export function utqgLabel(p: { utqgTreadwear: number | null; utqgTraction: string | null; utqgTemperature: string | null }) {
  return p.utqgTreadwear ? [p.utqgTreadwear, p.utqgTraction, p.utqgTemperature].filter(Boolean).join(' ') : null
}

// "1,874 lb @ 50 psi"
export function maxLoadLabel(p: { maxLoadLbs: number | null; maxLoadPsi: number | null }) {
  return p.maxLoadLbs ? `${p.maxLoadLbs.toLocaleString()} lb${p.maxLoadPsi ? ` @ ${p.maxLoadPsi} psi` : ''}` : null
}

// "102H", "121/118S E", "98W XL" — for tables and cards.
export function specLabel(p: {
  loadIndex: number | null
  loadIndexDual: number | null
  speedRating: string | null
  loadRange: string | null
  extraLoad: boolean
}) {
  const load = p.loadIndex ? `${p.loadIndex}${p.loadIndexDual ? `/${p.loadIndexDual}` : ''}` : ''
  return [load + (p.speedRating ?? ''), p.loadRange ? `LR ${p.loadRange}` : '', p.extraLoad ? 'XL' : '']
    .filter(Boolean)
    .join(' ')
}
