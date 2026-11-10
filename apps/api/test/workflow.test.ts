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

// Queue entry id for a ticket's job in a queue, from the shop floor.
async function entryFor(ticketId: string, queue: 'tires' | 'mechanic' | 'alignment') {
  const floor = await ok(api.get('/shop'))
  return floor.queues[queue].entries.find((e: { ticketId: string }) => e.ticketId === ticketId)?.id as
    | string
    | undefined
}

describe('quote to paid invoice', () => {
  test('stock is reserved, used and invoiced once, and every invariant holds', async () => {
    const tire = await product({ initialQty: 8 })
    const t = await quote()
    await addItem(t, { itemType: 'tires', tireProductId: tire, tireQuantity: 4 })
    await addItem(t, { itemType: 'alignment' })

    await ok(api.post(`/tickets/${t}/accept`, { checkIn: true }))
    assert.deepEqual(await stock(tire), { onHand: 8, reserved: 4 })
    await assertInvariants()

    // Tires first; the alignment waits until they're done.
    const tiresEntry = await entryFor(t, 'tires')
    assert.ok(tiresEntry)
    await ok(api.post(`/shop/entries/${tiresEntry}/start`))
    await ok(api.post(`/shop/entries/${tiresEntry}/done`))
    assert.deepEqual(await stock(tire), { onHand: 4, reserved: 0 })

    const alignmentEntry = await entryFor(t, 'alignment')
    assert.ok(alignmentEntry)
    await ok(api.post(`/shop/entries/${alignmentEntry}/start`))
    await ok(api.post(`/shop/entries/${alignmentEntry}/done`))

    const due = (await ticket(t)).balance.balance
    const paid = await ok(
      api.post(`/tickets/${t}/invoice`, { payments: [{ method: 'card', amount: due }] }),
    )
    assert.equal(paid.ticket.invoiceNumber, 5001)
    assert.ok(paid.ticket.paidAt)
    assert.equal(paid.ticket.balance.balance, 0)
    await assertInvariants()
  })
})

describe('finished work is locked', () => {
  test('a done tires job refuses new lines, edits and removal', async () => {
    const tire = await product()
    const t = await quote()
    const tiresItem = await addItem(t, { itemType: 'tires', tireProductId: tire, tireQuantity: 4 })
    await ok(api.post(`/tickets/${t}/accept`, { checkIn: true }))
    await ok(api.post(`/work-items/${tiresItem}/complete`))

    await refused(api.post(`/work-items/${tiresItem}/lines`, { kind: 'tpms_sensor', quantity: 4 }), 409)
    await refused(api.put(`/work-items/${tiresItem}`, { title: 'Renamed' }), 409)
    await refused(api.del(`/work-items/${tiresItem}`), 409)
    const line = (await ticket(t)).workItems[0].lines[0]
    await refused(api.put(`/line-items/${line.id}`, { discountType: 'amount', discountValue: 5 }), 409)

    // Nothing was left reserved by the refused calls.
    assert.deepEqual(await stock(tire), { onHand: 4, reserved: 0 })
    await assertInvariants()
  })
})

describe('supplier tires and Coming up', () => {
  test('a special-order job stays off the floor until its tires arrive', async () => {
    const tire = await product({ stocked: false, initialQty: 0, supplier: 'ATD', tireSize: 'LT285/70R17' })
    const t = await quote()
    await addItem(t, { itemType: 'tires', tireProductId: tire, tireQuantity: 4 })
    await addItem(t, { itemType: 'alignment' })
    await ok(
      api.post(`/tickets/${t}/accept`, { checkIn: true, deposit: { amount: 200, method: 'card' } }),
    )

    assert.equal(await entryFor(t, 'tires'), undefined)
    assert.equal(await entryFor(t, 'alignment'), undefined)
    const upcoming = await ok(api.get('/shop/upcoming'))
    const row = upcoming.tickets.find((x: { id: string }) => x.id === t)
    assert.ok(row, 'listed under Coming up')
    assert.equal(row.orders[0].vendor, 'ATD')
    await assertInvariants()

    const order = (await ticket(t)).pendingOrders[0]
    await ok(api.post(`/orders/${order.id}/receive`, { quantity: 2 }))
    assert.equal(await entryFor(t, 'tires'), undefined, 'still waiting on 2 tires')
    await ok(api.post(`/orders/${order.id}/receive`))
    assert.ok(await entryFor(t, 'tires'), 'joins the line when the last tire arrives')
    assert.ok(await entryFor(t, 'alignment'))
    assert.deepEqual(await stock(tire), { onHand: 4, reserved: 4 })
    await assertInvariants()
  })

  test('a deposit is required for special-order tires', async () => {
    const tire = await product({ stocked: false, initialQty: 0 })
    const t = await quote()
    await addItem(t, { itemType: 'tires', tireProductId: tire, tireQuantity: 4 })
    await refused(api.post(`/tickets/${t}/accept`, {}), 400)
  })
})

describe('invoice numbers', () => {
  test('a refused checkout does not use up a number', async () => {
    const t = await quote()
    await addItem(t, { itemType: 'alignment' })
    await ok(api.post(`/tickets/${t}/accept`, { checkIn: true }))
    await ok(api.post(`/work-items/${(await ticket(t)).workItems[0].id}/complete`))

    await refused(api.post(`/tickets/${t}/invoice`, { payments: [{ method: 'cash', amount: 1 }] }), 400)
    const counter = await pool.query('SELECT last_number FROM invoice_counter')
    assert.equal(counter.rows[0].last_number, 5000)

    const due = (await ticket(t)).balance.balance
    const paid = await ok(api.post(`/tickets/${t}/invoice`, { payments: [{ method: 'cash', amount: due }] }))
    assert.equal(paid.ticket.invoiceNumber, 5001)
    await assertInvariants()
  })
})
