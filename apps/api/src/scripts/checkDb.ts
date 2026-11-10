// Check a database against the invariants: npm run check-db
// (DB_NAME=tireshop npm run check-db for the real one).
import { pool } from '../db.js'
import { checkInvariants, invariantNames } from '../invariants.js'

const violations = await checkInvariants(pool)
await pool.end()
for (const name of invariantNames) {
  const v = violations.find((x) => x.check === name)
  console.log(`${v ? 'FAIL' : 'ok  '}  ${name}`)
  if (v) for (const row of v.rows.slice(0, 10)) console.log('        ', JSON.stringify(row))
}
console.log(`${process.env.DB_NAME}: ${violations.length === 0 ? 'all checks pass' : `${violations.length} check(s) failed`}`)
if (violations.length > 0) process.exitCode = 1
