// Supplier tire catalog files -> tire lines and sizes.
//
// A file is CSV or tab-separated with a header row. Column names are matched
// loosely (case, spaces and punctuation don't matter) and only brand, model
// and size are required. Every imported size is a special-order tire with no
// stock, cost or price: the advisor enters today's cost when quoting.
//
// Re-importing is safe. Lines are matched by brand + model and sizes by size
// within the line (case-insensitive), so nothing is duplicated. Specs from
// the file update what's there; stock, cost, price, SKU and tickets are never
// touched. A line's type and season are only filled in when blank, so an
// advisor's correction sticks.
import type { PoolClient } from 'pg'
import { sizeKey } from './comparison.js'
import { parseTireSize } from './pricing.js'

// ---------------------------------------------------------------------------
// Reading the file
// ---------------------------------------------------------------------------

// CSV (with "quoted, fields") or tab-separated, whichever the header uses.
export function parseDelimited(text: string): string[][] {
  const clean = text.replace(/^﻿/, '')
  const firstLine = clean.slice(0, clean.indexOf('\n') === -1 ? undefined : clean.indexOf('\n'))
  const sep = firstLine.includes('\t') ? '\t' : ','
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === sep) {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''))
}

type Field =
  | 'brand'
  | 'model'
  | 'size'
  | 'sizeAlt'
  | 'serviceIndex'
  | 'loadIndex'
  | 'speedRating'
  | 'loadRange'
  | 'type'
  | 'season'
  | 'warranty'
  | 'roadHazard'
  | 'sidewall'
  | 'treadDepth'
  | 'maxLoad'
  | 'utqg'
  | 'category'

// Header names each field goes by, lower case with only letters and digits.
const aliases: Record<Field, string[]> = {
  brand: ['brand', 'manufacturer', 'mfg', 'mfr'],
  model: ['model', 'pattern', 'tread', 'treadname', 'line', 'tireline'],
  size: ['size', 'tiresize'],
  sizeAlt: ['sizealt', 'altsize', 'alternatesize', 'flotationsize'],
  serviceIndex: ['serviceindex', 'servicedescription', 'loadspeed', 'loadspeedindex'],
  loadIndex: ['loadindex', 'li'],
  speedRating: ['speedrating', 'speed', 'speedsymbol'],
  loadRange: ['lrpr', 'loadrange', 'plyrating', 'ply', 'lr', 'loadrangeply'],
  type: ['type', 'tiretype', 'terrain', 'subcategory'],
  season: ['season'],
  warranty: ['warranty', 'warrantymiles', 'treadwarranty', 'mileagewarranty', 'treadlifewarranty'],
  roadHazard: ['roadhazard', 'roadhazardwarranty'],
  sidewall: ['sidewall', 'sidewallstyle'],
  treadDepth: ['treaddepth', 'treaddepth32nds'],
  maxLoad: ['maxload', 'maxloadlbs', 'maximumload'],
  utqg: ['utqg'],
  category: ['category', 'class'],
}

const headerKey = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '')

export function mapHeader(header: string[]) {
  const columns: Partial<Record<Field, number>> = {}
  const ignored: string[] = []
  header.forEach((h, i) => {
    const key = headerKey(h)
    const field = (Object.keys(aliases) as Field[]).find((f) => aliases[f].includes(key))
    if (field && columns[field] === undefined) columns[field] = i
    else ignored.push(h)
  })
  const missing = (['brand', 'model', 'size'] as Field[]).filter((f) => columns[f] === undefined)
  return { columns, ignored, missing }
}

// ---------------------------------------------------------------------------
// One row -> one tire size
// ---------------------------------------------------------------------------

export type ImportedTire = {
  row: number
  brand: string
  model: string
  size: string
  sizeAlt: string | null
  loadIndex: number | null
  loadIndexDual: number | null
  speedRating: string | null
  loadRange: string | null
  extraLoad: boolean
  // null = not in the file; 0 = no mileage warranty.
  warrantyMiles: number | null
  roadHazard: boolean | null
  sidewall: string | null
  treadDepth32nds: number | null
  utqgTreadwear: number | null
  utqgTraction: string | null
  utqgTemperature: string | null
  maxLoadLbs: number | null
  maxLoadPsi: number | null
  tireType: string | null
  season: string | null
  severeSnow: boolean
}

const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')

const typeWords: Record<string, string> = {
  performance: 'performance',
  highperformance: 'performance',
  ultrahighperformance: 'performance',
  allseason: 'touring',
  touring: 'touring',
  grandtouring: 'touring',
  standardtouring: 'touring',
  passenger: 'touring',
  allseasonhighway: 'highway',
  highway: 'highway',
  highwayterrain: 'highway',
  ht: 'highway',
  allterrain: 'all_terrain',
  at: 'all_terrain',
  ruggedterrain: 'rugged_terrain',
  rt: 'rugged_terrain',
  hybridterrain: 'rugged_terrain',
  mudterrain: 'mud_terrain',
  mt: 'mud_terrain',
}

const seasonWords: Record<string, string> = {
  allseason: 'all_season',
  allweather: 'all_weather',
  summer: 'summer',
  winter: 'winter',
  snow: 'winter',
}

// "Snow Traction" in a supplier's season column: the three-peak mountain
// snowflake. On a road tire that's what all-weather means; terrain tires
// stay all-season with the severe-snow mark.
function readSeason(raw: string, tireType: string | null) {
  const word = letters(raw)
  if (!word) return { season: null, severeSnow: false, known: true }
  if (['snowtraction', 'severesnow', 'threepeak', 'threepeakmountainsnowflake', 'pmsf'].includes(word)) {
    const road = tireType === 'touring' || tireType === 'performance' || tireType === 'highway'
    return { season: road ? 'all_weather' : 'all_season', severeSnow: true, known: true }
  }
  const season = seasonWords[word] ?? null
  return { season, severeSnow: season === 'all_weather', known: season !== null }
}

const plyToRange: Record<string, string> = { '4': 'B', '6': 'C', '8': 'D', '10': 'E', '12': 'F', '14': 'G', '16': 'H' }

function readLoadRange(raw: string) {
  const t = raw.toUpperCase().replace(/\s+/g, '')
  if (!t || t === 'SL' || t === 'STD' || t === 'STANDARD') return { loadRange: null, extraLoad: false, known: true }
  if (t === 'XL' || t === 'RF' || t === 'EXTRALOAD' || t === 'REINFORCED') return { loadRange: null, extraLoad: true, known: true }
  const letter = t.match(/^(?:LR)?([B-H])(?:\/\d{1,2}(?:PR)?)?$/)
  if (letter) return { loadRange: letter[1], extraLoad: false, known: true }
  const ply = t.match(/^(\d{1,2})PR?$/)
  if (ply && plyToRange[ply[1]]) return { loadRange: plyToRange[ply[1]], extraLoad: false, known: true }
  return { loadRange: null, extraLoad: false, known: false }
}

function readWarranty(raw: string): number | null | undefined {
  const t = raw.toLowerCase().replace(/[\s,]/g, '')
  if (!t) return null
  if (['none', 'no', 'n/a', 'na', '-', '0'].includes(t)) return 0
  const m = t.match(/^(\d+(?:\.\d+)?)(k)?(?:mi|miles)?$/)
  if (!m) return undefined
  const miles = Math.round(Number(m[1]) * (m[2] ? 1000 : 1))
  return miles <= 200000 ? miles : undefined
}

function readBool(raw: string): boolean | null {
  const t = raw.trim().toLowerCase()
  if (['true', 'yes', 'y', '1', 'x'].includes(t)) return true
  if (['false', 'no', 'n', '0'].includes(t)) return false
  return null
}

const defaults = { lowProfileMaxAspect: 50, oversizedMinDiameterIn: 33 }

export function readTire(
  cells: string[],
  columns: Partial<Record<Field, number>>,
  row: number,
): { tire: ImportedTire; notes: string[] } | { error: string } {
  const get = (f: Field) => (columns[f] === undefined ? '' : (cells[columns[f]!] ?? '').trim())
  const brand = get('brand').replace(/\s+/g, ' ')
  const model = get('model').replace(/\s+/g, ' ')
  const size = get('size').toUpperCase().replace(/\s+/g, '')
  if (!brand || !model) return { error: 'brand or model is blank' }
  if (!size) return { error: 'size is blank' }
  if (parseTireSize(size, defaults).diameterIn === null) return { error: `can't read size "${size}"` }
  const notes: string[] = []

  let loadIndex: number | null = null
  let loadIndexDual: number | null = null
  let speedRating: string | null = null
  const service = get('serviceIndex').toUpperCase().replace(/\s+/g, '')
  if (service) {
    const m = service.match(/^(\d{2,3})(?:\/(\d{2,3}))?([LMNPQRSTUHVWYZ])$/)
    if (m) {
      loadIndex = Number(m[1])
      loadIndexDual = m[2] ? Number(m[2]) : null
      speedRating = m[3]
    } else notes.push(`service index "${service}" not understood`)
  }
  if (get('loadIndex')) loadIndex = Number(get('loadIndex')) || loadIndex
  if (get('speedRating')) speedRating = get('speedRating').toUpperCase().slice(0, 1) || speedRating
  if (loadIndex !== null && (loadIndex < 60 || loadIndex > 160)) {
    notes.push(`load index ${loadIndex} out of range`)
    loadIndex = null
  }

  const range = readLoadRange(get('loadRange'))
  if (!range.known) notes.push(`load range "${get('loadRange')}" not understood`)

  const typeRaw = get('type')
  const tireType = typeWords[letters(typeRaw)] ?? null
  if (typeRaw && !tireType) notes.push(`type "${typeRaw}" not understood`)
  const season = readSeason(get('season'), tireType)
  if (!season.known) notes.push(`season "${get('season')}" not understood`)

  const warranty = readWarranty(get('warranty'))
  if (warranty === undefined) notes.push(`warranty "${get('warranty')}" not understood`)

  const tread = get('treadDepth').match(/^(\d{1,2})(?:\/32)?/)
  const load = get('maxLoad').match(/^(\d{3,5})\s*(?:lbs?)?\s*(?:@\s*(\d{2,3}))?/i)
  const utqg = get('utqg').toUpperCase().replace(/\s+/g, ' ').match(/^(\d{2,4}) ?(AA|A|B|C) ?([ABC])$/)
  if (get('utqg') && !['-', 'N/A', 'NA'].includes(get('utqg').toUpperCase()) && !utqg) {
    notes.push(`UTQG "${get('utqg')}" not understood`)
  }
  const alt = get('sizeAlt').toUpperCase().replace(/\s+/g, '')

  return {
    tire: {
      row,
      brand,
      model,
      size,
      sizeAlt: alt || null,
      loadIndex,
      loadIndexDual,
      speedRating,
      loadRange: range.loadRange,
      extraLoad: range.extraLoad,
      warrantyMiles: warranty ?? null,
      roadHazard: readBool(get('roadHazard')),
      sidewall: get('sidewall').toUpperCase().slice(0, 20) || null,
      treadDepth32nds: tread && Number(tread[1]) >= 1 && Number(tread[1]) <= 40 ? Number(tread[1]) : null,
      utqgTreadwear: utqg ? Number(utqg[1]) : null,
      utqgTraction: utqg ? utqg[2] : null,
      utqgTemperature: utqg ? utqg[3] : null,
      maxLoadLbs: load ? Number(load[1]) : null,
      maxLoadPsi: load?.[2] ? Number(load[2]) : null,
      tireType,
      season: season.season,
      severeSnow: season.severeSnow,
    },
    notes,
  }
}

// ---------------------------------------------------------------------------
// Writing to the database
// ---------------------------------------------------------------------------

export type ImportReport = {
  rows: number
  ignoredColumns: string[]
  linesNew: string[]
  linesUpdated: number
  sizesNew: number
  sizesUpdated: number
  sizesUnchanged: number
  skipped: { row: number; reason: string }[]
  notes: { row: number; note: string }[]
}

const mostCommon = <T,>(values: T[]): T | null => {
  const counts = new Map<T, number>()
  for (const v of values) if (v !== null) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best: T | null = null
  let n = 0
  for (const [v, c] of counts) if (c > n) [best, n] = [v, c]
  return best
}

function skuFor(brand: string, model: string, size: string) {
  return [brand, model, size]
    .join('-')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// Columns written for each size (with their SQL types), in the order of
// sizeValues().
const sizeColumnTypes: [string, string][] = [
  ['size_alt', 'text'],
  ['load_index', 'integer'],
  ['load_index_dual', 'integer'],
  ['speed_rating', 'text'],
  ['load_range', 'text'],
  ['extra_load', 'boolean'],
  ['warranty_miles', 'integer'],
  ['sidewall', 'text'],
  ['tread_depth_32nds', 'smallint'],
  ['utqg_treadwear', 'smallint'],
  ['utqg_traction', 'text'],
  ['utqg_temperature', 'text'],
  ['max_load_lbs', 'integer'],
  ['max_load_psi', 'smallint'],
]
const sizeColumns = sizeColumnTypes.map(([c]) => c)
const sizeValues = (t: ImportedTire) => [
  t.sizeAlt,
  t.loadIndex,
  t.loadIndexDual,
  t.speedRating,
  t.loadRange,
  t.extraLoad,
  t.warrantyMiles,
  t.sidewall,
  t.treadDepth32nds,
  t.utqgTreadwear,
  t.utqgTraction,
  t.utqgTemperature,
  t.maxLoadLbs,
  t.maxLoadPsi,
]

// Reads the whole file and writes it with the given client (the caller owns
// the transaction, so a dry run can roll it all back).
export async function importCatalog(client: PoolClient, text: string): Promise<ImportReport> {
  const [header, ...body] = parseDelimited(text)
  if (!header) throw new Error('The file is empty')
  const { columns, ignored, missing } = mapHeader(header)
  if (missing.length > 0) throw new Error(`The file needs these columns: ${missing.join(', ')}`)

  const report: ImportReport = {
    rows: body.length,
    ignoredColumns: ignored,
    linesNew: [],
    linesUpdated: 0,
    sizesNew: 0,
    sizesUpdated: 0,
    sizesUnchanged: 0,
    skipped: [],
    notes: [],
  }

  // Group sizes by line; the same size twice keeps the first.
  const lines = new Map<string, ImportedTire[]>()
  const seen = new Set<string>()
  body.forEach((cells, i) => {
    const row = i + 2 // as the spreadsheet numbers it, after the header
    const result = readTire(cells, columns, row)
    if ('error' in result) {
      report.skipped.push({ row, reason: result.error })
      return
    }
    const t = result.tire
    for (const note of result.notes) report.notes.push({ row, note })
    const lineKey = `${t.brand.toLowerCase()}|${t.model.toLowerCase()}`
    const sizeId = `${lineKey}|${sizeKey(t.size)}`
    if (seen.has(sizeId)) {
      report.skipped.push({ row, reason: `${t.brand} ${t.model} ${t.size} is already in the file` })
      return
    }
    seen.add(sizeId)
    lines.set(lineKey, [...(lines.get(lineKey) ?? []), t])
  })

  for (const tires of lines.values()) {
    const first = tires[0]
    const line = {
      tireType: mostCommon(tires.map((t) => t.tireType)),
      season: mostCommon(tires.map((t) => t.season)),
      severeSnow: tires.some((t) => t.severeSnow),
      roadHazard: mostCommon(tires.map((t) => t.roadHazard)),
      warrantyMiles: mostCommon(tires.map((t) => t.warrantyMiles)),
    }

    const found = await client.query(
      'SELECT id::text AS id, brand, model FROM tire_lines WHERE LOWER(brand) = LOWER($1) AND LOWER(model) = LOWER($2) FOR UPDATE',
      [first.brand, first.model],
    )
    let lineId: string
    let brand: string
    let model: string
    if (found.rowCount === 0) {
      const created = await client.query(
        `
          INSERT INTO tire_lines (brand, model, tire_type, season, severe_snow, road_hazard, warranty_miles)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id::text AS id
        `,
        [first.brand, first.model, line.tireType, line.season, line.severeSnow, line.roadHazard ?? false, line.warrantyMiles],
      )
      lineId = created.rows[0].id
      brand = first.brand
      model = first.model
      report.linesNew.push(`${brand} ${model} (${tires.length} sizes)`)
    } else {
      // The app's spelling of the name wins; type and season only fill blanks.
      ;({ id: lineId, brand, model } = found.rows[0])
      await client.query(
        `
          UPDATE tire_lines SET
            tire_type = COALESCE(tire_type, $2),
            season = COALESCE(season, $3),
            severe_snow = severe_snow OR $4,
            road_hazard = COALESCE($5, road_hazard),
            warranty_miles = COALESCE($6, warranty_miles),
            updated_at = NOW()
          WHERE id = $1
        `,
        [lineId, line.tireType, line.season, line.severeSnow, line.roadHazard, line.warrantyMiles],
      )
      report.linesUpdated++
    }

    const existing = await client.query(
      `SELECT id::text AS id, tire_size AS "tireSize" FROM products
       WHERE tire_line_id = $1 AND product_type = 'tire' AND condition = 'new' FOR UPDATE`,
      [lineId],
    )
    const bySize = new Map(existing.rows.map((r) => [sizeKey(r.tireSize), r.id as string]))

    for (const t of tires) {
      const productId = bySize.get(sizeKey(t.size))
      if (productId) {
        // Blank cells in the file never erase what's there.
        const updated = await client.query(
          `
            UPDATE products SET
              ${sizeColumnTypes.map(([c, type], i) => `${c} = COALESCE($${i + 2}::${type}, ${c})`).join(', ')},
              updated_at = NOW()
            WHERE id = $1
              AND (${sizeColumnTypes.map(([c, type], i) => `($${i + 2}::${type} IS NOT NULL AND ${c} IS DISTINCT FROM $${i + 2}::${type})`).join(' OR ')})
          `,
          [productId, ...sizeValues(t)],
        )
        if (updated.rowCount) report.sizesUpdated++
        else report.sizesUnchanged++
        continue
      }

      let sku = skuFor(brand, model, t.size)
      for (let n = 2; ; n++) {
        const taken = await client.query('SELECT 1 FROM products WHERE LOWER(sku) = LOWER($1)', [sku])
        if (taken.rowCount === 0) break
        sku = `${skuFor(brand, model, t.size)}-${n}`
      }
      const inserted = await client.query(
        `
          INSERT INTO products (sku, brand, model, tire_size, product_type, condition, stocked, min_qty, tire_line_id,
                                ${sizeColumns.join(', ')})
          VALUES ($1, $2, $3, $4, 'tire', 'new', FALSE, 0, $5, ${sizeColumns.map((_, i) => `$${i + 6}`).join(', ')})
          RETURNING id::text AS id
        `,
        [sku, brand, model, t.size, lineId, ...sizeValues(t)],
      )
      await client.query('INSERT INTO inventory_stock (product_id, on_hand_qty) VALUES ($1, 0)', [inserted.rows[0].id])
      report.sizesNew++
    }
  }
  return report
}
