import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { importCatalog, mapHeader, parseDelimited, readTire } from '../src/catalogImport.js'
import { api, assertInvariants, ok, pool, product, quote, useTestApp } from './helpers.js'

useTestApp()

const header = [
  'brand', 'model', 'category', 'type', 'season', 'warranty', 'road_hazard', 'size', 'size_alt',
  'service_index', 'Sidewall', 'LR/PR', 'tread_depth', 'max_load', 'UTQG',
].join('\t')
const row = (...cells: string[]) => cells.join('\t')
const file = (...rows: string[]) => [header, ...rows].join('\n')

const passenger = row('Zz', 'Road One', 'Passenger', 'Performance', 'All Season', '60k', 'TRUE', '225/65R17', '', '102H', 'BW', 'XL', '10/32', '1874@50', '540 A B')
const passengerW = row('Zz', 'Road One', 'Passenger', 'Performance', 'All Season', '50k', 'TRUE', '225/45ZR17', '', '94W', 'BW', 'XL', '10/32', '1477@50', '540 A A')
const truck = row('Zz', 'Trail AT', 'Light Truck/SUV', 'All-Terrain', 'Snow Traction', '55k', 'TRUE', 'LT285/55R20', '33X11.50R20LT', '122/119S', 'BLK', 'E/10', '16/32', '3415@80', '-')

async function runImport(text: string) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const report = await importCatalog(client, text)
    await client.query('COMMIT')
    return report
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

describe('reading supplier files', () => {
  test('tab or comma separated, quotes allowed, blank lines ignored', () => {
    assert.deepEqual(parseDelimited('a,b\n"1, 2","say ""hi"""\n\n'), [['a', 'b'], ['1, 2', 'say "hi"']])
    assert.deepEqual(parseDelimited('a\tb\r\n1\t2'), [['a', 'b'], ['1', '2']])
  })

  test('headers match loosely and brand, model and size are required', () => {
    const { columns, missing } = mapHeader(header.split('\t'))
    assert.equal(missing.length, 0)
    assert.equal(columns.loadRange, 11, 'LR/PR')
    assert.deepEqual(mapHeader(['Brand', 'Tread Name']).missing, ['size'])
  })

  test('a row becomes the specs the comparison uses', () => {
    const { columns } = mapHeader(header.split('\t'))
    const read = (line: string) => {
      const r = readTire(line.split('\t'), columns, 2)
      assert.ok('tire' in r)
      assert.deepEqual(r.notes, [])
      return r.tire
    }
    const p = read(passenger)
    assert.equal(p.loadIndex, 102)
    assert.equal(p.speedRating, 'H')
    assert.equal(p.extraLoad, true)
    assert.equal(p.warrantyMiles, 60000)
    assert.equal(p.tireType, 'performance')
    assert.equal(p.season, 'all_season')
    assert.deepEqual([p.utqgTreadwear, p.utqgTraction, p.utqgTemperature], [540, 'A', 'B'])
    assert.deepEqual([p.maxLoadLbs, p.maxLoadPsi, p.treadDepth32nds], [1874, 50, 10])

    const t = read(truck)
    assert.deepEqual([t.loadIndex, t.loadIndexDual, t.speedRating, t.loadRange], [122, 119, 'S', 'E'])
    assert.equal(t.tireType, 'all_terrain')
    assert.equal(t.season, 'all_season', 'terrain tires with the snowflake stay all-season')
    assert.equal(t.severeSnow, true)
    assert.equal(t.utqgTreadwear, null, 'LT tires have no UTQG')

    const road = read(row('Zz', 'Snow Road', '', 'Performance', 'Snow Traction', 'none', 'FALSE', '205/55R16', '', '91H', '', 'SL', '', '', ''))
    assert.equal(road.season, 'all_weather', 'a road tire with the snowflake is all-weather')
    assert.equal(road.warrantyMiles, 0, 'none = no mileage warranty')

    const { columns: c } = mapHeader(header.split('\t'))
    assert.deepEqual(readTire(row('Zz', 'Bad', '', '', '', '', '', 'not a size').split('\t'), c, 9), { error: 'can\'t read size "NOTASIZE"' })
  })
})

describe('importing the catalog', () => {
  test('creates lines and special-order sizes with no stock or price; warranty per size', async () => {
    const report = await runImport(file(passenger, passengerW, truck))
    assert.equal(report.linesNew.length, 2)
    assert.equal(report.sizesNew, 3)

    const sizes = (await ok(api.get('/products'))).products.filter((p: { brand: string }) => p.brand === 'Zz')
    const w = sizes.find((p: { tireSize: string }) => p.tireSize === '225/45ZR17')
    assert.equal(w.stocked, false)
    assert.equal(w.price, null)
    assert.equal(w.onHandQty, 0)
    assert.equal(w.warrantyMiles, 50000, 'the W-rated size keeps its own warranty')
    assert.equal(w.roadHazard, true)
    assert.equal(w.tireType, 'performance')
    await assertInvariants()
  })

  test('re-importing updates specs without duplicating or touching cost, price, stock or advisor edits', async () => {
    await runImport(file(passenger, truck))
    const line = (await ok(api.get('/tire-lines'))).lines.find((l: { model: string }) => l.model === 'Road One')
    // The advisor prices one size and reclassifies the line.
    const size = (await ok(api.get('/products'))).products.find((p: { model: string }) => p.model === 'Road One')
    await ok(api.post(`/products/${size.id}/cost`, { cost: 90 }))
    await ok(api.put(`/tire-lines/${line.id}`, { brand: 'Zz', model: 'Road One', tireType: 'touring', season: 'all_season', warrantyMiles: 60000, roadHazard: true }))

    const newer = passenger.replace('10/32', '11/32')
    const report = await runImport(file(newer, truck))
    assert.equal(report.linesNew.length, 0)
    assert.equal(report.sizesNew, 0)
    assert.equal(report.sizesUpdated, 1)
    assert.equal(report.sizesUnchanged, 1)

    const after = (await ok(api.get('/products'))).products.find((p: { id: string }) => p.id === size.id)
    assert.equal(after.treadDepth32nds, 11)
    assert.equal(after.cost, 90)
    assert.equal(after.price, size.price === null ? after.price : size.price)
    assert.ok(after.price > 90)
    assert.equal(after.tireType, 'touring', 'the advisor’s type sticks')
    await assertInvariants()
  })

  test('a size the advisor already added by hand is matched, not duplicated', async () => {
    const id = await product({ brand: 'Zz', model: 'Road One', tireSize: 'P225/65R17' })
    const report = await runImport(file(passenger))
    assert.equal(report.sizesNew, 0)
    const p = (await ok(api.get('/products'))).products.find((x: { id: string }) => x.id === id)
    assert.equal(p.loadIndex, 102)
    assert.equal(p.onHandQty, 8, 'stock untouched')
    assert.equal(p.stocked, true)
  })
})

describe('imported tires in the comparison', () => {
  test('the comparison finds an LT tire by its flotation size too', async () => {
    await runImport(file(truck))
    const t = await quote({}, { tireSize: '33X11.50R20LT', driveType: '4wd' })
    const size = (await ok(api.get('/products'))).products.find((p: { model: string }) => p.model === 'Trail AT')
    const c = await ok(api.get(`/tickets/${t}/tire-options?quantity=4`))
    assert.equal(c.tiers.length, 0, 'not on the shelf: never one of the three')
    assert.equal(c.orderIn[0].id, size.id)
  })
})
