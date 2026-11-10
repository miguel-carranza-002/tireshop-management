// Way back in when nobody can sign in as an admin: run on the server computer.
//   npm run admin-password -- <username>
// Asks for a new password, makes that login an active admin and signs it out
// everywhere. Use DB_NAME=tireshop for the real database.
import { createInterface } from 'node:readline/promises'
import { hashPassword, passwordProblem } from '../auth.js'
import { pool } from '../db.js'

const username = process.argv[2]?.trim().toLowerCase()
if (!username) {
  console.error('Usage: npm run admin-password -- <username>')
  process.exit(1)
}

const rl = createInterface({ input: process.stdin, output: process.stdout })
const password = await rl.question(`New password for ${username}: `)
rl.close()

const problem = passwordProblem(password)
if (problem) {
  console.error(problem)
  await pool.end()
  process.exit(1)
}

const updated = await pool.query(
  `UPDATE users SET password_hash = $2, role = 'admin', active = TRUE WHERE LOWER(username) = $1 RETURNING id`,
  [username, await hashPassword(password)],
)
if (updated.rowCount === 0) {
  const users = await pool.query('SELECT username FROM users ORDER BY username')
  console.error(`No login "${username}". Logins: ${users.rows.map((r) => r.username).join(', ') || 'none'}`)
  process.exitCode = 1
} else {
  await pool.query('DELETE FROM sessions WHERE user_id = $1', [updated.rows[0].id])
  console.log(`${process.env.DB_NAME}: ${username} is an admin with the new password.`)
}
await pool.end()
