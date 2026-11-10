import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { readTireRequest } from '../src/tireRequest.js'
import { api, ok, product, quote, refused, useTestApp } from './helpers.js'

useTestApp()

const brands = ['Milestar', 'Celimo', 'BF Goodrich', 'Cooper', 'Goodyear']
const read = (text: string, quantity = 4) => readTireRequest(text, brands, quantity)

describe('reading what the advisor types', () => {
  test('the example sentence', () => {
    const r = read('4 215/55r16 with road hazard and warranty above 40k')
    assert.equal(r.quantity, 4)
    assert.equal(r.size, '215/55R16')
    assert.equal(r.filters.roadHazard, true)
    assert.equal(r.filters.minWarranty, 40000)
    assert.deepEqual(r.understood, ['4 tires', '215/55R16', 'road hazard', '40k+ warranty'])
    assert.deepEqual(r.unread, [])
  })

  test('sizes however they are written', () => {
    assert.equal(read('2 2155516').size, '215/55R16')
    assert.equal(read('215 55 16').size, '215/55R16')
    assert.equal(read('P225/65R17').size, '225/65R17')
    assert.equal(read('245/40zr18').size, '245/40R18')
    assert.equal(read('lt245/75r16 e rated').size, 'LT245/75R16')
    assert.equal(read('33x12.5r15').size, '33X12.50R15LT')
    assert.equal(read('road hazard').size, null)
  })

  test('number of tires', () => {
    assert.equal(read('pair of 225/65r17').quantity, 2)
    assert.equal(read('a set of four').quantity, 4)
    assert.equal(read('2 tires 215/55r16 40k').quantity, 2)
    assert.equal(read('215/55r16 x2').quantity, 2)
    assert.equal(read('215/55r16 50k').quantity, null)
  })

  test('load range, plies and XL', () => {
    assert.equal(read('load range e').filters.minLoad, 'E')
    assert.equal(read('LRE').filters.minLoad, 'E')
    assert.equal(read('10 ply').filters.minLoad, 'E')
    assert.equal(read('6ply').filters.minLoad, 'C')
    assert.equal(read('xl').filters.minLoad, 'XL')
    assert.equal(read('4 lt265/70r17 10 ply').quantity, 4)
  })

  test('season, type and brand', () => {
    const r = read('milestar or celimo all season highway')
    assert.deepEqual(r.filters.brands, ['Milestar', 'Celimo'])
    assert.equal(r.filters.season, 'all_season')
    assert.equal(r.filters.tireType, 'highway')
    assert.equal(read('all weather').filters.season, 'all_weather')
    assert.equal(read('snow tires').filters.season, 'winter')
    assert.equal(read('a/t').filters.tireType, 'all_terrain')
    assert.deepEqual(read('bfgoodrich ko2').filters.brands, ['BF Goodrich'])
  })

  test('budget per tire or for the set', () => {
    assert.equal(read('under $120').filters.maxPrice, 120)
    assert.equal(read('max 150 each').filters.maxPrice, 150)
    assert.equal(read('2 tires $300 total').filters.maxPrice, 150)
    // No number of tires typed: the dialog's current count divides it.
    assert.equal(read('budget 600 for all', 4).filters.maxPrice, 150)
    assert.equal(read('under $120').quantity, null)
  })

  test('front or rear, and words it could not place', () => {
    assert.equal(read('2 rear 275/35r19').axle, 'rear')
    const r = read('4 215/55r16 run flat michelin quiet')
    assert.deepEqual(r.unread, ['run', 'flat', 'michelin', 'quiet'])
  })
})

describe('tire request endpoint', () => {
  test('reads with the catalog brands, refuses empty text', async () => {
    const id = await quote()
    await product({ brand: 'Zzbrand' })
    const r = await ok(api.post(`/tickets/${id}/tire-request`, { text: '4 225/65r17 zzbrand road hazard', quantity: 4 }))
    assert.equal(r.size, '225/65R17')
    assert.equal(r.quantity, 4)
    assert.equal(r.filters.roadHazard, true)
    assert.deepEqual(r.filters.brands, ['Zzbrand'])
    await refused(api.post(`/tickets/${id}/tire-request`, { text: '  ' }), 400)
  })
})
