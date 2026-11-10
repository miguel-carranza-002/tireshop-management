import { Router } from 'express'
import { pool, type Queryable } from '../db.js'
import type { ShopDetails } from '../pdf/ticketPdf.js'
import { settingsColumns, type Settings } from '../pricing.js'
import { requireAdmin } from '../auth.js'
import { asBody, ValidationError } from '../validation.js'

export const settingsRouter = Router()

export async function loadSettings(db: Queryable = pool): Promise<Settings> {
  const result = await db.query(`SELECT ${settingsColumns} FROM settings`)
  return result.rows[0]
}

// Printed on quotes, work orders and invoices.
export async function loadShopDetails(db: Queryable = pool): Promise<ShopDetails> {
  const result = await db.query(`
    SELECT
      shop_name AS "shopName",
      shop_address AS "shopAddress",
      shop_phone AS "shopPhone",
      invoice_footer AS "invoiceFooter"
    FROM settings
  `)
  return result.rows[0]
}

// Every editable setting: its column, a label for error messages, and what
// values make sense. Changes apply to new quotes and new lines; existing
// tickets keep the prices they were given.
type Field = { column: string; label: string } & (
  | { kind: 'money' }
  | { kind: 'rate' } // stored as a fraction, e.g. 0.08
  | { kind: 'number'; min: number; max: number; integer?: boolean }
  | { kind: 'text'; required?: boolean; max: number }
)

const money = (column: string, label: string): Field => ({ column, label, kind: 'money' })
const whole = (column: string, label: string, min: number, max: number): Field => ({
  column,
  label,
  kind: 'number',
  min,
  max,
  integer: true,
})

const fields: Record<string, Field> = {
  shopName: { column: 'shop_name', label: 'Shop name', kind: 'text', required: true, max: 100 },
  shopAddress: { column: 'shop_address', label: 'Address', kind: 'text', max: 300 },
  shopPhone: { column: 'shop_phone', label: 'Phone', kind: 'text', max: 40 },
  invoiceFooter: { column: 'invoice_footer', label: 'Invoice footer', kind: 'text', max: 300 },

  productsTaxRate: { column: 'products_tax_rate', label: 'Tax rate', kind: 'rate' },
  shopRatePerHour: money('shop_rate_per_hour', 'Shop rate'),
  minDeposit: money('min_deposit', 'Minimum deposit'),
  quoteValidDays: whole('quote_valid_days', 'Days a quote is valid', 1, 90),

  tireMarkupPercent: { column: 'tire_markup_percent', label: 'Tire markup', kind: 'number', min: 0, max: 500 },
  tireMinProfit: money('tire_min_profit', 'Minimum profit per tire'),
  usedTireCarPrice: money('used_tire_car_price', 'Used tire price (car)'),
  usedTireTruckPrice: money('used_tire_truck_price', 'Used tire price (truck)'),

  mountBalanceCarPrice: money('mount_balance_car_price', 'Mount & balance (car)'),
  mountBalanceTruckPrice: money('mount_balance_truck_price', 'Mount & balance (truck)'),
  mountBalanceSurcharge: money('mount_balance_surcharge', 'Mount & balance surcharge'),
  disposalFee: money('disposal_fee', 'Disposal fee'),
  valveStemCustomerSuppliedPrice: money('valve_stem_customer_supplied_price', 'Valve stem price'),
  trailerValveStemPrice: money('trailer_valve_stem_price', 'Trailer valve stem price'),
  alignmentCarPrice: money('alignment_car_price', 'Alignment (car)'),
  alignmentTruckPrice: money('alignment_truck_price', 'Alignment (truck)'),
  alignmentSurcharge: money('alignment_surcharge', 'Alignment surcharge'),
  tpmsSensorSinglePrice: money('tpms_sensor_single_price', 'TPMS sensor (one)'),
  tpmsSensorMultiPrice: money('tpms_sensor_multi_price', 'TPMS sensor (2 or more)'),
  tpmsResetPrice: money('tpms_reset_price', 'TPMS reset'),

  lowProfileMaxAspect: whole('low_profile_max_aspect', 'Low-profile aspect ratio', 20, 80),
  oversizedMinDiameterIn: {
    column: 'oversized_min_diameter_in',
    label: 'Oversized diameter',
    kind: 'number',
    min: 20,
    max: 50,
  },

  alignmentMinutes: whole('alignment_minutes', 'Alignment time', 5, 480),
  tireJobCarMinutes: whole('tire_job_car_minutes', 'Car tire job time', 5, 480),
  tireJobTruckMinutes: whole('tire_job_truck_minutes', 'Truck tire job time', 5, 480),
  tireJobMinMinutes: whole('tire_job_min_minutes', 'Shortest tire job', 1, 480),
}

function readValue(field: Field, raw: unknown): unknown {
  const { label } = field
  if (field.kind === 'text') {
    const text = typeof raw === 'string' ? raw.trim() : raw == null ? '' : String(raw)
    if (field.required && !text) throw new ValidationError(`${label} is required`)
    if (text.length > field.max) throw new ValidationError(`${label} is too long`)
    return text || null
  }
  const value = Number(raw)
  if (raw === '' || raw === null || raw === undefined || !Number.isFinite(value)) {
    throw new ValidationError(`${label} must be a number`)
  }
  if (field.kind === 'money') {
    if (value < 0 || value > 100000) throw new ValidationError(`${label} must be between $0 and $100,000`)
    if (Math.abs(value * 100 - Math.round(value * 100)) > 1e-6) {
      throw new ValidationError(`${label} can't have more than 2 decimal places`)
    }
    return value
  }
  if (field.kind === 'rate') {
    if (value < 0 || value >= 0.5) throw new ValidationError(`${label} must be between 0% and 50%`)
    return value
  }
  if (value < field.min || value > field.max || (field.integer && !Number.isInteger(value))) {
    throw new ValidationError(
      `${label} must be ${field.integer ? 'a whole number' : 'a number'} from ${field.min} to ${field.max}`,
    )
  }
  return value
}

async function allSettings() {
  const [settings, shop] = await Promise.all([loadSettings(), loadShopDetails()])
  return { ...settings, ...shop }
}

settingsRouter.get('/', async (_req, res) => {
  res.json({ settings: await allSettings() })
})

// Save any subset of the settings above. Unknown keys are refused, and
// nothing is saved unless every value is valid.
settingsRouter.put('/', requireAdmin, async (req, res) => {
  const body = asBody(req.body)
  const unknown = Object.keys(body).filter((k) => !(k in fields))
  if (unknown.length > 0) throw new ValidationError(`Unknown setting: ${unknown.join(', ')}`)

  const sets: string[] = []
  const params: unknown[] = []
  for (const [key, raw] of Object.entries(body)) {
    const field = fields[key]
    params.push(readValue(field, raw))
    sets.push(`${field.column} = $${params.length}`)
  }
  if (sets.length > 0) {
    await pool.query(`UPDATE settings SET ${sets.join(', ')}, updated_at = NOW()`, params)
  }
  res.json({ settings: await allSettings() })
})
