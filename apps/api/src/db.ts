import 'dotenv/config'
import { Pool, type PoolClient } from 'pg'
import { currentUser } from './context.js'

const requiredEnv = [
  'DB_HOST',
  'DB_PORT',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
] as const

for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
}

const dbPort = Number(process.env.DB_PORT)

if (!Number.isInteger(dbPort) || dbPort < 1 || dbPort > 65535) {
  throw new Error('DB_PORT must be a valid port number')
}

export const pool = new Pool({
  host: process.env.DB_HOST,
  port: dbPort,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
})

// Either the shared pool or a client inside a transaction.
export type Queryable = Pool | PoolClient

// Run several queries as one unit: all of them apply, or none do.
export async function withTransaction<T>(
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  // A connection whose ROLLBACK failed is in an unknown state: destroy it
  // instead of handing it back to the pool.
  let broken: Error | undefined
  try {
    await client.query('BEGIN')
    // Rows written in this transaction record who did it (created_by etc.
    // default to this setting; see migration 013).
    const user = currentUser()
    if (user) await client.query(`SELECT set_config('app.user_id', $1, true)`, [user.id])
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch (rollbackError) {
      broken = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError))
      console.error('ROLLBACK failed; discarding the connection:', broken)
    }
    // Always report the original error, not the rollback failure.
    throw error
  } finally {
    client.release(broken)
  }
}
