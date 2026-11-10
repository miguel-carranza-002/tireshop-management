// Managing the advisors' logins. Admin only (see app.ts).
import { Router } from 'express'
import { hashPassword, passwordProblem } from '../auth.js'
import { currentUser } from '../context.js'
import { pool } from '../db.js'
import { asBody, ConflictError, idParam, NotFoundError, optionalBoolean, requiredText, ValidationError } from '../validation.js'

export const usersRouter = Router()

const columns = `
  id::text AS id, username, display_name AS "displayName", role, active,
  created_at AS "createdAt", last_login_at AS "lastLoginAt"
`

const readRole = (raw: unknown) => {
  if (raw !== 'admin' && raw !== 'advisor') throw new ValidationError('Role must be admin or advisor')
  return raw
}

usersRouter.get('/', async (_req, res) => {
  const result = await pool.query(`SELECT ${columns} FROM users ORDER BY active DESC, display_name`)
  res.json({ users: result.rows })
})

usersRouter.post('/', async (req, res) => {
  const body = asBody(req.body)
  const displayName = requiredText(body, 'displayName', 'Name')
  const username = requiredText(body, 'username', 'Username').toLowerCase()
  if (!/^[a-z0-9._-]{2,40}$/.test(username)) {
    throw new ValidationError('Usernames use letters, numbers, dots, dashes or underscores')
  }
  const role = readRole(body.role ?? 'advisor')
  const problem = passwordProblem(body.password)
  if (problem) throw new ValidationError(problem)
  try {
    const created = await pool.query(
      `INSERT INTO users (username, display_name, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING ${columns}`,
      [username, displayName, await hashPassword(body.password as string), role],
    )
    res.status(201).json({ user: created.rows[0] })
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new ConflictError('That username is taken')
    throw error
  }
})

// Rename, change role, or turn a login off. Turning off ends their sessions.
usersRouter.put('/:id', async (req, res) => {
  const id = idParam(req.params.id)
  const body = asBody(req.body)
  const displayName = requiredText(body, 'displayName', 'Name')
  const role = readRole(body.role)
  const active = optionalBoolean(body, 'active', true)
  if (id === currentUser()!.id && (role !== 'admin' || !active)) {
    throw new ConflictError('You can’t remove your own admin access. Ask another admin.')
  }
  const updated = await pool.query(
    `UPDATE users SET display_name = $2, role = $3, active = $4 WHERE id = $1 RETURNING ${columns}`,
    [id, displayName, role, active],
  )
  if (updated.rowCount === 0) throw new NotFoundError('User not found')
  if (!active) await pool.query('DELETE FROM sessions WHERE user_id = $1', [id])
  res.json({ user: updated.rows[0] })
})

// Set a new password for someone who forgot theirs. Signs them out everywhere.
usersRouter.post('/:id/password', async (req, res) => {
  const id = idParam(req.params.id)
  const body = asBody(req.body)
  const problem = passwordProblem(body.password)
  if (problem) throw new ValidationError(problem)
  const updated = await pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [
    id,
    await hashPassword(body.password as string),
  ])
  if (updated.rowCount === 0) throw new NotFoundError('User not found')
  if (id !== currentUser()!.id) await pool.query('DELETE FROM sessions WHERE user_id = $1', [id])
  res.json({ ok: true })
})
