import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { clearFailures, lockedOut, recordFailure } from '../src/auth.js'
import { ADMIN, ADVISOR, addItem, api, ok, pool, quote, refused, signIn, ticket, useCookie, useTestApp } from './helpers.js'

useTestApp()

describe('signing in', () => {
  test('the API needs a signed-in user; health checks and sign-in do not', async () => {
    useCookie('')
    assert.match(await refused(api.get('/tickets'), 401), /sign in/)
    assert.equal((await api.get('/health')).status, 200)
    const me = await ok(api.get('/auth/me'))
    assert.equal(me.user, null)
    assert.equal(me.needsSetup, false, 'users exist, so no first-run setup')
  })

  test('every area of the API is locked when signed out', async () => {
    // Read the mounts from app.ts, so an area added later is checked too.
    const source = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8')
    const areas = [...new Set([...source.matchAll(/app\.use\('\/api\/([a-z-]+)'/g)].map((m) => m[1]))]
    assert.ok(areas.includes('products') && areas.includes('tickets') && areas.length >= 15, `found ${areas.join(', ')}`)
    const productsBefore = (await pool.query('SELECT count(*)::int AS n FROM products')).rows[0].n
    useCookie('')
    for (const area of areas.filter((a) => a !== 'auth')) {
      for (const path of [`/${area}`, `/${area}/1`]) {
        assert.equal((await api.get(path)).status, 401, `GET ${path} signed out`)
        assert.equal((await api.post(path, {})).status, 401, `POST ${path} signed out`)
      }
    }
    assert.equal((await api.post('/products', { brand: 'Zz', model: 'Open door', tireSize: '225/65R17', price: 1, initialQty: 4 })).status, 401)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM products')).rows[0].n, productsBefore, 'nothing was written')
  })

  test('wrong password is refused; the right one signs in; sign-out ends the session', async () => {
    assert.equal((await signIn({ username: ADMIN.username, password: 'nope-nope-nope' })).status, 401)
    const { status, cookie } = await signIn({ username: ADMIN.username.toUpperCase(), password: ADMIN.password })
    assert.equal(status, 200, 'usernames are not case-sensitive')
    useCookie(cookie)
    assert.equal((await ok(api.get('/auth/me'))).user.role, 'admin')
    await ok(api.post('/auth/logout'))
    assert.equal((await api.get('/tickets')).status, 401)
  })

  test('first-run setup only works while there are no users', async () => {
    assert.match(await refused(api.post('/auth/setup', { displayName: 'X', username: 'x', password: 'longenough1' }), 409), /already/)
  })
})

describe('admin and advisor', () => {
  test('advisors work tickets but cannot manage users or change settings', async () => {
    useCookie((await signIn(ADVISOR)).cookie)
    await ok(api.get('/settings'))
    assert.equal((await api.put('/settings', { disposalFee: 6 })).status, 403)
    assert.equal((await api.get('/users')).status, 403)
    const t = await quote()
    await addItem(t, { itemType: 'alignment' })
  })

  test('admins add users, reset passwords, and turn logins off', async () => {
    const created = (await ok(api.post('/users', { displayName: 'Sam', username: 'Sam', password: 'sam-password-1' }))).user
    assert.equal(created.username, 'sam')
    assert.equal(created.role, 'advisor')
    assert.match(await refused(api.post('/users', { displayName: 'Sam 2', username: 'sam', password: 'sam-password-2' }), 409), /taken/)
    assert.match(await refused(api.post('/users', { displayName: 'Short', username: 'short', password: 'abc' }), 400), /8 characters/)

    const sam = await signIn({ username: 'sam', password: 'sam-password-1' })
    assert.equal(sam.status, 200)
    await ok(api.put(`/users/${created.id}`, { displayName: 'Sam', role: 'advisor', active: false }))
    useCookie(sam.cookie)
    assert.equal((await api.get('/tickets')).status, 401, 'turning a login off ends its sessions')
    assert.equal((await signIn({ username: 'sam', password: 'sam-password-1' })).status, 401)
    await pool.query("DELETE FROM users WHERE username = 'sam'")
  })

  test('changing your password signs you out everywhere else', async () => {
    await ok(api.post('/users', { displayName: 'Pat', username: 'pat', password: 'pat-password-1' }))
    try {
      const counter = await signIn({ username: 'pat', password: 'pat-password-1' })
      const office = await signIn({ username: 'pat', password: 'pat-password-1' })
      useCookie(counter.cookie)
      await ok(api.post('/auth/password', { currentPassword: 'pat-password-1', newPassword: 'pat-password-2' }))
      assert.equal((await api.get('/tickets')).status, 200, 'this session keeps working')
      useCookie(office.cookie)
      assert.equal((await api.get('/tickets')).status, 401, 'the other one is signed out')
    } finally {
      await pool.query("DELETE FROM users WHERE username = 'pat'")
    }
  })

  test('expired sessions are cleared when someone signs in', async () => {
    const admin = await pool.query("SELECT id FROM users WHERE username = $1", [ADMIN.username])
    await pool.query(
      `INSERT INTO sessions (id, user_id, expires_at) VALUES ('zz-expired', $1, NOW() - INTERVAL '1 day')`,
      [admin.rows[0].id],
    )
    assert.equal((await signIn(ADMIN)).status, 200)
    assert.equal((await pool.query(`SELECT 1 FROM sessions WHERE id = 'zz-expired'`)).rowCount, 0)
  })

  test('wrong passwords lock that username only from that computer', () => {
    for (let i = 0; i < 8; i++) recordFailure('Boss', '10.0.0.9')
    assert.equal(lockedOut('boss', '10.0.0.9'), true, 'the computer guessing is locked out')
    assert.equal(lockedOut('boss', '10.0.0.5'), false, 'the real admin at another computer is not')
    clearFailures('boss', '10.0.0.9')
    assert.equal(lockedOut('boss', '10.0.0.9'), false)
  })

  test('an unknown username is refused the same way as a wrong password', async () => {
    const wrongPassword = await signIn({ username: ADMIN.username, password: 'nope-nope-nope' })
    const unknownName = await signIn({ username: 'nobody-here', password: 'nope-nope-nope' })
    assert.equal(wrongPassword.status, 401)
    assert.equal(unknownName.status, 401)
    // Both run the password check: an unknown name isn't answered noticeably faster.
    const time = async (username: string) => {
      const start = performance.now()
      for (let i = 0; i < 3; i++) await signIn({ username, password: 'nope-nope-nope' })
      return performance.now() - start
    }
    const known = await time(ADMIN.username)
    const unknown = await time('nobody-here')
    assert.ok(unknown > known / 3, `unknown ${unknown.toFixed(0)}ms vs known ${known.toFixed(0)}ms`)
    clearFailures(ADMIN.username, '::1')
    clearFailures(ADMIN.username, '::ffff:127.0.0.1')
    clearFailures(ADMIN.username, '127.0.0.1')
  })

  test('an admin cannot lock themselves out', async () => {
    const me = (await ok(api.get('/auth/me'))).user
    assert.match(await refused(api.put(`/users/${me.id}`, { displayName: 'Me', role: 'advisor', active: true }), 409), /own admin/)
  })
})

describe('who did what', () => {
  test('quotes and payments record the signed-in user', async () => {
    useCookie((await signIn(ADVISOR)).cookie)
    const t = await quote()
    await addItem(t, { itemType: 'alignment' })
    await ok(api.post(`/tickets/${t}/accept`, { checkIn: true, deposit: { amount: 20, method: 'cash' } }))
    const detail = await ticket(t)
    assert.equal(detail.createdByName, 'Test Advisor')
    assert.equal(detail.acceptedByName, 'Test Advisor')
    assert.equal(detail.payments[0].recordedByName, 'Test Advisor')
  })
})
