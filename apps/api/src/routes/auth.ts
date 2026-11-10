import { Router } from 'express'
import {
  checkLogin,
  clearFailures,
  endOtherSessions,
  endSession,
  hashPassword,
  lockedOut,
  passwordProblem,
  recordFailure,
  startSession,
  verifyPassword,
} from '../auth.js'
import { currentUser } from '../context.js'
import { pool } from '../db.js'
import { asBody, ConflictError, requiredText, ValidationError } from '../validation.js'

// Mounted on /api/auth. Open without a session (see requireUser).
export const authRouter = Router()

async function userCount() {
  return (await pool.query('SELECT COUNT(*)::int AS n FROM users')).rows[0].n as number
}

// Who's signed in, and whether the first admin still has to be created.
authRouter.get('/me', async (_req, res) => {
  res.json({ user: currentUser(), needsSetup: (await userCount()) === 0 })
})

// First run only: create the admin account and sign in.
authRouter.post('/setup', async (req, res) => {
  const body = asBody(req.body)
  const displayName = requiredText(body, 'displayName', 'Your name')
  const username = requiredText(body, 'username', 'Username').toLowerCase()
  const problem = passwordProblem(body.password)
  if (problem) throw new ValidationError(problem)
  const hash = await hashPassword(body.password as string)
  const created = await pool.query(
    `
      INSERT INTO users (username, display_name, password_hash, role)
      SELECT $1, $2, $3, 'admin' WHERE NOT EXISTS (SELECT 1 FROM users)
      RETURNING id::text AS id
    `,
    [username, displayName, hash],
  )
  if (created.rowCount === 0) throw new ConflictError('Setup is already done. Sign in instead.')
  await startSession(res, created.rows[0].id)
  res.status(201).json({ ok: true })
})

authRouter.post('/login', async (req, res) => {
  const body = asBody(req.body)
  const username = String(body.username ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')
  if (lockedOut(username, req.ip)) {
    res.status(429).json({ error: 'Too many wrong passwords. Wait 10 minutes and try again.' })
    return
  }
  const found = await pool.query(
    `SELECT id::text AS id, password_hash AS "passwordHash", active FROM users WHERE LOWER(username) = $1`,
    [username],
  )
  const user = found.rows[0]
  if (!(await checkLogin(password, user))) {
    recordFailure(username, req.ip)
    res.status(401).json({ error: 'Wrong username or password' })
    return
  }
  clearFailures(username, req.ip)
  await startSession(res, user.id)
  res.json({ ok: true })
})

authRouter.post('/logout', async (req, res) => {
  await endSession(req, res)
  res.json({ ok: true })
})

// Change your own password (needs the current one).
authRouter.post('/password', async (req, res) => {
  const me = currentUser()
  if (!me) {
    res.status(401).json({ error: 'Please sign in' })
    return
  }
  const body = asBody(req.body)
  const problem = passwordProblem(body.newPassword)
  if (problem) throw new ValidationError(problem)
  const row = await pool.query('SELECT password_hash AS "passwordHash" FROM users WHERE id = $1', [me.id])
  if (!(await verifyPassword(String(body.currentPassword ?? ''), row.rows[0].passwordHash))) {
    throw new ValidationError('Your current password is not right')
  }
  await pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [me.id, await hashPassword(body.newPassword as string)])
  // A session someone else may have (a forgotten sign-in, a stolen cookie) ends.
  await endOtherSessions(req, me.id)
  res.json({ ok: true })
})
