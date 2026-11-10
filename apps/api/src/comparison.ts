// The tire comparison: three options by price (cheap / medium / premium),
// alternate sizes, and warnings for vehicles where load and speed matter.
// No database access here, so every rule can be tested directly.
import { mountBalancePrice, parseTireSize, type Settings } from './pricing.js'

// ---------------------------------------------------------------------------
// Sizes
// ---------------------------------------------------------------------------

// The same tire size however it's written: "P225/65R17" = "225/65R17",
// "245/40ZR18" = "245/40R18". LT and ST stay distinct (different tires).
export function sizeKey(size: string | null | undefined) {
  return (size ?? '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/^P(?=\d)/, '')
    .replace(/(\d{2})ZR(\d)/, '$1R$2')
}

const metric = /^(LT|ST|T)?(\d{3})\/(\d{2})R(\d{2})$/

// Sizes one step away (width ±10, or aspect ±5) on the same rim, kept only
// within 3% of the original overall diameter. Biggest-first doesn't matter:
// they're labeled with the difference.
export function alternateSizes(size: string, settings: Pick<Settings, 'lowProfileMaxAspect' | 'oversizedMinDiameterIn'>) {
  const key = sizeKey(size)
  const m = metric.exec(key)
  if (!m) return []
  const [, prefix = '', w, a, rim] = m
  const original = parseTireSize(key, settings).diameterIn!
  const candidates = [
    `${prefix}${Number(w) - 10}/${a}R${rim}`,
    `${prefix}${Number(w) + 10}/${a}R${rim}`,
    `${prefix}${w}/${Number(a) - 5}R${rim}`,
    `${prefix}${w}/${Number(a) + 5}R${rim}`,
  ]
  return candidates
    .map((s) => {
      const d = parseTireSize(s, settings).diameterIn!
      return { size: s, diameterIn: d, diffPercent: Math.round(((d - original) / original) * 1000) / 10 }
    })
    .filter((c) => Math.abs(c.diffPercent) <= 3)
}

export type DriveType = '2wd' | 'awd' | '4wd' | 'unknown'

// Different-size tires are only safe when every tire that turns together
// matches: AWD/4WD (and unknown, to be safe) only when all 4 are replaced;
// 2WD when 2 (same axle) or 4 are.
export function alternatesAllowed(driveType: DriveType, quantity: number): { allowed: boolean; reason: string | null } {
  if (quantity === 1 || quantity === 3) return { allowed: false, reason: 'Not offered for a single tire or an odd number of tires.' }
  if (driveType === '2wd') return { allowed: quantity === 2 || quantity === 4, reason: null }
  if (quantity === 4) return { allowed: true, reason: null }
  return {
    allowed: false,
    reason:
      driveType === 'unknown'
        ? 'Drive type unknown, so treated as AWD: other sizes only when replacing all 4.'
        : `${driveType.toUpperCase()}: other sizes only when replacing all 4.`,
  }
}

// ---------------------------------------------------------------------------
// Picking three
// ---------------------------------------------------------------------------

export type Tier = 'cheap' | 'medium' | 'premium' | 'option'

// Lowest, highest, and the one nearest halfway between, by price per tire.
export function pickTiers<T extends { price: number }>(priced: T[]): { item: T; tier: Tier }[] {
  const sorted = [...priced].sort((x, y) => x.price - y.price)
  if (sorted.length === 0) return []
  if (sorted.length === 1) return [{ item: sorted[0], tier: 'option' }]
  const cheap = sorted[0]
  const premium = sorted[sorted.length - 1]
  if (sorted.length === 2) return [{ item: cheap, tier: 'cheap' }, { item: premium, tier: 'premium' }]
  const middle = (cheap.price + premium.price) / 2
  const medium = sorted
    .slice(1, -1)
    .reduce((best, t) => (Math.abs(t.price - middle) < Math.abs(best.price - middle) ? t : best))
  return [
    { item: cheap, tier: 'cheap' },
    { item: medium, tier: 'medium' },
    { item: premium, tier: 'premium' },
  ]
}

// Tiers for options the advisor chose themselves, by their price order.
export function tiersForChosen(count: number): Tier[] {
  if (count === 1) return ['option']
  if (count === 2) return ['cheap', 'premium']
  return ['cheap', 'medium', 'premium']
}

// ---------------------------------------------------------------------------
// Vehicles where load and speed matter
// ---------------------------------------------------------------------------

// Speed ratings in order. H sits between U and V.
const speedOrder = ['L', 'M', 'N', 'P', 'Q', 'R', 'S', 'T', 'U', 'H', 'V', 'W', 'Y', 'Z']
const rangeOrder = ['B', 'C', 'D', 'E', 'F', 'G', 'H']

export type VehicleNeeds = {
  isEv: boolean
  heavyDuty: boolean
  runFlat: boolean
  requiredLoadIndex: number | null
  requiredLoadRange: string | null
  requiredSpeedRating: string | null
}

export type TireSpecs = {
  loadIndex: number | null
  speedRating: string | null
  loadRange: string | null
  evRated: boolean
  runFlat: boolean
}

// Why an option might not suit this vehicle. Shown, never hidden.
export function optionWarnings(v: VehicleNeeds, t: TireSpecs): string[] {
  const warnings: string[] = []
  if (v.requiredLoadIndex !== null) {
    if (t.loadIndex === null) warnings.push(`Load index unknown (needs ${v.requiredLoadIndex})`)
    else if (t.loadIndex < v.requiredLoadIndex) warnings.push(`Load index ${t.loadIndex} < required ${v.requiredLoadIndex}`)
  }
  if (v.requiredSpeedRating !== null) {
    if (t.speedRating === null) warnings.push(`Speed rating unknown (needs ${v.requiredSpeedRating})`)
    else if (speedOrder.indexOf(t.speedRating) < speedOrder.indexOf(v.requiredSpeedRating)) {
      warnings.push(`Speed rating ${t.speedRating} below required ${v.requiredSpeedRating}`)
    }
  }
  if (v.requiredLoadRange !== null) {
    if (t.loadRange === null) warnings.push(`Load range unknown (needs ${v.requiredLoadRange})`)
    else if (rangeOrder.indexOf(t.loadRange) < rangeOrder.indexOf(v.requiredLoadRange)) {
      warnings.push(`Load range ${t.loadRange} below required ${v.requiredLoadRange}`)
    }
  }
  if (v.isEv && !t.evRated) warnings.push('Not EV-rated')
  if (v.runFlat && !t.runFlat) warnings.push('Not run-flat (this car came with run-flats and may have no spare)')
  return warnings
}

// A flagged vehicle with nothing to check against: say so instead of guessing.
export function needsBanner(v: VehicleNeeds): string | null {
  const flags = [v.isEv && 'EV', v.heavyDuty && 'Heavy-duty truck', v.runFlat && 'Run-flat equipped'].filter(Boolean)
  if (flags.length === 0) return null
  if (v.requiredLoadIndex !== null || v.requiredLoadRange !== null || v.requiredSpeedRating !== null) return null
  return `${flags.join(', ')}: check the door placard for the required load ${v.heavyDuty ? 'range' : 'index'} and speed rating before quoting.`
}

// ---------------------------------------------------------------------------
// Out the door
// ---------------------------------------------------------------------------

// What the customer pays for N tires: tires, mount & balance, disposal of the
// old ones, and tax on the tires (services aren't taxed). Valve stems are free
// with tires bought here; TPMS sensors are added on the quote if needed.
export function outTheDoor(
  settings: Settings,
  taxRate: number,
  tire: { price: number; tireSize: string | null; tireClassOverride: 'car' | 'truck' | null },
  quantity: number,
) {
  const info = parseTireSize(tire.tireSize, settings, tire.tireClassOverride)
  const tires = round(tire.price * quantity)
  const mountBalance = round(mountBalancePrice(settings, info) * quantity)
  const disposal = round(settings.disposalFee * quantity)
  const tax = round(tires * taxRate)
  return { tires, mountBalance, disposal, tax, total: round(tires + mountBalance + disposal + tax) }
}

const round = (n: number) => Math.round(n * 100) / 100

// ---------------------------------------------------------------------------
// Filters the advisor sets (brand, warranty, season, type, load range, price,
// road hazard). A tire that misses one says which; when nothing meets every
// filter, the closest tires are shown with what they miss (size comes first).
// ---------------------------------------------------------------------------

// Weakest to strongest. A minimum: asking for E also shows F.
export const loadLevels = ['SL', 'XL', 'C', 'D', 'E', 'F'] as const
export type LoadLevel = (typeof loadLevels)[number]

export function loadLevel(t: { loadRange: string | null; extraLoad: boolean }): number {
  const range = (t.loadRange ?? '').toUpperCase().charAt(0)
  const index = loadLevels.indexOf(range as LoadLevel)
  if (index >= 2) return index
  return t.extraLoad ? 1 : 0 // B and standard load are the same strength
}

export type TireFilters = {
  brands: string[]
  minWarranty: number | null
  season: string | null
  tireType: string | null
  minLoad: LoadLevel | null
  maxPrice: number | null
  roadHazard: boolean
}

export const noFilters: TireFilters = {
  brands: [],
  minWarranty: null,
  season: null,
  tireType: null,
  minLoad: null,
  maxPrice: null,
  roadHazard: false,
}

const seasonWords: Record<string, string> = {
  all_season: 'all-season',
  all_weather: 'all-weather',
  summer: 'summer',
  winter: 'winter',
}
const typeWords: Record<string, string> = {
  touring: 'touring',
  performance: 'performance',
  highway: 'highway',
  all_terrain: 'all-terrain',
  rugged_terrain: 'rugged-terrain',
  mud_terrain: 'mud-terrain',
}

export type FilterableTire = {
  brand: string
  warrantyMiles: number | null
  season: string | null
  tireType: string | null
  loadRange: string | null
  extraLoad: boolean
  price: number | null
  roadHazard: boolean
}

// What this tire doesn't meet, in shop words ("no road hazard"). Empty = a match.
export function filterMisses(t: FilterableTire, f: TireFilters): string[] {
  const misses: string[] = []
  if (f.brands.length > 0 && !f.brands.some((b) => b.toLowerCase() === t.brand.toLowerCase())) {
    misses.push('other brand')
  }
  if (f.roadHazard && !t.roadHazard) misses.push('no road hazard')
  if (f.minWarranty !== null && (t.warrantyMiles ?? 0) < f.minWarranty) {
    misses.push(t.warrantyMiles ? `${Math.round(t.warrantyMiles / 1000)}k warranty` : 'no mileage warranty')
  }
  // All-weather is all-season with the snowflake, so it counts as all-season.
  if (f.season && t.season !== f.season && !(f.season === 'all_season' && t.season === 'all_weather')) {
    misses.push(t.season ? seasonWords[t.season] ?? t.season : 'season not set')
  }
  if (f.tireType && t.tireType !== f.tireType) {
    misses.push(t.tireType ? typeWords[t.tireType] ?? t.tireType : 'type not set')
  }
  if (f.minLoad && loadLevel(t) < loadLevels.indexOf(f.minLoad)) {
    misses.push(`load ${loadLevels[loadLevel(t)]}`)
  }
  // Only a known price can be over; a tire waiting for today's cost isn't.
  if (f.maxPrice !== null && t.price !== null && t.price > f.maxPrice) misses.push('over price')
  return misses
}

// Tires meeting every filter; if none do, the ones missing the fewest.
export function closestMatches<T>(items: T[], misses: (t: T) => string[]): T[] {
  if (items.length === 0) return []
  const fewest = Math.min(...items.map((t) => misses(t).length))
  return items.filter((t) => misses(t).length === fewest)
}
