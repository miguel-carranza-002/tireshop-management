import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  alternateSizes,
  alternatesAllowed,
  closestMatches,
  filterMisses,
  loadLevel,
  needsBanner,
  noFilters,
  optionWarnings,
  pickTiers,
  sizeKey,
} from '../src/comparison.js'
import { api, assertInvariants, customerWithVehicle, ok, product, refused, ticket, useTestApp } from './helpers.js'

useTestApp()

const sizeRules = { lowProfileMaxAspect: 45, oversizedMinDiameterIn: 33 }
const none = { isEv: false, heavyDuty: false, runFlat: false, requiredLoadIndex: null, requiredLoadRange: null, requiredSpeedRating: null }

describe('comparison rules', () => {
  test('sizes match however they are written', () => {
    assert.equal(sizeKey('P225/65R17'), sizeKey('225/65r17'))
    assert.equal(sizeKey('245/40ZR18'), '245/40R18')
    assert.notEqual(sizeKey('LT265/70R17'), sizeKey('265/70R17'))
  })

  test('alternate sizes are one step away and within 3% of the height', () => {
    const alts = alternateSizes('225/65R17', sizeRules)
    assert.deepEqual(
      alts.map((a) => [a.size, a.diffPercent]),
      [
        ['215/65R17', -1.8],
        ['235/65R17', 1.8],
      ],
      'aspect steps (±3.3%) are too far for this size',
    )
    assert.deepEqual(alternateSizes('35x12.50R20', sizeRules), [], 'flotation sizes have no metric steps')
  })

  test('alternates depend on drive type and how many tires', () => {
    assert.equal(alternatesAllowed('2wd', 2).allowed, true)
    assert.equal(alternatesAllowed('2wd', 1).allowed, false)
    assert.equal(alternatesAllowed('awd', 2).allowed, false)
    assert.equal(alternatesAllowed('awd', 4).allowed, true)
    assert.match(alternatesAllowed('unknown', 2).reason ?? '', /treated as AWD/)
  })

  test('cheap, medium and premium by price per tire', () => {
    const tiers = pickTiers([150, 100, 250, 120, 180].map((price) => ({ price })))
    assert.deepEqual(
      tiers.map((t) => [t.tier, t.item.price]),
      [
        ['cheap', 100],
        ['medium', 180],
        ['premium', 250],
      ],
      'medium is nearest halfway (175)',
    )
    assert.deepEqual(pickTiers([{ price: 90 }]).map((t) => t.tier), ['option'])
  })

  test('filters say what a tire misses; load range is a minimum', () => {
    const tire = {
      brand: 'Celimo',
      warrantyMiles: 50000,
      season: 'all_weather',
      tireType: 'touring',
      loadRange: null,
      extraLoad: true,
      price: 110,
      roadHazard: true,
    }
    assert.deepEqual(filterMisses(tire, noFilters), [])
    const asked = { ...noFilters, brands: ['celimo'], roadHazard: true, minWarranty: 40000, season: 'all_season' }
    assert.deepEqual(filterMisses(tire, asked), [], 'brand ignores case; all-weather counts as all-season')
    assert.deepEqual(
      filterMisses({ ...tire, brand: 'Cooper', roadHazard: false, warrantyMiles: 0 }, { ...asked, minWarranty: 60000 }),
      ['other brand', 'no road hazard', 'no mileage warranty'],
    )
    assert.deepEqual(filterMisses(tire, { ...noFilters, maxPrice: 100 }), ['over price'])
    assert.deepEqual(filterMisses({ ...tire, price: null }, { ...noFilters, maxPrice: 100 }), [], 'no price yet is not over')

    assert.equal(loadLevel({ loadRange: null, extraLoad: false }), 0)
    assert.equal(loadLevel({ loadRange: null, extraLoad: true }), 1)
    assert.equal(loadLevel({ loadRange: 'E', extraLoad: false }), 4)
    assert.deepEqual(filterMisses({ ...tire, loadRange: 'F', extraLoad: false }, { ...noFilters, minLoad: 'E' }), [])
    assert.deepEqual(filterMisses({ ...tire, loadRange: 'C', extraLoad: false }, { ...noFilters, minLoad: 'E' }), ['load C'])

    const misses = (n: number) => Array(n).fill('x')
    assert.deepEqual(closestMatches([2, 0, 1, 0], misses), [0, 0], 'full matches only')
    assert.deepEqual(closestMatches([2, 1, 3, 1], misses), [1, 1], 'else the closest')
  })

  test('warnings for vehicles that need them, and a banner when values are missing', () => {
    const ev = { ...none, isEv: true, requiredLoadIndex: 100, requiredSpeedRating: 'V' }
    assert.deepEqual(optionWarnings(ev, { loadIndex: 98, speedRating: 'H', loadRange: null, evRated: false, runFlat: false }), [
      'Load index 98 < required 100',
      'Speed rating H below required V',
      'Not EV-rated',
    ])
    assert.deepEqual(optionWarnings(ev, { loadIndex: 104, speedRating: 'W', loadRange: null, evRated: true, runFlat: false }), [])
    assert.deepEqual(optionWarnings(none, { loadIndex: null, speedRating: null, loadRange: null, evRated: false, runFlat: false }), [])
    assert.match(needsBanner({ ...none, heavyDuty: true }) ?? '', /door placard/)
    assert.equal(needsBanner(ev), null)
    assert.equal(needsBanner(none), null)
  })
})

async function quoteFor(vehicle: Record<string, unknown>) {
  const { customerId, vehicleId } = await customerWithVehicle({}, vehicle)
  return (await ok(api.post('/tickets', { customerId, vehicleId }))).ticket.id as string
}

describe('comparing and quoting options', () => {
  test('three by price, the rest listed, out-the-door totals, alternates', async () => {
    for (const [model, price] of [['A', 100], ['B', 120], ['C', 150], ['D', 180], ['E', 250]] as const) {
      await product({ model, tireSize: '225/65R17', price })
    }
    await product({ model: 'Unpriced', tireSize: '225/65R17', stocked: false, initialQty: 0, cost: null, price: null })
    // Cheaper, but ordered in: never one of the three on its own.
    await product({ model: 'Supplier', tireSize: '225/65R17', stocked: false, initialQty: 0, cost: 50, price: null })
    // On the shelf, but only 2 of the 4 needed.
    await product({ model: 'Short', tireSize: '225/65R17', price: 90, initialQty: 2 })
    await product({ model: 'Used', tireSize: '225/65R17', condition: 'used', price: 45, cost: 20, initialQty: 2 })
    await product({ model: 'Wider', tireSize: '235/65R17', price: 140 })
    const t = await quoteFor({ tireSize: '225/65R17', driveType: '2wd' })

    const c = await ok(api.get(`/tickets/${t}/tire-options?quantity=4`))
    assert.deepEqual(
      c.tiers.map((x: { tier: string; option: { model: string } }) => [x.tier, x.option.model]),
      [
        ['cheap', 'A'],
        ['medium', 'D'],
        ['premium', 'E'],
      ],
    )
    // 4 x $100 + mount & balance 4 x $20 + disposal 4 x $5 + 8% tax on the tires (example prices).
    assert.deepEqual(c.tiers[0].option.outTheDoor, { tires: 400, mountBalance: 80, disposal: 20, tax: 32, total: 532 })
    assert.deepEqual(c.others.map((o: { model: string }) => o.model), ['B', 'C'])
    assert.deepEqual(c.orderIn.map((o: { model: string }) => o.model), ['Short', 'Supplier', 'Unpriced'], 'shelf tires we are short on first')
    assert.deepEqual(c.used.map((o: { model: string }) => o.model), ['Used'])
    assert.deepEqual(c.alternates.options.map((o: { model: string; diffPercent: number }) => [o.model, o.diffPercent]), [['Wider', 1.8]])

    const awd = await quoteFor({ tireSize: '225/65R17', driveType: 'awd' })
    const two = await ok(api.get(`/tickets/${awd}/tire-options?quantity=2`))
    assert.equal(two.alternates.allowed, false)
  })

  test('no size: nothing is guessed until one is given', async () => {
    await product({ model: 'A', tireSize: '205/55R16', price: 90 })
    const t = await quoteFor({})
    assert.equal((await ok(api.get(`/tickets/${t}/tire-options`))).needsSize, true)
    const given = await ok(api.get(`/tickets/${t}/tire-options?size=205/55r16`))
    assert.equal(given.tiers[0].option.model, 'A')
  })

  test('filters narrow the cards; when nothing meets them, the closest are shown with what they miss', async () => {
    const line = (roadHazard: boolean, warrantyMiles: number) => ({ roadHazard, warrantyMiles, season: 'all_season' })
    await product({ brand: 'Milestar', model: 'Road', tireSize: '215/55R16', price: 90, line: line(true, 50000) })
    await product({ brand: 'Milestar', model: 'Short', tireSize: '215/55R16', price: 80, line: line(true, 30000) })
    await product({ brand: 'Cooper', model: 'Plain', tireSize: '215/55R16', price: 120, line: line(false, 60000) })
    await product({ brand: 'Celimo', model: 'Ordered', tireSize: '215/55R16', stocked: false, initialQty: 0, cost: null, price: null, line: line(true, 60000) })
    const t = await quoteFor({ tireSize: '215/55R16', driveType: '2wd' })
    const models = (list: { model: string }[]) => list.map((o) => o.model)

    const all = await ok(api.get(`/tickets/${t}/tire-options?quantity=4`))
    assert.deepEqual(models(all.tiers.map((x: { option: { model: string } }) => x.option)), ['Short', 'Road', 'Plain'])
    assert.ok(all.brands.includes('Celimo') && all.brands.includes('Cooper'))

    const asked = await ok(api.get(`/tickets/${t}/tire-options?quantity=4&roadHazard=true&minWarranty=40000`))
    assert.deepEqual(models(asked.tiers.map((x: { option: { model: string } }) => x.option)), ['Road'])
    assert.equal(asked.filterNote, null)
    assert.deepEqual(models(asked.orderIn), ['Ordered'])

    // Nothing on the shelf is a Celimo with road hazard: the closest stay, saying why.
    const none = await ok(api.get(`/tickets/${t}/tire-options?quantity=4&brands=Celimo&roadHazard=true`))
    assert.deepEqual(models(none.tiers.map((x: { option: { model: string } }) => x.option)), ['Short', 'Road'])
    assert.deepEqual(none.tiers[0].option.misses, ['other brand'])
    assert.match(none.filterNote, /closest/)
    assert.deepEqual(models(none.orderIn), ['Ordered'], 'the order-in list still meets every filter')
  })

  test('tires picked from the catalog are added, any size, on the shelf or not', async () => {
    await product({ model: 'Shelf', tireSize: '225/65R17', price: 120 })
    const special = await product({ model: 'Special', tireSize: '225/65R17', stocked: false, initialQty: 0, cost: 80, price: null })
    const taller = await product({ model: 'Taller', tireSize: '235/70R17', stocked: false, initialQty: 0, cost: 95, price: null })
    const t = await quoteFor({ tireSize: '225/65R17', driveType: '2wd' })

    const plain = await ok(api.get(`/tickets/${t}/tire-options?quantity=4`))
    assert.deepEqual(plain.added, [])
    // Already listed in this size: not repeated. Another size: added, with its height difference.
    const c = await ok(api.get(`/tickets/${t}/tire-options?quantity=4&extra=${special},${taller},999999`))
    assert.deepEqual(
      c.added.map((o: { model: string; diffPercent?: number }) => [o.model, o.diffPercent]),
      [['Taller', 5.3]],
    )
    assert.ok(c.orderIn.some((o: { id: string }) => o.id === special))
    // With today's cost it can be quoted like any other.
    await ok(api.post(`/products/${taller}/cost`, { cost: 95 }))
    await ok(api.post(`/tickets/${t}/tire-options`, { size: '225/65R17', quantity: 4, productIds: [taller] }))
    await assertInvariants()
  })

  test('staggered: the rear axle uses the rear size', async () => {
    await product({ model: 'Front', tireSize: '245/40R18', price: 180 })
    await product({ model: 'Rear', tireSize: '275/35R18', price: 210 })
    const t = await quoteFor({ tireSize: '245/40R18', rearTireSize: '275/35R18', driveType: '2wd' })
    const rear = await ok(api.get(`/tickets/${t}/tire-options?quantity=2&axle=rear`))
    assert.equal(rear.staggered, true)
    assert.equal(rear.tiers[0].option.model, 'Rear')
  })

  test('quoted options lock their price; accepting needs a pick', async () => {
    const ids: string[] = []
    for (const [model, price] of [['A', 100], ['B', 150], ['C', 250]] as const) {
      ids.push(await product({ model, tireSize: '225/65R17', price }))
    }
    const t = await quoteFor({ tireSize: '225/65R17', driveType: '2wd' })
    const saved = (await ok(api.post(`/tickets/${t}/tire-options`, { size: '225/65R17', quantity: 4, productIds: [ids[2], ids[0], ids[1]] })))
      .ticket
    const item = saved.workItems[0]
    assert.equal(item.lines.length, 0, 'nothing charged until a tire is picked')
    assert.deepEqual(item.tireOptions.map((o: { tier: string; unitPrice: number }) => [o.tier, o.unitPrice]), [
      ['cheap', 100],
      ['medium', 150],
      ['premium', 250],
    ])
    assert.equal(saved.totals.total, 0)
    assert.match(await refused(api.post(`/tickets/${t}/accept`, { checkIn: true }), 409), /Pick one of the quoted tire options/)

    // The catalog moves; the customer still gets the quoted price.
    await ok(api.put(`/products/${ids[1]}`, { brand: 'Test', model: 'B', tireSize: '225/65R17', cost: 100, price: 175 }))
    const medium = item.tireOptions[1]
    const picked = (await ok(api.post(`/work-items/${item.id}/pick-option`, { optionId: medium.id }))).ticket
    const tireLine = picked.workItems[0].lines.find((l: { productId: string }) => l.productId === ids[1])
    assert.equal(tireLine.unitPrice, 150)
    assert.equal(tireLine.quantity, 4)
    assert.equal(picked.workItems[0].tireOptions.length, 0)
    await ok(api.post(`/tickets/${t}/accept`, { checkIn: true }))
  })
})
