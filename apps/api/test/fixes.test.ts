// Regression tests for the code review fixes.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  addItem,
  api,
  assertInvariants,
  ok,
  pool,
  product,
  quote,
  refused,
  stock,
  ticket,
  useTestApp,
} from './helpers.js'

useTestApp()

type Line = { id: string; productId: string | null; serviceCode: string | null; unitPrice: number }

async function linesOf(ticketId: string, workItemId: string): Promise<Line[]> {
  return (await ticket(ticketId)).workItems.find((w: { id: string }) => w.id === workItemId).lines
}

async function entries(ticketId: string) {
  const floor = await ok(api.get('/shop'))
  const all = [...floor.queues.tires.entries, ...floor.queues.mechanic.entries, ...floor.queues.alignment.entries]
  return all.filter((e: { ticketId: string }) => e.ticketId === ticketId)
}

const productBody = (fields: Record<string, unknown>) => ({
  brand: 'Test',
  model: 'Repriced',
  tireSize: '225/65R17',
  cost: 100,
  price: 150,
  ...fields,
})

describe('copied prices stay put', () => {
  test('editing a tires item keeps the quoted tire price after a catalog change', async () => {
    const tire = await product({ model: 'Repriced', price: 150 })
    const t = await quote()
    const item = await addItem(t, { itemType: 'tires', tireProductId: tire, tireQuantity: 4 })

    await ok(api.put(`/products/${tire}`, productBody({ price: 170 })))
    await ok(api.put(`/work-items/${item}`, { tireProductId: tire, tireQuantity: 4, oldTiresRemoved: 2 }))
    let tireLine = (await linesOf(t, item)).find((l) => l.productId === tire)!
    assert.equal(tireLine.unitPrice, 150, 'quoted price kept')

    await ok(api.put(`/line-items/${tireLine.id}`, { resetPrice: true }))
    tireLine = (await linesOf(t, item)).find((l) => l.productId === tire)!
    assert.equal(tireLine.unitPrice, 170, 'reset picks up the catalog price')

    const other = await product({ price: 99, tireSize: '225/65R17' })
    await ok(api.put(`/work-items/${item}`, { tireProductId: other, tireQuantity: 4 }))
    assert.equal((await linesOf(t, item)).find((l) => l.productId === other)!.unitPrice, 99)
  })
})

describe('one car, one lift', () => {
  test('neither force nor Force ready puts a car on a second lift', async () => {
    const tire = await product()
    const t = await quote()
    await addItem(t, { itemType: 'tires', tireProductId: tire, tireQuantity: 4 })
    const mech = await addItem(t, { itemType: 'mechanic', title: 'Brakes' })
    await ok(api.post(`/work-items/${mech}/lines`, { kind: 'labor', quantity: 1 }))
    await ok(api.post(`/tickets/${t}/accept`, { checkIn: true }))

    const [tiresEntry, mechEntry] = ['tires', 'mechanic'].map(
      (q) => async () => (await entries(t)).find((e: { queue: string }) => e.queue === q).id,
    )
    await ok(api.post(`/shop/entries/${await tiresEntry()}/start`))
    const mechId = await mechEntry()
    await refused(api.post(`/shop/entries/${mechId}/start`, { force: true }), 409)
    await ok(api.put(`/shop/entries/${mechId}/ready`, { override: true }))
    const mechRow = (await entries(t)).find((e: { id: string }) => e.id === mechId)
    assert.equal(mechRow.ready, false)
    await refused(api.post(`/shop/entries/${mechId}/start`, { force: true }), 409)
    await assertInvariants()
  })
})

describe('cancelling an order for a job still to be done', () => {
  test('the job is refilled from the shelf or put back under Needs ordering', async () => {
    const tire = await product({ initialQty: 2 })
    const t = await quote()
    await addItem(t, { itemType: 'tires', tireProductId: tire, tireQuantity: 4 })
    await ok(api.post(`/tickets/${t}/accept`, { checkIn: true }))
    assert.deepEqual(await stock(tire), { onHand: 2, reserved: 2 })
    let order = (await ticket(t)).pendingOrders.find((o: { status: string }) => o.status === 'needed')

    // Still needed and nothing on the shelf: cancelling would just re-add it.
    assert.match(await refused(api.post(`/orders/${order.id}/cancel`), 409), /still needs this/)

    // The supplier falls through: back under Needs ordering.
    await ok(api.post('/orders/mark-ordered', { ids: [order.id], vendor: 'ATD', expectedAt: '2026-12-01' }))
    let res = await ok(api.post(`/orders/${order.id}/cancel`))
    assert.equal(res.outcome, 'ordered')
    order = (await ticket(t)).pendingOrders.find((o: { status: string }) => o.status === 'needed')
    assert.ok(order, 'a new Needs ordering row')
    assert.equal((await entries(t)).length, 0, 'still off the floor')

    // Two more turn up on the shelf: cancelling now fills the job from stock.
    await ok(api.post(`/products/${tire}/stock`, { mode: 'receive', quantity: 2 }))
    res = await ok(api.post(`/orders/${order.id}/cancel`))
    assert.equal(res.outcome, 'reserved')
    assert.deepEqual(await stock(tire), { onHand: 4, reserved: 4 })
    const tiresEntry = (await entries(t))[0]
    assert.ok(tiresEntry, 'joins the line')
    await ok(api.post(`/shop/entries/${tiresEntry.id}/done`))
    assert.deepEqual(await stock(tire), { onHand: 0, reserved: 0 })
    await assertInvariants()
  })
})

describe('camber kit on an alignment', () => {
  test('ordering a kit takes the car off the rack until it arrives, then the customer is called', async () => {
    const t = await quote()
    const align = await addItem(t, { itemType: 'alignment' })
    await ok(api.post(`/tickets/${t}/accept`, { checkIn: true }))
    const entry = (await entries(t))[0]
    await ok(api.post(`/shop/entries/${entry.id}/start`))

    await ok(
      api.post(`/work-items/${align}/lines`, {
        kind: 'part',
        description: 'Camber kit',
        quantity: 1,
        unitPrice: 89,
        order: true,
      }),
    )
    assert.equal((await entries(t)).length, 0, 'off the rack while the kit is on order')
    const floor = await ok(api.get('/shop'))
    assert.ok(floor.lifts.every((l: { entry: unknown }) => !l.entry), 'the rack is free')
    const upcoming = await ok(api.get('/shop/upcoming'))
    assert.ok(upcoming.tickets.some((x: { id: string }) => x.id === t))

    const kit = (await ticket(t)).pendingOrders[0]
    await ok(api.post(`/orders/${kit.id}/receive`))
    const calls = await ok(api.get('/calls'))
    assert.ok(calls.tickets.some((x: { ticketId: string }) => x.ticketId === t), 'on the call list')
    assert.equal((await entries(t)).length, 1, 'back in line')
    await assertInvariants()
  })
})

describe('TPMS sensors priced per car', () => {
  test('two lines of one sensor each are both $60; removing one goes back to $70', async () => {
    await product({ productType: 'tpms_sensor', brand: 'Universal', model: 'Sensor', tireSize: '', cost: 40, price: 70 })
    const t = await quote()
    const item = await addItem(t, { itemType: 'other', title: 'Sensors' })
    await ok(api.post(`/work-items/${item}/lines`, { kind: 'tpms_sensor', quantity: 1 }))
    assert.deepEqual((await linesOf(t, item)).map((l) => l.unitPrice), [70])
    await ok(api.post(`/work-items/${item}/lines`, { kind: 'tpms_sensor', quantity: 1 }))
    const both = await linesOf(t, item)
    assert.deepEqual(both.map((l) => l.unitPrice), [60, 60])
    await ok(api.del(`/line-items/${both[1].id}`))
    assert.deepEqual((await linesOf(t, item)).map((l) => l.unitPrice), [70])
  })

  test('a Settings change never re-prices sensors already on a ticket', async () => {
    await product({ productType: 'tpms_sensor', brand: 'Universal', model: 'Sensor', tireSize: '', cost: 40, price: 70 })
    const t = await quote()
    const item = await addItem(t, { itemType: 'other', title: 'Sensors' })
    await ok(api.post(`/work-items/${item}/lines`, { kind: 'tpms_sensor', quantity: 1 }))
    await pool.query('UPDATE settings SET tpms_sensor_single_price = 80, tpms_sensor_multi_price = 65')
    try {
      // The second sensor uses this ticket's prices, not today's Settings.
      await ok(api.post(`/work-items/${item}/lines`, { kind: 'tpms_sensor', quantity: 1 }))
      assert.deepEqual((await linesOf(t, item)).map((l) => l.unitPrice), [60, 60])
      // A new ticket gets the new prices.
      const fresh = await quote()
      const freshItem = await addItem(fresh, { itemType: 'other', title: 'Sensors' })
      await ok(api.post(`/work-items/${freshItem}/lines`, { kind: 'tpms_sensor', quantity: 1 }))
      assert.deepEqual((await linesOf(fresh, freshItem)).map((l) => l.unitPrice), [80])
    } finally {
      await pool.query('UPDATE settings SET tpms_sensor_single_price = 70, tpms_sensor_multi_price = 60')
    }
    await assertInvariants()
  })

  test('once accepted, a sensor not performed leaves the other at the agreed $60', async () => {
    await product({ productType: 'tpms_sensor', brand: 'Universal', model: 'Sensor', tireSize: '', cost: 40, price: 70 })
    const t = await quote()
    const front = await addItem(t, { itemType: 'other', title: 'Front sensor' })
    const rear = await addItem(t, { itemType: 'other', title: 'Rear sensor' })
    await ok(api.post(`/work-items/${front}/lines`, { kind: 'tpms_sensor', quantity: 1 }))
    await ok(api.post(`/work-items/${rear}/lines`, { kind: 'tpms_sensor', quantity: 1 }))
    await ok(api.post(`/tickets/${t}/accept`, {}))
    await ok(api.post(`/work-items/${front}/not-performed`, { reason: 'Customer kept the old one' }))
    assert.deepEqual((await linesOf(t, rear)).map((l) => l.unitPrice), [60], 'not raised to $70')

    // Lines from the accepted quote can't be changed; one added afterwards
    // can. Priced by hand, then reset: the standard price for the 2 sensors.
    const extra = await addItem(t, { itemType: 'other', title: 'Spare sensor' })
    await ok(api.post(`/work-items/${extra}/lines`, { kind: 'tpms_sensor', quantity: 1 }))
    const [line] = await linesOf(t, extra)
    assert.equal(line.unitPrice, 60)
    await ok(api.put(`/line-items/${line.id}`, { unitPrice: 30 }))
    await ok(api.put(`/line-items/${line.id}`, { resetPrice: true }))
    assert.deepEqual((await linesOf(t, extra)).map((l) => l.unitPrice), [60])
    await assertInvariants()
  })
})

describe('input checks', () => {
  test('money with more than 2 decimals is refused', async () => {
    const t = await quote()
    const item = await addItem(t, { itemType: 'other', title: 'Misc' })
    assert.match(
      await refused(api.post(`/work-items/${item}/lines`, { kind: 'custom', description: 'x', quantity: 1, unitPrice: 10.005 }), 400),
      /2 decimal places/,
    )
    await ok(api.post(`/work-items/${item}/lines`, { kind: 'custom', description: 'x', quantity: 1, unitPrice: 10.05 }))
    await ok(api.post(`/tickets/${t}/accept`, { checkIn: true }))
    assert.match(await refused(api.post(`/tickets/${t}/deposits`, { amount: 10.005, method: 'cash' }), 400), /2 decimal places/)
  })

  test('the same line picked to order twice is refused', async () => {
    const t = await quote()
    const item = await addItem(t, { itemType: 'other', title: 'Rims' })
    const body = await ok(api.post(`/work-items/${item}/lines`, { kind: 'custom', description: 'Rim', quantity: 4, unitPrice: 200 }))
    const line = body.ticket.workItems[0].lines[0].id
    const message = await refused(
      api.post(`/tickets/${t}/accept`, {
        orderLines: [
          { lineItemId: line, itemKind: 'rim' },
          { lineItemId: line, itemKind: 'rim' },
        ],
        deposit: { amount: 200, method: 'card' },
      }),
      400,
    )
    assert.match(message, /twice/)
    assert.equal((await ticket(t)).status, 'quote', 'nothing was ordered')
  })

  test('a stocked tire that is out needs no deposit', async () => {
    const stocked = await product({ initialQty: 0 })
    const t = await quote()
    await addItem(t, { itemType: 'tires', tireProductId: stocked, tireQuantity: 4 })
    await ok(api.post(`/tickets/${t}/accept`, {}))
    await assertInvariants()
  })

  test('customers need a phone number', async () => {
    assert.match(await refused(api.post('/customers', { firstName: 'No Phone' }), 400), /Phone/)
  })
})
