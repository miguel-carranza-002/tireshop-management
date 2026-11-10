import app from './app.js'
import { pool } from './db.js'

const port = Number(process.env.PORT ?? 3000)

// By default only this computer can reach the API. Set HOST=0.0.0.0 to open
// it to the shop network (create the admin login first; see docs/workflow.md).
const host = process.env.HOST ?? '127.0.0.1'
const server = app.listen(port, host, () => {
  console.log(`Tire shop API listening on http://${host}:${port}`)
})

// Close database connections cleanly when stopping the server.
function shutdown() {
  server.close(() => {
    void pool.end().finally(() => process.exit(0))
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
