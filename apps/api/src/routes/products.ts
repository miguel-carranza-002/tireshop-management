import { Router } from 'express'
import type { PoolClient } from 'pg'
import { pool, withTransaction, type Queryable } from '../db.js'
import { tirePriceFromCost } from '../pricing.js'
import {
  asBody,
  ConflictError,
  idParam,
  NotFoundError,
  optionalBoolean,
  optionalNumber,
  optionalText,
  requiredNumber,
  requiredText,
  ValidationError,
  type Body,
} from '../validation.js'
import { loadSettings } from './settings.js'
import { findOrCreateLine, readLineDetails, saveLineDetails } from './tireLines.js'

export const productsRouter = Router()

// One row per size (or sensor), with its tire line's shared details.
const productColumns = `
  p.id::text AS id,
  p.sku,
  p.brand,
  p.model,
  p.tire_size AS "tireSize",
  p.cost::float8 AS cost,
  p.price::float8 AS price,
  p.cost_updated_at AS "costUpdatedAt",
  p.product_type AS "productType",
  p.condition,
  p.stocked,
  p.min_qty AS "minQty",
  p.supplier,
  p.tire_class_override AS "tireClassOverride",
  p.load_index AS "loadIndex",
  p.load_index_dual AS "loadIndexDual",
  p.speed_rating AS "speedRating",
  p.load_range AS "loadRange",
  p.extra_load AS "extraLoad",
  p.tire_line_id::text AS "tireLineId",
  p.size_alt AS "sizeAlt",
  p.tread_depth_32nds AS "treadDepth32nds",
  p.utqg_treadwear AS "utqgTreadwear",
  p.utqg_traction AS "utqgTraction",
  p.utqg_temperature AS "utqgTemperature",
  p.max_load_lbs AS "maxLoadLbs",
  p.max_load_psi AS "maxLoadPsi",
  p.sidewall,
  p.warranty_miles AS "sizeWarrantyMiles",
  l.tire_type AS "tireType",
  COALESCE(l.road_hazard, FALSE) AS "roadHazard",
  l.season,
  -- The size's own warranty when it has one, else the line's.
  COALESCE(p.warranty_miles, l.warranty_miles) AS "warrantyMiles",
  l.warranty_miles AS "lineWarrantyMiles",
  COALESCE(l.run_flat, FALSE) AS "runFlat",
  COALESCE(l.ev_rated, FALSE) AS "evRated",
  COALESCE(l.severe_snow, FALSE) AS "severeSnow",
  (ph.tire_line_id IS NOT NULL) AS "hasPhoto",
  ph.updated_at AS "photoUpdatedAt",
  COALESCE(s.on_hand_qty, 0)::int AS "onHandQty",
  COALESCE(s.reserved_qty, 0)::int AS "reservedQty",
  (COALESCE(s.on_hand_qty, 0) - COALESCE(s.reserved_qty, 0))::int AS "availableQty",
  (
    SELECT COALESCE(SUM(po.qty_ordered - po.qty_arrived), 0)::int
    FROM pending_orders po
    WHERE po.product_id = p.id AND po.status IN ('needed', 'ordered')
  ) AS "onOrderQty"
`

const productFrom = `
  FROM products AS p
  LEFT JOIN inventory_stock AS s ON s.product_id = p.id
  LEFT JOIN tire_lines AS l ON l.id = p.tire_line_id
  LEFT JOIN tire_line_photos AS ph ON ph.tire_line_id = p.tire_line_id
`

async function loadProduct(db: Queryable, id: string) {
  const result = await db.query(`SELECT ${productColumns} ${productFrom} WHERE p.id = $1`, [id])
  if (result.rowCount === 0) throw new NotFoundError('Product not found')
  return result.rows[0]
}

productsRouter.get('/', async (_req, res) => {
  const result = await pool.query(`
    SELECT ${productColumns} ${productFrom}
    ORDER BY p.product_type, p.brand, p.model, p.tire_size
  `)
  res.json({ products: result.rows })
})

// A tidy tire size: upper case, no spaces ("lt 275/70r18" -> "LT275/70R18").
export function normalizeTireSize(size: string) {
  return size.toUpperCase().replace(/\s+/g, '')
}

const speedRatings = ['L', 'M', 'N', 'P', 'Q', 'R', 'S', 'T', 'U', 'H', 'V', 'W', 'Y', 'Z']
const loadRanges = ['B', 'C', 'D', 'E', 'F', 'G', 'H']

type ProductInput = {
  productType: 'tire' | 'tpms_sensor'
  sku: string
  brand: string
  model: string
  tireSize: string | null
  cost: number | null
  price: number | null
  condition: 'new' | 'used'
  stocked: boolean
  minQty: number
  supplier: string | null
  tireClassOverride: 'car' | 'truck' | null
  loadIndex: number | null
  loadIndexDual: number | null
  speedRating: string | null
  loadRange: string | null
  extraLoad: boolean
  sizeAlt: string | null
  treadDepth32nds: number | null
  utqgTreadwear: number | null
  utqgTraction: string | null
  utqgTemperature: string | null
  maxLoadLbs: number | null
  maxLoadPsi: number | null
  sidewall: string | null
  sizeWarrantyMiles: number | null
}

function readProduct(body: Body): ProductInput {
  const productType = (body.productType ?? 'tire') as ProductInput['productType']
  if (!['tire', 'tpms_sensor'].includes(productType)) {
    throw new ValidationError('Product type must be tire or TPMS sensor')
  }
  const condition = (body.condition ?? 'new') as ProductInput['condition']
  if (!['new', 'used'].includes(condition)) throw new ValidationError('Condition must be new or used')

  const brand = requiredText(body, 'brand', 'Brand')
  const model = requiredText(body, 'model', 'Model')
  const size = optionalText(body, 'tireSize')
  const tireSize = size ? normalizeTireSize(size) : null
  if (productType === 'tire' && !tireSize) throw new ValidationError('Tire size is required')

  const stocked = optionalBoolean(body, 'stocked', true)
  // Used tires and special-order tires are never restocked to a minimum.
  const minQty =
    condition === 'used' || !stocked
      ? 0
      : (optionalNumber(body, 'minQty', 'Minimum stock', { min: 0, integer: true }) ?? 0)

  const override = body.tireClassOverride ?? null
  if (override !== null && override !== 'car' && override !== 'truck') {
    throw new ValidationError('Tire class must be car, truck or automatic')
  }

  const speedRating = optionalText(body, 'speedRating')?.toUpperCase() ?? null
  if (speedRating && !speedRatings.includes(speedRating)) throw new ValidationError('Speed rating must be one letter, e.g. H, V or S')
  const loadRange = optionalText(body, 'loadRange')?.toUpperCase() ?? null
  if (loadRange && !loadRanges.includes(loadRange)) throw new ValidationError('Load range must be a letter B to H')

  // SKU is optional: built from brand, model and size when left blank.
  const sku =
    optionalText(body, 'sku')?.toUpperCase() ??
    [brand, model, tireSize ?? (productType === 'tpms_sensor' ? 'TPMS' : ''), condition === 'used' ? 'USED' : '']
      .filter(Boolean)
      .join('-')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')

  // Stocked items need a price to sell from the shelf; catalog tires we only
  // buy in for a customer can wait for today's cost.
  const cost = optionalNumber(body, 'cost', 'Cost', { min: 0, money: true })
  const price = optionalNumber(body, 'price', 'Price', { min: 0, money: true })
  if (stocked && (cost === null || price === null)) {
    throw new ValidationError('Items kept on the shelf need a cost and a price')
  }

  return {
    productType,
    sku,
    brand,
    model,
    tireSize,
    cost,
    price,
    condition,
    stocked,
    minQty,
    supplier: optionalText(body, 'supplier'),
    tireClassOverride: override,
    loadIndex: optionalNumber(body, 'loadIndex', 'Load index', { min: 60, integer: true }),
    loadIndexDual: optionalNumber(body, 'loadIndexDual', 'Second load index', { min: 60, integer: true }),
    speedRating,
    loadRange,
    extraLoad: optionalBoolean(body, 'extraLoad', false),
    ...readSizeDetails(body),
  }
}

// Specs that come with each size: tread depth, UTQG, max load, sidewall,
// and a warranty when it differs from the line's.
function readSizeDetails(body: Body) {
  const traction = optionalText(body, 'utqgTraction')?.toUpperCase() ?? null
  if (traction && !['AA', 'A', 'B', 'C'].includes(traction)) throw new ValidationError('UTQG traction must be AA, A, B or C')
  const temperature = optionalText(body, 'utqgTemperature')?.toUpperCase() ?? null
  if (temperature && !['A', 'B', 'C'].includes(temperature)) throw new ValidationError('UTQG temperature must be A, B or C')
  const alt = optionalText(body, 'sizeAlt')
  return {
    sizeAlt: alt ? normalizeTireSize(alt) : null,
    treadDepth32nds: optionalNumber(body, 'treadDepth32nds', 'Tread depth', { min: 1, max: 40, integer: true }),
    utqgTreadwear: optionalNumber(body, 'utqgTreadwear', 'UTQG treadwear', { min: 20, max: 1500, integer: true }),
    utqgTraction: traction,
    utqgTemperature: temperature,
    maxLoadLbs: optionalNumber(body, 'maxLoadLbs', 'Max load', { min: 100, max: 20000, integer: true }),
    maxLoadPsi: optionalNumber(body, 'maxLoadPsi', 'Max load pressure', { min: 10, max: 150, integer: true }),
    sidewall: optionalText(body, 'sidewall')?.toUpperCase() ?? null,
    sizeWarrantyMiles: optionalNumber(body, 'sizeWarrantyMiles', 'Warranty miles', { min: 0, max: 200000, integer: true }),
  }
}

// A special-order tire saved with a cost but no price is priced from the
// Settings markup, the same as entering today's cost while quoting.
async function priceFromCostIfBlank(db: Queryable, p: ProductInput) {
  if (p.stocked || p.cost === null || p.price !== null) return
  p.price = tirePriceFromCost(await loadSettings(db), p.cost)
}

function duplicateSku(error: unknown): never {
  if ((error as { code?: string }).code === '23505') {
    throw new ConflictError('That SKU is already in the catalog. This product may already exist; search for it instead.')
  }
  throw error
}

const columns: [keyof ProductInput, string][] = [
  ['sku', 'sku'],
  ['brand', 'brand'],
  ['model', 'model'],
  ['tireSize', 'tire_size'],
  ['cost', 'cost'],
  ['price', 'price'],
  ['productType', 'product_type'],
  ['condition', 'condition'],
  ['stocked', 'stocked'],
  ['minQty', 'min_qty'],
  ['supplier', 'supplier'],
  ['tireClassOverride', 'tire_class_override'],
  ['loadIndex', 'load_index'],
  ['loadIndexDual', 'load_index_dual'],
  ['speedRating', 'speed_rating'],
  ['loadRange', 'load_range'],
  ['extraLoad', 'extra_load'],
  ['sizeAlt', 'size_alt'],
  ['treadDepth32nds', 'tread_depth_32nds'],
  ['utqgTreadwear', 'utqg_treadwear'],
  ['utqgTraction', 'utqg_traction'],
  ['utqgTemperature', 'utqg_temperature'],
  ['maxLoadLbs', 'max_load_lbs'],
  ['maxLoadPsi', 'max_load_psi'],
  ['sidewall', 'sidewall'],
  ['sizeWarrantyMiles', 'warranty_miles'],
]

// Tires belong to the line for their brand + model. If the request includes
// line details (season, warranty...), they're saved on the line, which every
// size of that brand and model shares.
async function lineFor(client: PoolClient, p: ProductInput, body: Body) {
  if (p.productType !== 'tire') return null
  const lineId = await findOrCreateLine(client, p.brand, p.model)
  if (body.line && typeof body.line === 'object') await saveLineDetails(client, lineId, readLineDetails(asBody(body.line)))
  // Brand and model follow the line's spelling.
  const line = await client.query('SELECT brand, model FROM tire_lines WHERE id = $1', [lineId])
  p.brand = line.rows[0].brand
  p.model = line.rows[0].model
  return lineId
}

async function recordMovement(
  client: PoolClient,
  productId: string,
  type: 'receipt' | 'adjustment',
  delta: number,
  note: string | null,
) {
  await client.query(
    `INSERT INTO inventory_movements (product_id, movement_type, quantity_delta, note) VALUES ($1, $2, $3, $4)`,
    [productId, type, delta, note],
  )
}

// New catalog product. Body may include initialQty to put stock on the shelf,
// and line: {season, warrantyMiles, ...} for its tire line.
productsRouter.post('/', async (req, res) => {
  const body = asBody(req.body)
  const p = readProduct(body)
  const initialQty = optionalNumber(body, 'initialQty', 'Quantity on hand', { min: 0, integer: true }) ?? 0

  const id = await withTransaction(async (client) => {
    await priceFromCostIfBlank(client, p)
    const lineId = await lineFor(client, p, body)
    let inserted
    try {
      inserted = await client.query(
        `
          INSERT INTO products (${columns.map(([, c]) => c).join(', ')}, tire_line_id, cost_updated_at)
          VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}, $${columns.length + 1},
                  CASE WHEN $5::numeric IS NULL THEN NULL ELSE NOW() END)
          RETURNING id::text AS id
        `,
        [...columns.map(([k]) => p[k]), lineId],
      )
    } catch (error) {
      duplicateSku(error)
    }
    const productId: string = inserted.rows[0].id
    await client.query(`INSERT INTO inventory_stock (product_id, on_hand_qty) VALUES ($1, $2)`, [productId, initialQty])
    if (initialQty > 0) await recordMovement(client, productId, 'receipt', initialQty, 'Opening stock')
    return productId
  })

  res.status(201).json({ product: await loadProduct(pool, id) })
})

// Edit catalog details. Prices on existing quotes never change.
productsRouter.put('/:id', async (req, res) => {
  const id = idParam(req.params.id)
  const body = asBody(req.body)
  const p = readProduct(body)
  await withTransaction(async (client) => {
    await priceFromCostIfBlank(client, p)
    const lineId = await lineFor(client, p, body)
    try {
      const result = await client.query(
        `
          UPDATE products
          SET ${columns.map(([, c], i) => `${c} = $${i + 2}`).join(', ')},
              tire_line_id = $${columns.length + 2},
              cost_updated_at = CASE WHEN cost IS DISTINCT FROM $6::numeric THEN NOW() ELSE cost_updated_at END,
              updated_at = NOW()
          WHERE id = $1
        `,
        [id, ...columns.map(([k]) => p[k]), lineId],
      )
      if (result.rowCount === 0) throw new NotFoundError('Product not found')
    } catch (error) {
      duplicateSku(error)
    }
  })
  res.json({ product: await loadProduct(pool, id) })
})

// Today's cost, typed while quoting. Saved with the date. A special-order
// tire's price is worked out from it (Settings markup and minimum profit)
// unless a price is given; stocked items keep their own price.
productsRouter.post('/:id/cost', async (req, res) => {
  const id = idParam(req.params.id)
  const body = asBody(req.body)
  const cost = requiredNumber(body, 'cost', 'Cost', { min: 0, money: true })
  const given = optionalNumber(body, 'price', 'Price', { min: 0, money: true })
  const settings = await loadSettings()
  const current = await loadProduct(pool, id)
  const price = given ?? (current.stocked && current.price !== null ? current.price : tirePriceFromCost(settings, cost))
  await pool.query(
    'UPDATE products SET cost = $2, price = $3, cost_updated_at = NOW(), updated_at = NOW() WHERE id = $1',
    [id, cost, price],
  )
  res.json({ product: await loadProduct(pool, id) })
})

// Change what's on the shelf.
//   { mode: 'receive', quantity: 4 }  - tires came in outside of an order
//   { mode: 'count', quantity: 7 }    - a physical count; sets on hand to 7
productsRouter.post('/:id/stock', async (req, res) => {
  const id = idParam(req.params.id)
  const body = asBody(req.body)
  const mode = body.mode
  if (mode !== 'receive' && mode !== 'count') throw new ValidationError('Choose receive or count')
  const quantity = requiredNumber(body, 'quantity', 'Quantity', { min: mode === 'receive' ? 1 : 0, integer: true })
  const note = optionalText(body, 'note')

  await withTransaction(async (client) => {
    const exists = await client.query('SELECT 1 FROM products WHERE id = $1', [id])
    if (exists.rowCount === 0) throw new NotFoundError('Product not found')
    await client.query('INSERT INTO inventory_stock (product_id) VALUES ($1) ON CONFLICT (product_id) DO NOTHING', [id])
    const stock = await client.query(
      `SELECT on_hand_qty AS "onHand", reserved_qty AS reserved FROM inventory_stock WHERE product_id = $1 FOR UPDATE`,
      [id],
    )
    const { onHand, reserved } = stock.rows[0]
    const newOnHand = mode === 'receive' ? onHand + quantity : quantity
    if (newOnHand < reserved) {
      throw new ConflictError(`${reserved} of these are reserved for customers, so on hand can't go below ${reserved}.`)
    }
    const delta = newOnHand - onHand
    if (delta === 0) throw new ValidationError('That is already the count on hand')
    await client.query(`UPDATE inventory_stock SET on_hand_qty = $2, updated_at = NOW() WHERE product_id = $1`, [
      id,
      newOnHand,
    ])
    await recordMovement(
      client,
      id,
      mode === 'receive' ? 'receipt' : 'adjustment',
      delta,
      note ?? (mode === 'receive' ? 'Received' : 'Stock count'),
    )
  })

  res.json({ product: await loadProduct(pool, id) })
})

// Recent stock history for one product.
productsRouter.get('/:id/movements', async (req, res) => {
  const id = idParam(req.params.id)
  const result = await pool.query(
    `
      SELECT id::text AS id, movement_type AS "movementType", quantity_delta AS "quantityDelta",
             note, created_at AS "createdAt"
      FROM inventory_movements
      WHERE product_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 50
    `,
    [id],
  )
  res.json({ movements: result.rows })
})
