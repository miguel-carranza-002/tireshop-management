// The Express app with every route. server.ts starts it; tests import it directly.

import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { requireAdmin, requireUser } from './auth.js'
import { pool } from './db.js'
import { authRouter } from './routes/auth.js'
import { usersRouter } from './routes/users.js'
import { billingRouter, invoicesRouter } from './routes/billing.js'
import { customersRouter } from './routes/customers.js'
import { lowStockRouter } from './routes/lowStock.js'
import { pdfRouter } from './routes/pdf.js'
import { productsRouter } from './routes/products.js'
import { callsRouter, ordersRouter } from './routes/orders.js'
import { settingsRouter } from './routes/settings.js'
import { shopRouter, workItemStatusRouter } from './routes/shop.js'
import { lineItemsRouter, ticketsRouter, workItemsRouter } from './routes/tickets.js'
import { vehiclesRouter } from './routes/vehicles.js'
import { comparisonRouter, optionPickRouter } from './routes/comparison.js'
import { tireLinesRouter } from './routes/tireLines.js'
import { vinRouter } from './routes/vin.js'
import { ConflictError, NotFoundError, ValidationError } from './validation.js'

const app = express()

// 2 MB: enough for a resized tread photo; everything else is far smaller.
app.use(express.json({ limit: '2mb' }))

// Check whether the API server is running.
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'tireshop-api',
  })
})

// Check whether the API can query PostgreSQL.
app.get('/api/health/db', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        current_database() AS database,
        current_user AS db_user
    `)

    res.json({
      status: 'ok',
      database: result.rows[0].database,
      dbUser: result.rows[0].db_user,
    })
  } catch (error) {
    console.error(
      'Database health check failed:',
      error instanceof Error ? error.message : 'Unknown error',
    )

    res.status(500).json({
      status: 'error',
      message: 'Database connection failed',
    })
  }
})


// Deny by default: this must stay the first /api handler after the health
// checks. Everything under /api needs a signed-in user except the few open
// paths requireUser lists itself (health, sign-in). test/auth.test.ts calls
// every /api area mounted here while signed out.
app.use('/api', requireUser)
app.use('/api/auth', authRouter)
app.use('/api/products', productsRouter)
app.use('/api/users', requireAdmin, usersRouter)
app.use('/api/customers', customersRouter)
app.use('/api/vehicles', vehiclesRouter)
app.use('/api/settings', settingsRouter)
app.use('/api/tickets', ticketsRouter)
app.use('/api/tickets', billingRouter)
app.use('/api/tickets', pdfRouter)
app.use('/api/invoices', invoicesRouter)
app.use('/api/work-items', workItemsRouter)
app.use('/api/work-items', workItemStatusRouter)
app.use('/api/shop', shopRouter)
app.use('/api/line-items', lineItemsRouter)
app.use('/api/orders', ordersRouter)
app.use('/api/calls', callsRouter)
app.use('/api/low-stock', lowStockRouter)
app.use('/api/vin', vinRouter)
app.use('/api/tire-lines', tireLinesRouter)
app.use('/api/tickets', comparisonRouter)
app.use('/api/work-items', optionPickRouter)

// The built web app (apps/web/dist), so one server can run the whole shop:
// cd apps/web && npm run build, then start the API. In development Vite
// serves the web app instead and this folder may not exist.
const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist')
if (existsSync(webDist)) {
  app.use(express.static(webDist))
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next()
    res.sendFile(path.join(webDist, 'index.html'))
  })
}

// Express 5 forwards rejected async handlers here.
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof ValidationError) {
    res.status(400).json({ error: error.message })
    return
  }

  if (error instanceof NotFoundError) {
    res.status(404).json({ error: error.message })
    return
  }

  if (error instanceof ConflictError) {
    res.status(409).json({ error: error.message })
    return
  }

  if (error instanceof SyntaxError) {
    res.status(400).json({ error: 'Invalid JSON body' })
    return
  }

  // Full error with stack trace, so a 500 can actually be tracked down.
  console.error('Request failed:', error)
  res.status(500).json({ error: 'Something went wrong' })
})

export default app
