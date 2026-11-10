// Demo data for trying the app on a fresh database: example prices, a small
// catalog of made-up tire brands (data/demo/demo-catalog.tsv), shelf stock
// and a few customers with vehicles.
//   DB_NAME=tireshop_demo npm run migrate
//   DB_NAME=tireshop_demo npm run demo-data
// Only runs on a database whose name ends in _demo, _dev or _test. Safe to run
// again: the catalog import updates in place, stock is only topped up, and
// customers already there are skipped.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { importCatalog } from '../catalogImport.js'
import { pool } from '../db.js'
import { tirePriceFromCost } from '../pricing.js'
import { loadSettings } from '../routes/settings.js'
import { applyExamplePrices, examplePrices } from './examplePrices.js'

const database = process.env.DB_NAME ?? ''
if (!/_(demo|dev|test)$/.test(database)) {
  console.error(`Refusing to put demo data in "${database}": only a *_demo, *_dev or *_test database.`)
  process.exit(1)
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const catalog = readFileSync(path.join(projectRoot, 'data/demo/demo-catalog.tsv'), 'utf8')

// [brand, model, cost per tire, quantity on the shelf]. Sizes not listed in
// a model's row stay order-in only, so the comparison shows both.
const STOCK: [string, string, number, number][] = [
  ['Northway', 'Cruiser AS', 68, 4],
  ['Northway', 'Sprint GT', 82, 2],
  ['Ridgecrest', 'Trail HT', 96, 4],
  ['Ridgecrest', 'Trail AT', 142, 4],
  ['Velora', 'Comfort Plus', 54, 4],
  ['Velora', 'Winter Grip', 77, 0],
]

// Made-up people; 555-01xx numbers are reserved for fiction.
const CUSTOMERS = [
  {
    first: 'Alex',
    last: 'Rivera',
    phone: '555-0101',
    vehicle: { year: 2018, make: 'Honda', model: 'Civic', cls: 'car', drive: '2wd', size: '215/55R16' },
  },
  {
    first: 'Sam',
    last: 'Patel',
    phone: '555-0102',
    vehicle: { year: 2016, make: 'Toyota', model: 'RAV4', cls: 'car', drive: 'awd', size: '225/65R17' },
  },
  {
    first: 'Jordan',
    last: 'Lee',
    phone: '555-0103',
    vehicle: { year: 2019, make: 'Ford', model: 'F-150', cls: 'truck', drive: '4wd', size: 'LT265/70R17' },
  },
]

const client = await pool.connect()
try {
  await client.query('BEGIN')

  // Example prices only on a database whose prices are all still 0.
  const columns = Object.keys(examplePrices)
  const zero = await client.query(`SELECT ${columns.map((c) => `${c} = 0`).join(' AND ')} AS "allZero" FROM settings`)
  if (zero.rows[0]?.allZero) {
    await applyExamplePrices(client)
    console.log('Example prices set (edit them on the Settings screen)')
  }

  const report = await importCatalog(client, catalog)
  console.log(`Demo catalog: ${report.rows} sizes, ${report.linesNew.length} new tire lines`)

  const settings = await loadSettings(client)
  let stocked = 0
  for (const [brand, model, cost, quantity] of STOCK) {
    const found = await client.query(
      `
        SELECT p.id::text AS id, COALESCE(s.on_hand_qty, 0) AS "onHand"
        FROM products p JOIN tire_lines l ON l.id = p.tire_line_id
        LEFT JOIN inventory_stock s ON s.product_id = p.id
        WHERE l.brand = $1 AND l.model = $2 AND p.condition = 'new'
        ORDER BY p.id
      `,
      [brand, model],
    )
    for (const p of found.rows as { id: string; onHand: number }[]) {
      await client.query(
        `UPDATE products SET stocked = $4, min_qty = $5, cost = $2, price = $3, cost_updated_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [p.id, cost, tirePriceFromCost(settings, cost), quantity > 0, quantity > 0 ? 4 : 0],
      )
      await client.query(
        'INSERT INTO inventory_stock (product_id, on_hand_qty) VALUES ($1, 0) ON CONFLICT (product_id) DO NOTHING',
        [p.id],
      )
      const add = quantity - p.onHand
      if (add > 0) {
        await client.query(
          'UPDATE inventory_stock SET on_hand_qty = on_hand_qty + $2, updated_at = NOW() WHERE product_id = $1',
          [p.id, add],
        )
        await client.query(
          `INSERT INTO inventory_movements (product_id, movement_type, quantity_delta, note)
           VALUES ($1, 'adjustment', $2, 'Demo stock')`,
          [p.id, add],
        )
        stocked++
      }
    }
  }
  console.log(`Shelf stock topped up for ${stocked} tire sizes`)

  let added = 0
  for (const c of CUSTOMERS) {
    const exists = await client.query('SELECT 1 FROM customers WHERE phone = $1', [c.phone])
    if (exists.rowCount) continue
    const customer = await client.query(
      'INSERT INTO customers (first_name, last_name, phone) VALUES ($1, $2, $3) RETURNING id',
      [c.first, c.last, c.phone],
    )
    const v = c.vehicle
    await client.query(
      `INSERT INTO vehicles (customer_id, year, make, model, vehicle_class, drive_type, tire_size)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [customer.rows[0].id, v.year, v.make, v.model, v.cls, v.drive, v.size],
    )
    added++
  }
  console.log(`Customers: ${added} added`)

  await client.query('COMMIT')
  console.log(`${database}: demo data ready`)
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  client.release()
  await pool.end()
}
