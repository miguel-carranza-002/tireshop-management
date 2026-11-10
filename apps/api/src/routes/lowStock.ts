import { Router } from 'express'
import { addRestockOrder, lockStock } from '../allocation.js'
import { pool, withTransaction, type Queryable } from '../db.js'
import { asBody, ConflictError, NotFoundError, optionalId, requiredNumber, ValidationError } from '../validation.js'

export const lowStockRouter = Router()

// Stocked new items whose available quantity (on hand − reserved) is below
// their minimum. Suggested order = minimum − available − restock already on order.
async function loadLowStock(db: Queryable) {
  const result = await db.query(`
    WITH restock AS (
      SELECT product_id, SUM(qty_ordered - qty_arrived)::int AS qty
      FROM pending_orders
      WHERE ticket_id IS NULL AND status IN ('needed', 'ordered')
      GROUP BY product_id
    ),
    stock AS (
      SELECT
        p.id,
        p.sku,
        p.brand,
        p.model,
        p.tire_size,
        p.product_type,
        p.cost,
        p.min_qty,
        COALESCE(s.on_hand_qty, 0) AS on_hand,
        COALESCE(s.reserved_qty, 0) AS reserved,
        COALESCE(s.on_hand_qty, 0) - COALESCE(s.reserved_qty, 0) AS available,
        COALESCE(r.qty, 0) AS on_order
      FROM products AS p
      LEFT JOIN inventory_stock AS s ON s.product_id = p.id
      LEFT JOIN restock AS r ON r.product_id = p.id
      WHERE p.stocked AND p.condition = 'new' AND p.min_qty > 0
    )
    SELECT
      id::text AS id,
      sku,
      brand,
      model,
      tire_size AS "tireSize",
      product_type AS "productType",
      cost::float8 AS cost,
      min_qty AS "minQty",
      on_hand AS "onHand",
      reserved,
      available,
      on_order AS "onOrder",
      GREATEST(min_qty - available - on_order, 0) AS "suggestedQty"
    FROM stock
    WHERE available < min_qty
    ORDER BY GREATEST(min_qty - available - on_order, 0) = 0, available - min_qty, brand, model, tire_size
  `)
  return result.rows
}

lowStockRouter.get('/', async (_req, res) => {
  res.json({ items: await loadLowStock(pool) })
})

// Add items to Pending Orders as shelf restock ("needs ordering").
// Body: { items: [{ productId, quantity }] }
lowStockRouter.post('/order', async (req, res) => {
  const body = asBody(req.body)
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new ValidationError('Pick at least one item to order')
  }
  const items = body.items.map((raw) => {
    const item = asBody(raw)
    const productId = optionalId(item, 'productId')
    if (!productId) throw new ValidationError('Each item needs a product')
    return { productId, qty: requiredNumber(item, 'quantity', 'Quantity', { min: 1, integer: true }) }
  })

  await withTransaction(async (client) => {
    for (const item of items) {
      const product = await client.query(
        `SELECT brand, model, tire_size AS "tireSize", cost::float8 AS cost FROM products WHERE id = $1`,
        [item.productId],
      )
      if (product.rowCount === 0) throw new NotFoundError('Product not found')
      const p = product.rows[0]
      // Lock the stock row so two clicks can't double-order.
      const stock = await lockStock(client, item.productId)
      if (!stock.stocked || stock.condition !== 'new') {
        throw new ConflictError('Only stocked new items are restocked to a minimum')
      }
      await addRestockOrder(client, {
        productId: item.productId,
        itemKind: stock.productType,
        description: `${[p.brand, p.model, p.tireSize].filter(Boolean).join(' ')} (restock)`,
        qty: item.qty,
        unitCost: p.cost,
      })
    }
  })

  res.json({ items: await loadLowStock(pool) })
})
