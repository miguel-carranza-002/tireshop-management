// Load a supplier's tire catalog file into the catalog.
//   npm run import-tires -- data/imports/tire-catalog.csv          (dry run: shows what would change)
//   npm run import-tires -- data/imports/tire-catalog.csv --apply  (writes it)
// Add DB_NAME=tireshop in front for the real database. Paths are relative to
// the project folder. See catalogImport.ts for what is and isn't changed.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { importCatalog } from '../catalogImport.js'
import { pool } from '../db.js'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const file = args.find((a) => !a.startsWith('--'))
if (!file) {
  console.error('Usage: npm run import-tires -- <file.csv> [--apply]')
  process.exit(1)
}
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const fullPath = path.isAbsolute(file) ? file : path.resolve(projectRoot, file)

const client = await pool.connect()
try {
  await client.query('BEGIN')
  const r = await importCatalog(client, readFileSync(fullPath, 'utf8'))
  await client.query(apply ? 'COMMIT' : 'ROLLBACK')

  console.log(`${process.env.DB_NAME}: ${path.relative(projectRoot, fullPath)}, ${r.rows} rows`)
  if (r.ignoredColumns.length) console.log(`Columns not used: ${r.ignoredColumns.join(', ')}`)
  console.log(`Tire lines: ${r.linesNew.length} new, ${r.linesUpdated} already in the catalog`)
  for (const l of r.linesNew) console.log(`  + ${l}`)
  console.log(`Sizes: ${r.sizesNew} new, ${r.sizesUpdated} updated, ${r.sizesUnchanged} unchanged`)
  if (r.skipped.length) {
    console.log(`Skipped ${r.skipped.length} rows:`)
    for (const s of r.skipped.slice(0, 25)) console.log(`  row ${s.row}: ${s.reason}`)
    if (r.skipped.length > 25) console.log(`  …and ${r.skipped.length - 25} more`)
  }
  if (r.notes.length) {
    console.log(`Imported, but ${r.notes.length} cells were left blank:`)
    for (const n of r.notes.slice(0, 25)) console.log(`  row ${n.row}: ${n.note}`)
    if (r.notes.length > 25) console.log(`  …and ${r.notes.length - 25} more`)
  }
  console.log(apply ? 'Saved.' : 'Dry run: nothing was saved. Add --apply to save it.')
} catch (error) {
  await client.query('ROLLBACK').catch(() => {})
  console.error(`Nothing was imported: ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
