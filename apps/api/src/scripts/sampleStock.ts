// Sample shelf stock for trying the comparison and the tire search: Celimo and
// Milestar sizes from the catalog, with made-up costs and quantities.
//   npm run sample-stock            (dev database)
// Refuses the real database. Safe to run again: each tire is set to the
// quantity below (only ever adds stock), and its cost and price are reset.
// Import the tire catalog first (npm run import-tires).
import { sizeKey } from '../comparison.js'
import { pool } from '../db.js'
import { tirePriceFromCost } from '../pricing.js'
import { loadSettings } from '../routes/settings.js'

const database = process.env.DB_NAME ?? ''
if (!/_(dev|test)$/.test(database)) {
  console.error(`Refusing to put sample stock in "${database}": only a *_dev or *_test database.`)
  process.exit(1)
}

// [brand, model, size, quantity on the shelf, our cost]
const SAMPLE: [string, string, string, number, number][] = [
  // 215/55R16: three on the shelf, one short; 205/55R16 is the in-stock similar size.
  ['Celimo', 'Salient CS210', '215/55R16', 4, 62],
  ['Milestar', 'MS932 Sport', '215/55R16', 4, 58],
  ['Milestar', 'WeatherGuard AS710 Sport', '215/55R16', 2, 70],
  ['Milestar', 'WEATHERGUARD AW365', '205/55R16', 4, 66],
  ['Milestar', 'MS932 Sport', '205/55R16', 4, 55],
  // 225/65R17: four lines, so cheap / medium / premium all fill.
  ['Celimo', 'Salient CS210', '225/65R17', 4, 75],
  ['Milestar', 'MS932 Sport', '225/65R17', 4, 70],
  ['Milestar', 'WEATHERGUARD AW365', '225/65R17', 4, 82],
  ['Milestar', 'WeatherGuard AS710 Sport', '225/65R17', 6, 78],
  ['Celimo', 'Salient CS210', '235/65R17', 4, 80],
  ['Milestar', 'WeatherGuard AS710 Sport', '235/65R17', 2, 85],
  ['Celimo', 'Salient CS210', '225/50R17', 4, 72],
  ['Milestar', 'INTERCEPTOR AS810', '225/50R17', 4, 76],
  ['Milestar', 'WEATHERGUARD AW365', '225/50R17', 2, 80],
  ['Celimo', 'Salient CS210', '235/55R18', 4, 88],
  ['Milestar', 'WeatherGuard AS710 Sport', '235/55R18', 4, 95],
  // Trucks and SUVs.
  ['Celimo', 'Prevail H/T', '265/70R17', 4, 105],
  ['Celimo', 'Prevail A/T', '265/70R17', 4, 118],
  ['Milestar', 'Patagonia A/T PRO', '265/70R17', 4, 135],
  ['Milestar', 'Patagonia X/T', '265/70R17', 2, 150],
  ['Celimo', 'Prevail A/T', '275/55R20', 4, 140],
  ['Milestar', 'Patagonia A/T PRO', '275/55R20', 4, 165],
  ['Celimo', 'Prevail H/T', '245/75R16', 4, 100],
  ['Milestar', 'Patagonia A/T PRO', '245/75R16', 2, 125],
  ['Celimo', 'Prevail A/T', '265/75R16', 4, 115],
]

const client = await pool.connect()
try {
  await client.query('BEGIN')
  const settings = await loadSettings(client)
  const missing: string[] = []
  let stocked = 0
  for (const [brand, model, size, quantity, cost] of SAMPLE) {
    const found = await client.query(
      `
        SELECT p.id::text AS id, p.tire_size AS "tireSize", COALESCE(s.on_hand_qty, 0) AS "onHand"
        FROM products p JOIN tire_lines l ON l.id = p.tire_line_id
        LEFT JOIN inventory_stock s ON s.product_id = p.id
        WHERE LOWER(l.brand) = LOWER($1) AND LOWER(l.model) = LOWER($2) AND p.condition = 'new'
        ORDER BY p.id
      `,
      [brand, model],
    )
    const product = found.rows.find((r: { tireSize: string }) => sizeKey(r.tireSize) === sizeKey(size))
    if (!product) {
      missing.push(`${brand} ${model} ${size}`)
      continue
    }
    await client.query(
      `UPDATE products SET stocked = TRUE, min_qty = 4, cost = $2, price = $3, cost_updated_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [product.id, cost, tirePriceFromCost(settings, cost)],
    )
    await client.query(
      `INSERT INTO inventory_stock (product_id, on_hand_qty) VALUES ($1, 0) ON CONFLICT (product_id) DO NOTHING`,
      [product.id],
    )
    const add = quantity - product.onHand
    if (add > 0) {
      await client.query(
        `UPDATE inventory_stock SET on_hand_qty = on_hand_qty + $2, updated_at = NOW() WHERE product_id = $1`,
        [product.id, add],
      )
      await client.query(
        `INSERT INTO inventory_movements (product_id, movement_type, quantity_delta, note) VALUES ($1, 'adjustment', $2, 'Sample stock')`,
        [product.id, add],
      )
    }
    stocked++
  }
  await client.query('COMMIT')
  console.log(`${database}: ${stocked} sample tires on the shelf`)
  if (missing.length) console.log(`Not in the catalog (import it first): ${missing.join(', ')}`)
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  client.release()
  await pool.end()
}
