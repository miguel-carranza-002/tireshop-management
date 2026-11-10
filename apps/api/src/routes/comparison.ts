// Comparing tires on a quote, and saving up to three quoted options.
import { Router } from 'express'
import type { PoolClient } from 'pg'
import {
  alternateSizes,
  alternatesAllowed,
  closestMatches,
  filterMisses,
  loadLevels,
  needsBanner,
  noFilters,
  optionWarnings,
  outTheDoor,
  pickTiers,
  sizeKey,
  tiersForChosen,
  type DriveType,
  type LoadLevel,
  type TireFilters,
  type VehicleNeeds,
} from '../comparison.js'
import { pool, withTransaction, type Queryable } from '../db.js'
import { defaultDifficultyMinutes, parseTireSize, type Settings } from '../pricing.js'
import { asBody, ConflictError, idParam, NotFoundError, optionalText, requiredNumber, ValidationError } from '../validation.js'
import { loadSettings } from './settings.js'
import { readTireRequest } from '../tireRequest.js'
import { seasons, tireTypes } from './tireLines.js'
import { loadTicketDetail, lockTicket, lockWorkItem, rebuildGeneratedLines, type WorkItem } from './tickets.js'

// Mounted on /api/tickets and /api/work-items.
export const comparisonRouter = Router()
export const optionPickRouter = Router()

type CatalogTire = {
  id: string
  brand: string
  model: string
  tireSize: string
  condition: 'new' | 'used'
  stocked: boolean
  supplier: string | null
  price: number | null
  cost: number | null
  costUpdatedAt: string | null
  tireClassOverride: 'car' | 'truck' | null
  loadIndex: number | null
  loadIndexDual: number | null
  speedRating: string | null
  loadRange: string | null
  extraLoad: boolean
  tireLineId: string | null
  sizeAlt: string | null
  tireType: string | null
  season: string | null
  warrantyMiles: number | null
  roadHazard: boolean
  runFlat: boolean
  evRated: boolean
  severeSnow: boolean
  hasPhoto: boolean
  photoUpdatedAt: string | null
  availableQty: number
}

async function loadCatalogTires(db: Queryable): Promise<CatalogTire[]> {
  const result = await db.query(`
    SELECT
      p.id::text AS id, p.brand, p.model, p.tire_size AS "tireSize", p.condition, p.stocked, p.supplier,
      p.price::float8 AS price, p.cost::float8 AS cost, p.cost_updated_at AS "costUpdatedAt",
      p.tire_class_override AS "tireClassOverride",
      p.load_index AS "loadIndex", p.load_index_dual AS "loadIndexDual", p.speed_rating AS "speedRating",
      p.load_range AS "loadRange", p.extra_load AS "extraLoad",
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
      l.season, COALESCE(p.warranty_miles, l.warranty_miles) AS "warrantyMiles",
      COALESCE(l.run_flat, FALSE) AS "runFlat", COALESCE(l.ev_rated, FALSE) AS "evRated",
      COALESCE(l.severe_snow, FALSE) AS "severeSnow",
      (ph.tire_line_id IS NOT NULL) AS "hasPhoto", ph.updated_at AS "photoUpdatedAt",
      (COALESCE(s.on_hand_qty, 0) - COALESCE(s.reserved_qty, 0))::int AS "availableQty"
    FROM products p
    LEFT JOIN inventory_stock s ON s.product_id = p.id
    LEFT JOIN tire_lines l ON l.id = p.tire_line_id
    LEFT JOIN tire_line_photos ph ON ph.tire_line_id = p.tire_line_id
    WHERE p.product_type = 'tire'
  `)
  return result.rows
}

type VehicleRow = VehicleNeeds & {
  tireSize: string | null
  rearTireSize: string | null
  driveType: DriveType
}

async function loadTicketVehicle(db: Queryable, ticketId: string) {
  const result = await db.query(
    `
      SELECT t.status, t.tax_rate::float8 AS "taxRate",
             v.tire_size AS "tireSize", v.rear_tire_size AS "rearTireSize", v.drive_type AS "driveType",
             v.is_ev AS "isEv", v.heavy_duty AS "heavyDuty", v.run_flat AS "runFlat",
             v.required_load_index AS "requiredLoadIndex", v.required_load_range AS "requiredLoadRange",
             v.required_speed_rating AS "requiredSpeedRating"
      FROM tickets t JOIN vehicles v ON v.id = t.vehicle_id
      WHERE t.id = $1
    `,
    [ticketId],
  )
  if (result.rowCount === 0) throw new NotFoundError('Ticket not found')
  return result.rows[0] as VehicleRow & { status: string; taxRate: number }
}

// One tire as the comparison shows it, priced out the door for the quantity.
function describe(t: CatalogTire, v: VehicleNeeds, settings: Settings, taxRate: number, quantity: number) {
  const priced = t.price !== null ? outTheDoor(settings, taxRate, { ...t, price: t.price }, quantity) : null
  return {
    ...t,
    availability: t.availableQty >= quantity ? 'in_stock' : t.stocked && t.availableQty > 0 ? 'partial' : 'order',
    diameterIn: parseTireSize(t.tireSize, settings).diameterIn,
    outTheDoor: priced,
    warnings: optionWarnings(v, t),
  }
}

export async function buildComparison(
  db: Queryable,
  ticketId: string,
  query: {
    size: string | null
    quantity: number
    axle: 'front' | 'rear' | null
    extra?: string[]
    filters?: TireFilters
  },
) {
  const [ticket, settings, catalog] = await Promise.all([loadTicketVehicle(db, ticketId), loadSettings(db), loadCatalogTires(db)])
  const staggered = !!ticket.rearTireSize && sizeKey(ticket.rearTireSize) !== sizeKey(ticket.tireSize)
  const vehicleSize = query.axle === 'rear' ? ticket.rearTireSize : ticket.tireSize
  const target = query.size?.trim() || vehicleSize
  const base = {
    vehicleSize: vehicleSize ?? null,
    staggered,
    axle: query.axle,
    quantity: query.quantity,
    banner: needsBanner(ticket),
  }
  // No size: say so. Nothing is guessed from the year, make and model.
  if (!target) return { ...base, size: null, needsSize: true as const }

  const key = sizeKey(target)
  const filters = query.filters ?? noFilters
  const misses = (t: CatalogTire) => filterMisses(t, filters)
  const show = (t: CatalogTire) => ({
    ...describe(t, ticket, settings, ticket.taxRate, query.quantity),
    misses: misses(t),
  })
  // A size typed either way finds the tire: LT285/55R20 or 33X12.50R20LT.
  const sameSize = (t: CatalogTire, k: string) => sizeKey(t.tireSize) === k || (!!t.sizeAlt && sizeKey(t.sizeAlt) === k)
  const exact = catalog.filter((t) => sameSize(t, key))
  const fresh = exact.filter((t) => t.condition === 'new')
  // The three come only from tires on the shelf for the whole job, at their
  // real price. Anything else is ordered in: listed for the advisor to add
  // with today's cost (supplier costs go stale, so an old one is never used
  // on its own).
  const onShelf = (t: CatalogTire) => t.availableQty >= query.quantity
  // Filters narrow each list; when nothing meets all of them, the tires
  // missing the fewest stay (the size always comes first).
  const priced = closestMatches(
    fresh.filter((t) => t.price !== null && onShelf(t)) as (CatalogTire & { price: number })[],
    misses,
  )
  const tiers = pickTiers(priced)
  const chosen = new Set(tiers.map((t) => t.item.id))
  // Shelf tires we're short on first (they have a real price), then A-Z.
  const orderIn = closestMatches(
    fresh.filter((t) => !onShelf(t)),
    misses,
  ).sort((a, b) => Number(b.stocked) - Number(a.stocked) || `${a.brand} ${a.model}`.localeCompare(`${b.brand} ${b.model}`))

  const rule = alternatesAllowed(ticket.driveType, query.quantity)
  const sizes = rule.allowed ? alternateSizes(key, settings) : []
  const alternates = closestMatches(
    sizes.flatMap((alt) =>
      catalog
        .filter((t) => t.condition === 'new' && t.price !== null && onShelf(t) && sameSize(t, alt.size))
        .map((t) => ({ ...show(t), diffPercent: alt.diffPercent })),
    ),
    (o) => o.misses,
  )

  // Tires the advisor picked from the whole catalog (any size). Shown even
  // when not on the shelf; another size says how much taller or shorter.
  const targetDiameter = parseTireSize(key, settings).diameterIn
  const listed = new Set([...exact, ...alternates].map((t) => t.id))
  const added = [...new Set(query.extra ?? [])]
    .filter((id) => !listed.has(id))
    .map((id) => catalog.find((t) => t.id === id))
    .filter((t): t is CatalogTire => !!t)
    .map((t) => {
      const option = show(t)
      const diff = targetDiameter && option.diameterIn ? ((option.diameterIn - targetDiameter) / targetDiameter) * 100 : null
      return { ...option, diffPercent: sameSize(t, key) || diff === null ? undefined : Math.round(diff * 10) / 10 }
    })

  const shortOfFilters = tiers.length > 0 && misses(tiers[0].item).length > 0
  return {
    ...base,
    size: key,
    needsSize: false as const,
    // Brands the catalog has in this size or its similar sizes, for the brand filter.
    brands: [
      ...new Set(
        catalog
          .filter((t) => t.condition === 'new' && (sameSize(t, key) || sizes.some((alt) => sameSize(t, alt.size))))
          .map((t) => t.brand),
      ),
    ].sort((a, b) => a.localeCompare(b)),
    filterNote: shortOfFilters
      ? `Nothing on the shelf in ${key} meets every filter. The closest are shown, with what they miss.`
      : null,
    added,
    tiers: tiers.map(({ item, tier }) => ({ tier, option: show(item) })),
    others: priced
      .filter((t) => !chosen.has(t.id))
      .sort((a, b) => a.price - b.price)
      .map(show),
    orderIn: orderIn.map(show),
    used: exact.filter((t) => t.condition === 'used' && t.availableQty > 0).map(show),
    alternates: {
      allowed: rule.allowed,
      reason: rule.reason,
      sizes,
      options: alternates.sort((a, b) => (a.price ?? 0) - (b.price ?? 0)),
    },
  }
}

const readQuantity = (raw: unknown) => {
  const q = Number(raw ?? 4)
  if (!Number.isInteger(q) || q < 1 || q > 8) throw new ValidationError('Number of tires must be 1 to 8')
  return q
}
const readAxle = (raw: unknown) => (raw === 'front' || raw === 'rear' ? raw : null)

comparisonRouter.get('/:id/tire-options', async (req, res) => {
  const id = idParam(req.params.id)
  res.json(
    await buildComparison(pool, id, {
      size: typeof req.query.size === 'string' ? req.query.size : null,
      quantity: readQuantity(req.query.quantity),
      axle: readAxle(req.query.axle),
      extra: typeof req.query.extra === 'string' ? req.query.extra.split(',').filter((id) => /^\d+$/.test(id)) : [],
      filters: readFilters(req.query),
    }),
  )
})

// ?brands=Celimo,Milestar&minWarranty=40000&season=all_season&tireType=highway
// &minLoad=E&maxPrice=120&roadHazard=true. Anything unknown is ignored.
function readFilters(q: Record<string, unknown>): TireFilters {
  const text = (k: string) => (typeof q[k] === 'string' ? (q[k] as string).trim() : '')
  const number = (k: string) => {
    const n = Number(text(k))
    return text(k) !== '' && Number.isFinite(n) && n > 0 ? n : null
  }
  const pick = <T extends string>(k: string, allowed: readonly T[]) =>
    (allowed as readonly string[]).includes(text(k)) ? (text(k) as T) : null
  return {
    brands: text('brands')
      .split(',')
      .map((b) => b.trim())
      .filter(Boolean),
    minWarranty: number('minWarranty'),
    season: pick('season', seasons),
    tireType: pick('tireType', tireTypes),
    minLoad: pick<LoadLevel>('minLoad', loadLevels),
    maxPrice: number('maxPrice'),
    roadHazard: text('roadHazard') === 'true',
  }
}

// What the advisor typed ("4 215/55r16 road hazard 40k+"), read into the
// number of tires, size and filters. The dialog applies them; nothing is saved.
comparisonRouter.post('/:id/tire-request', async (req, res) => {
  idParam(req.params.id)
  const body = asBody(req.body)
  const text = optionalText(body, 'text') ?? ''
  if (!text) throw new ValidationError('Type what the customer is asking for')
  if (text.length > 500) throw new ValidationError('Keep it to a sentence or two')
  const quantity = readQuantity(body.quantity)
  const result = await pool.query<{ brand: string }>(
    `SELECT DISTINCT brand FROM products WHERE condition = 'new' AND brand <> ''`,
  )
  res.json(readTireRequest(text, result.rows.map((r) => r.brand), quantity))
})

// Save up to three options on the quote, prices locked as shown. Creates a
// Tires item with no tire picked yet, or replaces the options on one.
comparisonRouter.post('/:id/tire-options', async (req, res) => {
  const ticketId = idParam(req.params.id)
  const body = asBody(req.body)
  const quantity = readQuantity(body.quantity)
  const axle = readAxle(body.axle)
  const size = sizeKey(optionalText(body, 'size') ?? '')
  if (!size) throw new ValidationError('Which size are the options for?')
  const ids = Array.isArray(body.productIds) ? [...new Set(body.productIds.map(String))] : []
  if (ids.length < 1 || ids.length > 3) throw new ValidationError('Pick one to three tires to quote')
  const workItemId = body.workItemId ? idParam(String(body.workItemId)) : null

  await withTransaction(async (client) => {
    await lockTicket(client, ticketId) // quotes only
    const [ticket, settings, catalog] = await Promise.all([
      loadTicketVehicle(client, ticketId),
      loadSettings(client),
      loadCatalogTires(client),
    ])
    const tires = ids.map((pid) => catalog.find((t) => t.id === pid))
    if (tires.some((t) => !t)) throw new ValidationError('One of those tires is not in the catalog')
    if (tires.some((t) => t!.price === null)) throw new ValidationError('Enter today’s cost for each tire before quoting it')
    const ordered = (tires as (CatalogTire & { price: number })[]).sort((a, b) => a.price - b.price)
    const tiers = tiersForChosen(ordered.length)

    let itemId = workItemId
    if (itemId) {
      const item = await client.query(
        `SELECT 1 FROM work_items WHERE id = $1 AND ticket_id = $2 AND item_type = 'tires' AND tire_product_id IS NULL AND NOT customer_supplied_tires`,
        [itemId, ticketId],
      )
      if (item.rowCount === 0) throw new ConflictError('Those options can only replace options that haven’t been picked')
      await client.query('UPDATE work_items SET options_size = $2, tire_quantity = $3, old_tires_removed = $3 WHERE id = $1', [
        itemId,
        size,
        quantity,
      ])
      await client.query('DELETE FROM tire_options WHERE work_item_id = $1', [itemId])
    } else {
      const created = await client.query(
        `
          INSERT INTO work_items (ticket_id, item_type, title, sort_order, options_size, tire_quantity, old_tires_removed)
          SELECT $1, 'tires', $2, COALESCE(MAX(sort_order) + 1, 0), $3, $4, $4 FROM work_items WHERE ticket_id = $1
          RETURNING id::text AS id
        `,
        [ticketId, axle === 'front' ? 'Front' : axle === 'rear' ? 'Rear' : null, size, quantity],
      )
      itemId = created.rows[0].id as string
    }

    for (const [i, t] of ordered.entries()) {
      const otd = outTheDoor(settings, ticket.taxRate, t, quantity)
      await client.query(
        `
          INSERT INTO tire_options (work_item_id, position, tier, product_id, description, tire_size, quantity, unit_price, unit_cost, total)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [itemId, i + 1, tiers[i], t.id, `${t.brand} ${t.model} ${t.tireSize}`, t.tireSize, quantity, t.price, t.cost, otd.total],
      )
    }
  })

  res.json({ ticket: await loadTicketDetail(pool, ticketId) })
})

// The customer chose: the option becomes the item's tire, at the quoted price.
optionPickRouter.post('/:id/pick-option', async (req, res) => {
  const workItemId = idParam(req.params.id)
  const optionId = String(asBody(req.body).optionId ?? '')
  const ticketId = await withTransaction(async (client: PoolClient) => {
    const { ticketId, vehicle } = await lockWorkItem(client, workItemId) // quotes only
    const option = await client.query(
      `SELECT product_id::text AS "productId", quantity, unit_price::float8 AS "unitPrice"
       FROM tire_options WHERE id = $1 AND work_item_id = $2`,
      [optionId, workItemId],
    )
    if (option.rowCount === 0) throw new NotFoundError('That option is not on this work item')
    const o = option.rows[0]
    const settings = await loadSettings(client)
    const product = await client.query(
      `SELECT tire_size AS "tireSize", tire_class_override AS "tireClassOverride" FROM products WHERE id = $1`,
      [o.productId],
    )
    const difficulty = defaultDifficultyMinutes(
      parseTireSize(product.rows[0].tireSize, settings, product.rows[0].tireClassOverride),
    )

    const updated = await client.query(
      `
        UPDATE work_items
        SET tire_product_id = $2, tire_quantity = $3, old_tires_removed = $3, options_size = NULL,
            difficulty_minutes = $4
        WHERE id = $1
        RETURNING id::text AS id, ticket_id::text AS "ticketId", item_type AS "itemType", title,
                  customer_supplied_tires AS "customerSuppliedTires", tire_product_id::text AS "tireProductId",
                  tire_quantity AS "tireQuantity", old_tires_removed AS "oldTiresRemoved",
                  customer_tire_size AS "customerTireSize", difficulty_minutes AS "difficultyMinutes"
      `,
      [workItemId, o.productId, o.quantity, difficulty],
    )
    await client.query('DELETE FROM tire_options WHERE work_item_id = $1', [workItemId])
    await rebuildGeneratedLines(client, updated.rows[0] as WorkItem, vehicle, settings)
    // The price quoted to the customer, even if the catalog has moved since.
    await client.query(
      `UPDATE line_items SET unit_price = $3 WHERE work_item_id = $1 AND product_id = $2 AND generated`,
      [workItemId, o.productId, o.unitPrice],
    )
    return ticketId
  })
  res.json({ ticket: await loadTicketDetail(pool, ticketId) })
})
