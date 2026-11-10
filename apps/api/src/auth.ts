// Sign-in: password hashing, sessions in a cookie, and the middleware that
// requires a signed-in user for the API.
import type { NextFunction, Request, Response } from 'express'
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { requestContext, type CurrentUser } from './context.js'
import { pool } from './db.js'

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>

export const SESSION_COOKIE = 'ts_session'
// A working day; extended while the advisor keeps using the app.
const SESSION_HOURS = 12

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

export async function hashPassword(password: string) {
  const salt = randomBytes(16)
  const hash = await scryptAsync(password, salt, 64)
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64')
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length)
  return timingSafeEqual(actual, expected)
}

// Checked against when the username doesn't exist (or is turned off), so a
// wrong name takes as long as a wrong password and doesn't reveal which
// usernames are real.
const decoyHash = hashPassword(randomBytes(16).toString('hex'))

export async function checkLogin(password: string, user: { passwordHash: string; active: boolean } | undefined) {
  const matches = await verifyPassword(password, user?.passwordHash ?? (await decoyHash))
  return !!user && user.active && matches
}

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < 8) return 'Passwords need at least 8 characters'
  if (password.length > 200) return 'That password is too long'
  return null
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

const tokenId = (token: string) => createHash('sha256').update(token).digest('hex')

export async function startSession(res: Response, userId: string) {
  const token = randomBytes(32).toString('base64url')
  await pool.query('DELETE FROM sessions WHERE expires_at < NOW()')
  await pool.query(
    `INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, NOW() + make_interval(hours => $3))`,
    [tokenId(token), userId, SESSION_HOURS],
  )
  await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [userId])
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    // Lax: sent when you open the app or a PDF link, never with another
    // site's form posts.
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: SESSION_HOURS * 3600 * 1000,
    path: '/',
  })
}

export async function endSession(req: Request, res: Response) {
  const token = readCookie(req, SESSION_COOKIE)
  if (token) await pool.query('DELETE FROM sessions WHERE id = $1', [tokenId(token)])
  res.clearCookie(SESSION_COOKIE, { path: '/' })
}

// Every other session of this user (after a password change), keeping
// the one making the request.
export async function endOtherSessions(req: Request, userId: string) {
  const token = readCookie(req, SESSION_COOKIE)
  await pool.query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [userId, token ? tokenId(token) : ''])
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie
  if (!header) return null
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

const userColumns = `u.id::text AS id, u.username, u.display_name AS "displayName", u.role`

// The signed-in user for this request, or null. Slides the expiry forward.
export async function userFromRequest(req: Request): Promise<CurrentUser | null> {
  const token = readCookie(req, SESSION_COOKIE)
  if (!token) return null
  const result = await pool.query(
    `
      UPDATE sessions s
      SET last_seen_at = NOW(), expires_at = NOW() + make_interval(hours => $2)
      FROM users u
      WHERE s.id = $1 AND u.id = s.user_id AND s.expires_at > NOW() AND u.active
      RETURNING ${userColumns}
    `,
    [tokenId(token), SESSION_HOURS],
  )
  return result.rows[0] ?? null
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// Every API route needs a signed-in user, except signing in itself and the
// health checks. The user is available to all code via currentUser().
export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const open = req.path === '/health' || req.path === '/health/db' || req.path.startsWith('/auth/')
  const user = await userFromRequest(req)
  if (!user && !open) {
    res.status(401).json({ error: 'Please sign in' })
    return
  }
  requestContext.run({ user }, next)
}

export function requireAdmin(_req: Request, res: Response, next: NextFunction) {
  const user = requestContext.getStore()?.user
  if (user?.role !== 'admin') {
    res.status(403).json({ error: 'Only an admin can do that' })
    return
  }
  next()
}

// ---------------------------------------------------------------------------
// Too many wrong passwords: slow down guessing (in memory). Counted per
// username *and* computer, so someone else can't lock the admin out.
// ---------------------------------------------------------------------------

const failures = new Map<string, { count: number; until: number }>()
const MAX_FAILURES = 8
const LOCK_MINUTES = 10

const failureKey = (username: string, from: string | undefined) => `${username.toLowerCase()}|${from ?? ''}`

export function lockedOut(username: string, from: string | undefined) {
  const f = failures.get(failureKey(username, from))
  return !!f && f.count >= MAX_FAILURES && f.until > Date.now()
}

export function recordFailure(username: string, from: string | undefined) {
  const key = failureKey(username, from)
  const f = failures.get(key)
  const count = f && f.until > Date.now() ? f.count + 1 : 1
  failures.set(key, { count, until: Date.now() + LOCK_MINUTES * 60_000 })
}

export function clearFailures(username: string, from: string | undefined) {
  failures.delete(failureKey(username, from))
}
