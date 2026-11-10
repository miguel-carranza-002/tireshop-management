// Pricing rules from docs/workflow.md. All dollar amounts come from the
// settings row, so changing a price never needs a code change.

export type Settings = {
  shopRatePerHour: number
  productsTaxRate: number
  alignmentCarPrice: number
  alignmentTruckPrice: number
  alignmentSurcharge: number
  mountBalanceCarPrice: number
  mountBalanceTruckPrice: number
  mountBalanceSurcharge: number
  disposalFee: number
  valveStemCustomerSuppliedPrice: number
  trailerValveStemPrice: number
  tpmsSensorSinglePrice: number
  tpmsSensorMultiPrice: number
  tpmsResetPrice: number
  usedTireCarPrice: number
  usedTireTruckPrice: number
  minDeposit: number
  quoteValidDays: number
  lowProfileMaxAspect: number
  oversizedMinDiameterIn: number
  alignmentMinutes: number
  tireJobCarMinutes: number
  tireJobTruckMinutes: number
  tireJobMinMinutes: number
  tireMarkupPercent: number
  tireMinProfit: number
}

export const settingsColumns = `
  shop_rate_per_hour::float8 AS "shopRatePerHour",
  products_tax_rate::float8 AS "productsTaxRate",
  alignment_car_price::float8 AS "alignmentCarPrice",
  alignment_truck_price::float8 AS "alignmentTruckPrice",
  alignment_surcharge::float8 AS "alignmentSurcharge",
  mount_balance_car_price::float8 AS "mountBalanceCarPrice",
  mount_balance_truck_price::float8 AS "mountBalanceTruckPrice",
  mount_balance_surcharge::float8 AS "mountBalanceSurcharge",
  disposal_fee::float8 AS "disposalFee",
  valve_stem_customer_supplied_price::float8 AS "valveStemCustomerSuppliedPrice",
  trailer_valve_stem_price::float8 AS "trailerValveStemPrice",
  tpms_sensor_single_price::float8 AS "tpmsSensorSinglePrice",
  tpms_sensor_multi_price::float8 AS "tpmsSensorMultiPrice",
  tpms_reset_price::float8 AS "tpmsResetPrice",
  used_tire_car_price::float8 AS "usedTireCarPrice",
  used_tire_truck_price::float8 AS "usedTireTruckPrice",
  min_deposit::float8 AS "minDeposit",
  quote_valid_days AS "quoteValidDays",
  low_profile_max_aspect AS "lowProfileMaxAspect",
  oversized_min_diameter_in::float8 AS "oversizedMinDiameterIn",
  alignment_minutes AS "alignmentMinutes",
  tire_job_car_minutes AS "tireJobCarMinutes",
  tire_job_truck_minutes AS "tireJobTruckMinutes",
  tire_job_min_minutes AS "tireJobMinMinutes",
  tire_markup_percent::float8 AS "tireMarkupPercent",
  tire_min_profit::float8 AS "tireMinProfit"
`

// Conservative shop time for a tire job, assuming one tech on the car.
// Fewer than 4 tires scales down, but never below the minimum.
export function tireJobMinutes(
  settings: Settings,
  tire: TireSizeInfo,
  quantity: number,
  difficultyMinutes: number,
) {
  const perSet =
    tire.tireClass === 'truck' ? settings.tireJobTruckMinutes : settings.tireJobCarMinutes
  const scaled = Math.max(settings.tireJobMinMinutes, Math.ceil((perSet * quantity) / 4))
  return scaled + difficultyMinutes
}

export type TireSizeInfo = {
  parsed: boolean
  tireClass: 'car' | 'truck'
  lowProfile: boolean
  oversized: boolean
  diameterIn: number | null
}

// Metric sizes: P225/45R17, LT275/70R18, 245/40ZR19, ST225/75R15.
const metricPattern =
  /^(P|LT|ST|T)?\s*(\d{3})\s*\/\s*(\d{2})\s*(?:Z?R|D|B|-)\s*(\d{2}(?:\.\d)?)/i

// Flotation sizes: 35x12.50R20, LT33x12.50R17.
const flotationPattern =
  /^(?:LT)?\s*(\d{2}(?:\.\d)?)\s*X\s*(\d{1,2}(?:\.\d{1,2})?)\s*(?:Z?R|D|B|-)?\s*(\d{2}(?:\.\d)?)/i

export function parseTireSize(
  size: string | null,
  settings: Pick<Settings, 'lowProfileMaxAspect' | 'oversizedMinDiameterIn'>,
  classOverride?: 'car' | 'truck' | null,
): TireSizeInfo {
  const text = (size ?? '').trim().toUpperCase()

  const metric = metricPattern.exec(text)
  if (metric) {
    const prefix = metric[1] ?? ''
    const width = Number(metric[2])
    const aspect = Number(metric[3])
    const rim = Number(metric[4])
    const diameterIn = rim + (2 * width * aspect) / 100 / 25.4
    return {
      parsed: true,
      tireClass: classOverride ?? (prefix === 'LT' || prefix === 'ST' ? 'truck' : 'car'),
      lowProfile: aspect <= settings.lowProfileMaxAspect,
      oversized: diameterIn >= settings.oversizedMinDiameterIn,
      diameterIn: Math.round(diameterIn * 10) / 10,
    }
  }

  const flotation = flotationPattern.exec(text)
  if (flotation) {
    const diameterIn = Number(flotation[1])
    return {
      parsed: true,
      tireClass: classOverride ?? 'truck',
      lowProfile: false,
      oversized: diameterIn >= settings.oversizedMinDiameterIn,
      diameterIn,
    }
  }

  return {
    parsed: false,
    tireClass: classOverride ?? 'car',
    lowProfile: false,
    oversized: false,
    diameterIn: null,
  }
}

export function mountBalancePrice(settings: Settings, tire: TireSizeInfo) {
  const base =
    tire.tireClass === 'truck'
      ? settings.mountBalanceTruckPrice
      : settings.mountBalanceCarPrice
  const surcharge =
    tire.lowProfile || tire.oversized ? settings.mountBalanceSurcharge : 0
  return base + surcharge
}

export function mountBalanceDescription(tire: TireSizeInfo) {
  const notes = [
    tire.tireClass === 'truck' ? 'truck tire' : 'car tire',
    tire.lowProfile && 'low-profile',
    tire.oversized && 'oversized',
  ].filter(Boolean)
  return `Mount & balance (${notes.join(', ')})`
}

type AlignmentVehicle = {
  vehicleClass: 'car' | 'truck'
  liftedLowered: boolean
  multiLinkSuspension: boolean
}

// The surcharge applies once, even if both boxes are checked.
export function alignmentPrice(settings: Settings, vehicle: AlignmentVehicle) {
  const base =
    vehicle.vehicleClass === 'truck'
      ? settings.alignmentTruckPrice
      : settings.alignmentCarPrice
  const surcharge =
    vehicle.liftedLowered || vehicle.multiLinkSuspension
      ? settings.alignmentSurcharge
      : 0
  return base + surcharge
}

export function alignmentDescription(vehicle: AlignmentVehicle) {
  const notes = [
    vehicle.vehicleClass === 'truck' ? 'truck' : 'car',
    vehicle.liftedLowered && 'lifted/lowered',
    vehicle.multiLinkSuspension && 'multi-link',
  ].filter(Boolean)
  return `Alignment (${notes.join(', ')})`
}

// Tires with a low-profile or oversized size default to +10 minutes.
export function defaultDifficultyMinutes(tire: TireSizeInfo) {
  return tire.lowProfile || tire.oversized ? 10 : 0
}

// Price for a tire bought in for a quote: cost plus the markup, but never
// less than cost + the minimum profit, rounded up to the next .99 (so $130.00
// becomes $130.99, never $129.99). The web app keeps a copy in api.ts for the
// Settings preview; keep the two the same.
export function tirePriceFromCost(
  settings: Pick<Settings, 'tireMarkupPercent' | 'tireMinProfit'>,
  cost: number,
) {
  const price = Math.max(cost * (1 + settings.tireMarkupPercent / 100), cost + settings.tireMinProfit)
  const cents = Math.round(price * 100)
  return (Math.ceil((cents + 1) / 100) * 100 - 1) / 100
}
