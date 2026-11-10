import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { addItem, api, ok, photoUrl, quote, refused, sessionCookie, useTestApp } from './helpers.js'

useTestApp()

const tire = (fields: Record<string, unknown>) => ({
  brand: 'Michelin',
  model: 'Defender LTX M/S2',
  tireSize: '265/70R17',
  stocked: false,
  ...fields,
})

// A 1x1 transparent PNG.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

describe('tire lines', () => {
  test('sizes of the same brand and model share one line and its details', async () => {
    const first = (
      await ok(
        api.post(
          '/products',
          tire({
            tireSize: 'lt265/70r17',
            loadIndex: 121,
            loadIndexDual: 118,
            speedRating: 's',
            loadRange: 'e',
            line: { tireType: 'all_terrain', season: 'all_season', warrantyMiles: 60000, severeSnow: true },
          }),
        ),
      )
    ).product
    assert.equal(first.tireSize, 'LT265/70R17')
    assert.deepEqual([first.loadIndex, first.loadIndexDual, first.speedRating, first.loadRange], [121, 118, 'S', 'E'])
    assert.equal(first.tireType, 'all_terrain')
    assert.equal(first.season, 'all_season')
    assert.equal(first.warrantyMiles, 60000)

    // Different spelling of the same line: joins it and shows its details.
    const second = (await ok(api.post('/products', tire({ brand: 'MICHELIN', model: 'defender ltx m/s2', tireSize: '275/65R18' })))).product
    assert.equal(second.tireLineId, first.tireLineId)
    assert.equal(second.brand, 'Michelin', "the line's spelling wins")
    assert.equal(second.warrantyMiles, 60000)

    const lines = (await ok(api.get('/tire-lines'))).lines
    assert.equal(lines.length, 1)
    assert.equal(lines[0].sizeCount, 2)

    // Renaming the line renames every size.
    await ok(api.put(`/tire-lines/${first.tireLineId}`, { brand: 'Michelin', model: 'Defender LTX', season: 'all_season' }))
    const products = (await ok(api.get('/products'))).products
    assert.deepEqual(
      products.map((p: { model: string; season: string }) => [p.model, p.season]),
      [
        ['Defender LTX', 'all_season'],
        ['Defender LTX', 'all_season'],
      ],
    )

    await ok(api.post('/tire-lines', { brand: 'Goodyear', model: 'Wrangler' }))
    assert.match(await refused(api.post('/tire-lines', { brand: 'goodyear', model: 'WRANGLER' }), 409), /already/)
  })

  test('tread photo upload, fetch and removal', async () => {
    const { tireLineId } = (await ok(api.post('/products', tire({})))).product
    const saved = (await ok(api.put(`/tire-lines/${tireLineId}/photo`, { dataUrl: PNG }))).line
    assert.equal(saved.hasPhoto, true)

    const photo = await fetch(photoUrl(tireLineId), { headers: { cookie: sessionCookie() } })
    assert.equal(photo.headers.get('content-type'), 'image/png')
    assert.ok((await photo.arrayBuffer()).byteLength > 0)

    await refused(api.put(`/tire-lines/${tireLineId}/photo`, { dataUrl: 'data:text/plain;base64,aGk=' }), 400)
    assert.equal((await ok(api.del(`/tire-lines/${tireLineId}/photo`))).line.hasPhoto, false)
  })
})

describe('catalog prices', () => {
  test('a special-order tire can be saved without a price; a stocked one cannot', async () => {
    const special = (await ok(api.post('/products', tire({})))).product
    assert.equal(special.price, null)
    assert.equal(special.costUpdatedAt, null)
    assert.match(await refused(api.post('/products', tire({ tireSize: '245/75R16', stocked: true, cost: 100 })), 400), /cost and a price/)
  })

  test('a special-order tire saved with a cost but no price is priced from the markup', async () => {
    const saved = (await ok(api.post('/products', tire({ cost: 100 })))).product
    assert.equal(saved.price, 130.99)
    const typed = (await ok(api.post('/products', tire({ tireSize: '245/75R16', cost: 100, price: 120 })))).product
    assert.equal(typed.price, 120, 'a typed price is kept')
  })

  test('entering a cost prices a special-order tire from the Settings markup', async () => {
    const special = (await ok(api.post('/products', tire({})))).product
    const priced = (await ok(api.post(`/products/${special.id}/cost`, { cost: 100 }))).product
    assert.equal(priced.cost, 100)
    assert.equal(priced.price, 130.99, '30% markup, rounded up to .99')
    assert.ok(priced.costUpdatedAt)

    const typed = (await ok(api.post(`/products/${special.id}/cost`, { cost: 100, price: 149.99 }))).product
    assert.equal(typed.price, 149.99, 'a price given by the advisor wins')

    const stocked = (await ok(api.post('/products', tire({ tireSize: '245/75R16', stocked: true, cost: 90, price: 150 })))).product
    const restock = (await ok(api.post(`/products/${stocked.id}/cost`, { cost: 95 }))).product
    assert.equal(restock.price, 150, 'stocked tires keep their own price')
  })

  test('a quote refuses an unpriced tire until its cost is entered', async () => {
    const special = (await ok(api.post('/products', tire({})))).product
    const t = await quote()
    assert.match(
      await refused(api.post(`/tickets/${t}/work-items`, { itemType: 'tires', tireProductId: special.id, tireQuantity: 4 }), 400),
      /no price yet/,
    )
    await ok(api.post(`/products/${special.id}/cost`, { cost: 150 }))
    await addItem(t, { itemType: 'tires', tireProductId: special.id, tireQuantity: 4 })
  })
})
