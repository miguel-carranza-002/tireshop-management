// Shared test setup: runs the real Express app against tireshop_test.
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { after, before, beforeEach } from 'node:test'

if (!(process.env.DB_NAME ?? '').endsWith('_test')) {
  throw new Error('Tests only run against a *_test database (npm test sets DB_NAME=tireshop_test)')
}

const { default: app } = await import('../src/app.js')
const { pool } = await import('../src/db.js')
const { checkInvariants } = await import('../src/invariants.js')
const { hashPassword } = await import('../src/auth.js')

// Test logins: every request is made as the admin unless a test signs in as
// someone else (see signIn / asCookie).
export const ADMIN = { username: 'test-admin', password: 'admin-password-1' }
export const ADVISOR = { username: 'test-advisor', password: 'advisor-password-1' }
let cookie = ''

async function ensureUser(u: { username: string; password: string }, role: 'admin' | 'advisor') {
  await pool.query(
    `
      INSERT INTO users (username, display_name, password_hash, role) VALUES ($1, $2, $3, $4)
      ON CONFLICT ((LOWER(username))) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, active = TRUE
    `,
    [u.username, u.username === ADMIN.username ? 'Test Admin' : 'Test Advisor', await hashPassword(u.password), role],
  )
}

// Sign in and return the session cookie.
export async function signIn(u: { username: string; password: string }) {
  const response = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(u),
  })
  const setCookie = response.headers.get('set-cookie') ?? ''
  return { status: response.status, cookie: setCookie.split(';')[0] }
}

// Make the following calls as this cookie ('' = signed out).
export function useCookie(next: string) {
  cookie = next
}

export { pool }

let server: Server
let base = ''

// Start the app once per test file, and empty every data table before each test.
export function useTestApp() {
  before(async () => {
    server = app.listen(0, '127.0.0.1')
    await new Promise((resolve) => server.once('listening', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`
    await ensureUser(ADMIN, 'admin')
    await ensureUser(ADVISOR, 'advisor')
  })
  beforeEach(async () => {
    await resetData()
    cookie = (await signIn(ADMIN)).cookie
  })
  after(async () => {
    await new Promise((resolve) => server.close(resolve))
    await pool.end()
  })
}

// Full URL of a tire line's photo (for checks that need the raw response).
export function sessionCookie() {
  return cookie
}

export function photoUrl(lineId: string) {
  return `${base}/tire-lines/${lineId}/photo`
}

export async function resetData() {
  await pool.query(`
    TRUNCATE call_logs, payments, queue_entries, reservations, pending_orders,
             inventory_movements, line_items, work_items, tickets, vehicles, customers,
             inventory_stock, products, tire_line_photos, tire_lines
      RESTART IDENTITY CASCADE;
    UPDATE invoice_counter SET last_number = 5000;
    ALTER SEQUENCE quote_number_seq RESTART WITH 1001;
  `)
}

type Res<T> = { status: number; body: T & { error?: string } }

async function call<T = any>(method: string, path: string, body?: unknown): Promise<Res<T>> {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : {} }
}

export const api = {
  get: <T = any>(path: string) => call<T>('GET', path),
  post: <T = any>(path: string, body: unknown = {}) => call<T>('POST', path, body),
  put: <T = any>(path: string, body: unknown) => call<T>('PUT', path, body),
  del: <T = any>(path: string) => call<T>('DELETE', path),
}

// Fail with the API's own message when a call that should work doesn't.
export async function ok<T>(promise: Promise<Res<T>>): Promise<T> {
  const res = await promise
  assert.ok(res.status < 400, `expected success, got ${res.status}: ${res.body.error}`)
  return res.body
}

// Expect a refusal with this status, and return the message.
export async function refused(promise: Promise<Res<unknown>>, status: number): Promise<string> {
  const res = await promise
  assert.equal(res.status, status, `expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`)
  return res.body.error ?? ''
}

export async function assertInvariants() {
  assert.deepEqual(await checkInvariants(pool), [], 'database invariants broken')
}

export async function stock(productId: string) {
  const r = await pool.query(
    'SELECT on_hand_qty AS "onHand", reserved_qty AS reserved FROM inventory_stock WHERE product_id = $1',
    [productId],
  )
  return r.rows[0] as { onHand: number; reserved: number }
}

// --- Building blocks -------------------------------------------------------

export async function product(fields: Record<string, unknown> = {}) {
  const body = await ok(
    api.post('/products', {
      brand: 'Test',
      model: `Tire ${Math.random().toString(36).slice(2, 7)}`,
      tireSize: '225/65R17',
      cost: 100,
      price: 150,
      initialQty: 8,
      ...fields,
    }),
  )
  return body.product.id as string
}

export async function customerWithVehicle(customer: Record<string, unknown> = {}, vehicle: Record<string, unknown> = {}) {
  const c = await ok(api.post('/customers', { firstName: 'Test', phone: '5550001111', ...customer }))
  const v = await ok(
    api.post(`/customers/${c.id}/vehicles`, { year: 2020, make: 'Honda', model: 'Accord', ...vehicle }),
  )
  return { customerId: c.id as string, vehicleId: v.vehicle.id as string }
}

export async function quote(customer?: Record<string, unknown>, vehicle?: Record<string, unknown>) {
  const { customerId, vehicleId } = await customerWithVehicle(customer, vehicle)
  const body = await ok(api.post('/tickets', { customerId, vehicleId }))
  return body.ticket.id as string
}

export async function addItem(ticketId: string, item: Record<string, unknown>) {
  const body = await ok(api.post(`/tickets/${ticketId}/work-items`, item))
  // The newest work item is the one with the highest id.
  const items = body.ticket.workItems as { id: string }[]
  return items.reduce((a, b) => (Number(b.id) > Number(a.id) ? b : a)).id
}

export async function ticket(id: string) {
  return (await ok(api.get(`/tickets/${id}`))).ticket
}
