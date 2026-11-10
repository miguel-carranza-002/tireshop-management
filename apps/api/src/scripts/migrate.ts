// Apply db/migrations/*.sql in order and record each one in schema_migrations.
//
//   npm run migrate              apply everything not applied yet
//   npm run migrate -- --status  list applied / pending
//   npm run migrate -- --baseline
//       for a database whose migrations were applied by hand: record every
//       migration file as applied without running it (only on an empty log)
//   npm run migrate -- --accept-changed
//       record the current text of applied migrations that were edited on
//       purpose (comments, defaults for new databases). Nothing is re-run.
//
// The database comes from DB_NAME (apps/api/.env, or DB_NAME=... in front).
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from '../db.js'

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../db/migrations',
)

type Migration = { filename: string; sql: string; checksum: string }

async function loadMigrations(): Promise<Migration[]> {
  const files = (await readdir(migrationsDir)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort()
  return Promise.all(
    files.map(async (filename) => {
      const sql = await readFile(path.join(migrationsDir, filename), 'utf8')
      return { filename, sql, checksum: createHash('sha256').update(sql).digest('hex') }
    }),
  )
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const db = process.env.DB_NAME
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  const applied = new Map<string, string>(
    (await pool.query('SELECT filename, checksum FROM schema_migrations')).rows.map((r) => [
      r.filename,
      r.checksum,
    ]),
  )
  const migrations = await loadMigrations()

  for (const m of migrations) {
    const old = applied.get(m.filename)
    if (old && old !== m.checksum) {
      console.warn(`! ${m.filename} changed after it was applied. Add a new migration instead of editing it.`)
    }
  }

  if (args.has('--accept-changed')) {
    let count = 0
    for (const m of migrations) {
      const old = applied.get(m.filename)
      if (!old || old === m.checksum) continue
      await pool.query('UPDATE schema_migrations SET checksum = $2 WHERE filename = $1', [m.filename, m.checksum])
      console.log(`${db}: accepted the edited ${m.filename} (not re-run)`)
      count++
    }
    if (count === 0) console.log(`${db}: no edited migrations`)
    return
  }

  if (args.has('--status')) {
    for (const m of migrations) console.log(`${applied.has(m.filename) ? 'applied' : 'PENDING'}  ${m.filename}`)
    return
  }

  if (args.has('--baseline')) {
    if (applied.size > 0) throw new Error('schema_migrations already has entries; nothing to baseline')
    for (const m of migrations) {
      await pool.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [
        m.filename,
        m.checksum,
      ])
    }
    console.log(`${db}: recorded ${migrations.length} migrations as already applied`)
    return
  }

  const pending = migrations.filter((m) => !applied.has(m.filename))
  if (pending.length === 0) {
    console.log(`${db}: up to date (${migrations.length} migrations)`)
    return
  }
  for (const m of pending) {
    // Each file has its own BEGIN/COMMIT. A failure stops here, unrecorded.
    const client = await pool.connect()
    try {
      await client.query(m.sql)
      await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [
        m.filename,
        m.checksum,
      ])
      console.log(`${db}: applied ${m.filename}`)
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw new Error(`${m.filename} failed: ${error instanceof Error ? error.message : error}`)
    } finally {
      client.release()
    }
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => pool.end())
