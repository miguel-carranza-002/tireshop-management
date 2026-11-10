import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { tirePriceFromCost } from '../src/pricing.js'
import { addItem, api, ok, pool, quote, refused, ticket, useTestApp } from './helpers.js'

useTestApp()

// Settings live in one row that resetData() doesn't touch, so put back
// anything a test changes.
async function restore(values: Record<string, unknown>) {
  await ok(api.put('/settings', values))
}

describe('settings', () => {
  test('saving a price applies to new lines and leaves existing ones alone', async () => {
    const before = (await ok(api.get('/settings'))).settings
    const t = await quote()
    const first = await addItem(t, { itemType: 'alignment' })
    try {
      const saved = await ok(api.put('/settings', { alignmentCarPrice: 95, shopName: '  Main St Tire  ' }))
      assert.equal(saved.settings.alignmentCarPrice, 95)
      assert.equal(saved.settings.shopName, 'Main St Tire', 'trimmed')

      const t2 = await quote()
      await addItem(t2, { itemType: 'alignment' })
      assert.equal((await ticket(t2)).workItems[0].lines[0].unitPrice, 95)
      const old = (await ticket(t)).workItems.find((w: { id: string }) => w.id === first)
      assert.equal(old.lines[0].unitPrice, before.alignmentCarPrice, 'existing quote keeps its price')
    } finally {
      await restore({ alignmentCarPrice: before.alignmentCarPrice, shopName: before.shopName })
    }
  })

  test('bad values are refused and nothing is saved', async () => {
    const before = (await ok(api.get('/settings'))).settings
    assert.match(await refused(api.put('/settings', { disposalFee: 6, shopRatePerHour: -1 }), 400), /Shop rate/)
    assert.match(await refused(api.put('/settings', { productsTaxRate: 0.9 }), 400), /Tax rate/)
    assert.match(await refused(api.put('/settings', { quoteValidDays: 2.5 }), 400), /whole number/)
    assert.match(await refused(api.put('/settings', { shopName: '' }), 400), /required/)
    assert.match(await refused(api.put('/settings', { madeUp: 1 }), 400), /Unknown setting/)
    const after = (await ok(api.get('/settings'))).settings
    assert.equal(after.disposalFee, before.disposalFee, 'the valid value in a refused save was not saved either')
  })

  test('blank optional text clears it', async () => {
    const before = (await ok(api.get('/settings'))).settings
    try {
      const saved = await ok(api.put('/settings', { shopPhone: '   ' }))
      assert.equal(saved.settings.shopPhone, null)
    } finally {
      await restore({ shopPhone: before.shopPhone ?? '' })
    }
    const row = await pool.query('SELECT shop_phone FROM settings')
    assert.equal(row.rows[0].shop_phone, before.shopPhone)
  })
})

describe('tire price from cost', () => {
  const s = { tireMarkupPercent: 30, tireMinProfit: 20 }
  test('markup, minimum profit and rounding up to .99', () => {
    assert.equal(tirePriceFromCost(s, 100), 130.99) // 130.00 rounds up, never down
    assert.equal(tirePriceFromCost(s, 45), 65.99) // 30% is only $13.50, so the $20 minimum wins
    assert.equal(tirePriceFromCost(s, 76), 98.99) // 98.80 rounds up to the next .99
    assert.equal(tirePriceFromCost({ tireMarkupPercent: 0, tireMinProfit: 0 }, 50.99), 50.99)
  })
})
