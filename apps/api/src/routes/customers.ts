import { Router } from 'express'
import { pool } from '../db.js'
import {
  asBody,
  idParam,
  normalizePhone,
  optionalBoolean,
  optionalNumber,
  optionalText,
  requiredText,
  requiredYear,
  ValidationError,
  vehicleClass,
  type Body,
} from '../validation.js'

export const customersRouter = Router()

const customerColumns = `
  c.id::text AS id,
  c.first_name AS "firstName",
  c.last_name AS "lastName",
  c.phone,
  c.has_account AS "hasAccount",
  c.notes,
  c.created_at AS "createdAt"
`

export const vehicleColumns = `
  v.id::text AS id,
  v.customer_id::text AS "customerId",
  v.year,
  v.make,
  v.model,
  v.trim,
  v.vehicle_class AS "vehicleClass",
  v.drive_type AS "driveType",
  v.lifted_lowered AS "liftedLowered",
  v.multi_link_suspension AS "multiLinkSuspension",
  v.license_plate AS "licensePlate",
  v.vin,
  v.tire_size AS "tireSize",
  v.rear_tire_size AS "rearTireSize",
  v.is_ev AS "isEv",
  v.heavy_duty AS "heavyDuty",
  v.run_flat AS "runFlat",
  v.required_load_index AS "requiredLoadIndex",
  v.required_load_range AS "requiredLoadRange",
  v.required_speed_rating AS "requiredSpeedRating"
`

function requiredPhone(body: Body) {
  const phone = normalizePhone(optionalText(body, 'phone'))
  if (!phone || phone.length < 7) throw new ValidationError('Phone number is required')
  return phone
}

function readCustomer(rawBody: unknown) {
  const body = asBody(rawBody)
  return {
    firstName: requiredText(body, 'firstName', 'First name'),
    lastName: optionalText(body, 'lastName'),
    // Required: it's how we call when their tires arrive.
    phone: requiredPhone(body),
    hasAccount: optionalBoolean(body, 'hasAccount', false),
    notes: optionalText(body, 'notes'),
  }
}

const driveTypes = ['2wd', 'awd', '4wd', 'unknown'] as const
const loadRanges = ['B', 'C', 'D', 'E', 'F', 'G', 'H']
const speedRatings = ['L', 'M', 'N', 'P', 'Q', 'R', 'S', 'T', 'U', 'H', 'V', 'W', 'Y', 'Z']

// Upper case without spaces: plates, VINs, tire sizes, ratings.
const upper = (body: Body, key: string) => optionalText(body, key)?.toUpperCase().replace(/\s+/g, '') ?? null

export function readVehicle(rawBody: unknown) {
  const body = asBody(rawBody)
  const driveType = (body.driveType ?? 'unknown') as (typeof driveTypes)[number]
  if (!driveTypes.includes(driveType)) throw new ValidationError('Drive type must be 2WD, AWD, 4WD or unknown')
  const loadRange = upper(body, 'requiredLoadRange')
  if (loadRange && !loadRanges.includes(loadRange)) throw new ValidationError('Load range must be a letter B to H')
  const speed = upper(body, 'requiredSpeedRating')
  if (speed && !speedRatings.includes(speed)) {
    throw new ValidationError('Speed rating must be one letter, e.g. H, V or S')
  }
  return {
    year: requiredYear(body),
    make: requiredText(body, 'make', 'Make'),
    model: requiredText(body, 'model', 'Model'),
    trim: optionalText(body, 'trim'),
    vehicleClass: vehicleClass(body),
    driveType,
    liftedLowered: optionalBoolean(body, 'liftedLowered', false),
    multiLinkSuspension: optionalBoolean(body, 'multiLinkSuspension', false),
    licensePlate: upper(body, 'licensePlate'),
    vin: upper(body, 'vin'),
    tireSize: upper(body, 'tireSize'),
    rearTireSize: upper(body, 'rearTireSize'),
    isEv: optionalBoolean(body, 'isEv', false),
    heavyDuty: optionalBoolean(body, 'heavyDuty', false),
    runFlat: optionalBoolean(body, 'runFlat', false),
    requiredLoadIndex: optionalNumber(body, 'requiredLoadIndex', 'Load index', { min: 60, integer: true }),
    requiredLoadRange: loadRange,
    requiredSpeedRating: speed,
  }
}

// The column for each field readVehicle returns; drives the INSERT and UPDATE.
export const vehicleFieldColumns: Record<keyof ReturnType<typeof readVehicle>, string> = {
  year: 'year',
  make: 'make',
  model: 'model',
  trim: 'trim',
  vehicleClass: 'vehicle_class',
  driveType: 'drive_type',
  liftedLowered: 'lifted_lowered',
  multiLinkSuspension: 'multi_link_suspension',
  licensePlate: 'license_plate',
  vin: 'vin',
  tireSize: 'tire_size',
  rearTireSize: 'rear_tire_size',
  isEv: 'is_ev',
  heavyDuty: 'heavy_duty',
  runFlat: 'run_flat',
  requiredLoadIndex: 'required_load_index',
  requiredLoadRange: 'required_load_range',
  requiredSpeedRating: 'required_speed_rating',
}

// Other customers sharing a phone number. Used to warn, never to block.
async function findPhoneDuplicates(phone: string | null, excludeId?: string) {
  if (phone === null) return []
  const result = await pool.query(
    `
      SELECT ${customerColumns}
      FROM customers AS c
      WHERE c.phone = $1
        AND ($2::bigint IS NULL OR c.id <> $2::bigint)
      ORDER BY c.first_name, c.last_name
    `,
    [phone, excludeId ?? null],
  )
  return result.rows
}

// Search by first name, last name or phone. Empty search lists recent customers.
customersRouter.get('/', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  const words = q.split(/\s+/).filter(Boolean)
  const digits = q.replace(/\D/g, '')

  const params: unknown[] = []
  const conditions = words.map((word) => {
    params.push(`${word.toLowerCase()}%`)
    const p = `$${params.length}`
    return `(LOWER(c.first_name) LIKE ${p} OR LOWER(c.last_name) LIKE ${p})`
  })

  let where = conditions.length > 0 ? conditions.join(' AND ') : 'TRUE'

  // A search that looks like a phone number also matches phone digits.
  if (digits.length >= 3) {
    params.push(`%${digits}%`)
    where = `(${where}) OR c.phone LIKE $${params.length}`
  }

  const result = await pool.query(
    `
      SELECT
        ${customerColumns},
        COUNT(v.id)::int AS "vehicleCount"
      FROM customers AS c
      LEFT JOIN vehicles AS v ON v.customer_id = c.id
      WHERE ${where}
      GROUP BY c.id
      ORDER BY ${q === '' ? 'c.created_at DESC' : 'c.first_name, c.last_name'}
      LIMIT 50
    `,
    params,
  )

  res.json({ customers: result.rows })
})

customersRouter.get('/phone-check', async (req, res) => {
  const phone = normalizePhone(
    typeof req.query.phone === 'string' ? req.query.phone : null,
  )
  const excludeId =
    typeof req.query.excludeId === 'string' && /^\d+$/.test(req.query.excludeId)
      ? req.query.excludeId
      : undefined

  res.json({ duplicates: await findPhoneDuplicates(phone, excludeId) })
})

customersRouter.get('/:id', async (req, res) => {
  const id = idParam(req.params.id)

  const customer = await pool.query(
    `SELECT ${customerColumns} FROM customers AS c WHERE c.id = $1`,
    [id],
  )

  if (customer.rowCount === 0) {
    res.status(404).json({ error: 'Customer not found' })
    return
  }

  const vehicles = await pool.query(
    `
      SELECT ${vehicleColumns}
      FROM vehicles AS v
      WHERE v.customer_id = $1
      ORDER BY v.year DESC, v.make, v.model
    `,
    [id],
  )

  res.json({ customer: { ...customer.rows[0], vehicles: vehicles.rows } })
})

customersRouter.post('/', async (req, res) => {
  const c = readCustomer(req.body)

  const result = await pool.query(
    `
      INSERT INTO customers (first_name, last_name, phone, has_account, notes)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id::text AS id
    `,
    [c.firstName, c.lastName, c.phone, c.hasAccount, c.notes],
  )

  const id = result.rows[0].id
  res.status(201).json({
    id,
    phoneDuplicates: await findPhoneDuplicates(c.phone, id),
  })
})

customersRouter.put('/:id', async (req, res) => {
  const id = idParam(req.params.id)
  const c = readCustomer(req.body)

  const result = await pool.query(
    `
      UPDATE customers
      SET first_name = $2,
          last_name = $3,
          phone = $4,
          has_account = $5,
          notes = $6,
          updated_at = NOW()
      WHERE id = $1
    `,
    [id, c.firstName, c.lastName, c.phone, c.hasAccount, c.notes],
  )

  if (result.rowCount === 0) {
    res.status(404).json({ error: 'Customer not found' })
    return
  }

  res.json({ id, phoneDuplicates: await findPhoneDuplicates(c.phone, id) })
})

customersRouter.post('/:id/vehicles', async (req, res) => {
  const customerId = idParam(req.params.id)
  const v = readVehicle(req.body)

  const exists = await pool.query('SELECT 1 FROM customers WHERE id = $1', [
    customerId,
  ])
  if (exists.rowCount === 0) {
    res.status(404).json({ error: 'Customer not found' })
    return
  }

  const keys = Object.keys(vehicleFieldColumns) as (keyof typeof v)[]
  const result = await pool.query(
    `
      INSERT INTO vehicles AS v (customer_id, ${keys.map((k) => vehicleFieldColumns[k]).join(', ')})
      VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')})
      RETURNING ${vehicleColumns}
    `,
    [customerId, ...keys.map((k) => v[k])],
  )

  res.status(201).json({ vehicle: result.rows[0] })
})
