// Tire lines: brand + model, with what's shared by every size (type,
// season, warranty, road hazard, run-flat, EV, severe snow) and one tread photo.
import { Router } from 'express'
import type { PoolClient } from 'pg'
import { pool, withTransaction, type Queryable } from '../db.js'
import {
  asBody,
  ConflictError,
  idParam,
  NotFoundError,
  optionalBoolean,
  optionalNumber,
  optionalText,
  requiredText,
  ValidationError,
  type Body,
} from '../validation.js'

export const tireLinesRouter = Router()

export const seasons = ['all_season', 'all_weather', 'summer', 'winter'] as const
export const tireTypes = ['touring', 'performance', 'highway', 'all_terrain', 'rugged_terrain', 'mud_terrain'] as const

export const lineColumns = `
  l.id::text AS id,
  l.brand,
  l.model,
  l.tire_type AS "tireType",
  l.season,
  l.warranty_miles AS "warrantyMiles",
  l.road_hazard AS "roadHazard",
  l.run_flat AS "runFlat",
  l.ev_rated AS "evRated",
  l.severe_snow AS "severeSnow",
  l.notes,
  (ph.tire_line_id IS NOT NULL) AS "hasPhoto",
  ph.updated_at AS "photoUpdatedAt"
`

export type LineDetails = {
  tireType: string | null
  season: string | null
  warrantyMiles: number | null
  roadHazard: boolean
  runFlat: boolean
  evRated: boolean
  severeSnow: boolean
  notes: string | null
}

export function readLineDetails(body: Body): LineDetails {
  const season = body.season === '' || body.season == null ? null : String(body.season)
  if (season && !(seasons as readonly string[]).includes(season)) throw new ValidationError('Unknown season')
  const tireType = body.tireType === '' || body.tireType == null ? null : String(body.tireType)
  if (tireType && !(tireTypes as readonly string[]).includes(tireType)) throw new ValidationError('Unknown tire type')
  return {
    tireType,
    season,
    warrantyMiles: optionalNumber(body, 'warrantyMiles', 'Warranty miles', { min: 0, integer: true }),
    roadHazard: optionalBoolean(body, 'roadHazard', false),
    runFlat: optionalBoolean(body, 'runFlat', false),
    evRated: optionalBoolean(body, 'evRated', false),
    severeSnow: optionalBoolean(body, 'severeSnow', false),
    notes: optionalText(body, 'notes'),
  }
}

async function loadLine(db: Queryable, id: string) {
  const result = await db.query(
    `
      SELECT ${lineColumns},
        (SELECT COUNT(*)::int FROM products p WHERE p.tire_line_id = l.id) AS "sizeCount"
      FROM tire_lines l LEFT JOIN tire_line_photos ph ON ph.tire_line_id = l.id
      WHERE l.id = $1
    `,
    [id],
  )
  if (result.rowCount === 0) throw new NotFoundError('Tire line not found')
  return result.rows[0]
}

function duplicate(error: unknown): never {
  if ((error as { code?: string }).code === '23505') {
    throw new ConflictError('That brand and model is already a tire line')
  }
  throw error
}

// The line for a brand + model, created if it's new (case doesn't matter).
export async function findOrCreateLine(client: PoolClient, brand: string, model: string): Promise<string> {
  const found = await client.query(
    'SELECT id::text AS id FROM tire_lines WHERE LOWER(brand) = LOWER($1) AND LOWER(model) = LOWER($2)',
    [brand, model],
  )
  if (found.rowCount! > 0) return found.rows[0].id
  const created = await client.query(
    'INSERT INTO tire_lines (brand, model) VALUES ($1, $2) RETURNING id::text AS id',
    [brand, model],
  )
  return created.rows[0].id
}

export async function saveLineDetails(client: Queryable, id: string, d: LineDetails) {
  await client.query(
    `
      UPDATE tire_lines
      SET season = $2, warranty_miles = $3, run_flat = $4, ev_rated = $5, severe_snow = $6, notes = $7,
          tire_type = $8, road_hazard = $9, updated_at = NOW()
      WHERE id = $1
    `,
    [id, d.season, d.warrantyMiles, d.runFlat, d.evRated, d.severeSnow, d.notes, d.tireType, d.roadHazard],
  )
}

tireLinesRouter.get('/', async (_req, res) => {
  const result = await pool.query(`
    SELECT ${lineColumns},
      (SELECT COUNT(*)::int FROM products p WHERE p.tire_line_id = l.id) AS "sizeCount"
    FROM tire_lines l LEFT JOIN tire_line_photos ph ON ph.tire_line_id = l.id
    ORDER BY l.brand, l.model
  `)
  res.json({ lines: result.rows })
})

tireLinesRouter.post('/', async (req, res) => {
  const body = asBody(req.body)
  const brand = requiredText(body, 'brand', 'Brand')
  const model = requiredText(body, 'model', 'Model')
  const details = readLineDetails(body)
  const id = await withTransaction(async (client) => {
    let created
    try {
      created = await client.query('INSERT INTO tire_lines (brand, model) VALUES ($1, $2) RETURNING id::text AS id', [
        brand,
        model,
      ])
    } catch (error) {
      duplicate(error)
    }
    await saveLineDetails(client, created.rows[0].id, details)
    return created.rows[0].id as string
  })
  res.status(201).json({ line: await loadLine(pool, id) })
})

// Edit a line. Renaming it renames every size in it.
tireLinesRouter.put('/:id', async (req, res) => {
  const id = idParam(req.params.id)
  const body = asBody(req.body)
  const brand = requiredText(body, 'brand', 'Brand')
  const model = requiredText(body, 'model', 'Model')
  const details = readLineDetails(body)
  await withTransaction(async (client) => {
    try {
      const updated = await client.query('UPDATE tire_lines SET brand = $2, model = $3 WHERE id = $1', [id, brand, model])
      if (updated.rowCount === 0) throw new NotFoundError('Tire line not found')
    } catch (error) {
      duplicate(error)
    }
    await saveLineDetails(client, id, details)
    await client.query('UPDATE products SET brand = $2, model = $3, updated_at = NOW() WHERE tire_line_id = $1', [
      id,
      brand,
      model,
    ])
  })
  res.json({ line: await loadLine(pool, id) })
})

// Tread photo. The screen resizes it to about 800px before sending, as a data URL.
tireLinesRouter.put('/:id/photo', async (req, res) => {
  const id = idParam(req.params.id)
  const dataUrl = String(asBody(req.body).dataUrl ?? '')
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/)
  if (!match) throw new ValidationError('Send a JPEG, PNG or WebP image')
  const data = Buffer.from(match[2], 'base64')
  if (data.length > 2_000_000) throw new ValidationError('That photo is too large (2 MB at most)')
  await loadLine(pool, id)
  await pool.query(
    `
      INSERT INTO tire_line_photos (tire_line_id, content_type, data) VALUES ($1, $2, $3)
      ON CONFLICT (tire_line_id) DO UPDATE SET content_type = EXCLUDED.content_type, data = EXCLUDED.data, updated_at = NOW()
    `,
    [id, match[1], data],
  )
  res.json({ line: await loadLine(pool, id) })
})

tireLinesRouter.get('/:id/photo', async (req, res) => {
  const id = idParam(req.params.id)
  const result = await pool.query(
    'SELECT content_type AS "contentType", data, updated_at AS "updatedAt" FROM tire_line_photos WHERE tire_line_id = $1',
    [id],
  )
  if (result.rowCount === 0) throw new NotFoundError('No photo for this tire line')
  const photo = result.rows[0]
  res.setHeader('Content-Type', photo.contentType)
  // Screens add ?v=<updated time> to the URL, so a cached photo is never stale.
  res.setHeader('Cache-Control', 'private, max-age=86400')
  res.send(photo.data)
})

tireLinesRouter.delete('/:id/photo', async (req, res) => {
  const id = idParam(req.params.id)
  await pool.query('DELETE FROM tire_line_photos WHERE tire_line_id = $1', [id])
  res.json({ line: await loadLine(pool, id) })
})
