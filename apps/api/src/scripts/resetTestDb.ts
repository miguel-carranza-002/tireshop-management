// Wipe the test database and rebuild it from the migrations: npm test does
// this first. Refuses to touch any database whose name doesn't end in _test.
import { execFileSync } from 'node:child_process'
import { pool } from '../db.js'
import { applyExamplePrices } from './examplePrices.js'

const db = process.env.DB_NAME ?? ''
if (!db.endsWith('_test')) {
  console.error(`Refusing to reset "${db}": only databases named *_test can be wiped.`)
  process.exit(1)
}
await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
execFileSync(process.execPath, ['--import', 'tsx', 'src/scripts/migrate.ts'], { stdio: 'inherit' })
// Prices start at 0 in a new database; tests calculate with the example ones.
await applyExamplePrices(pool)
await pool.end()
