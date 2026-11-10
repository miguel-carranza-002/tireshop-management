import { Router } from 'express'
import { pool } from '../db.js'
import { idParam } from '../validation.js'
import { readVehicle, vehicleColumns, vehicleFieldColumns } from './customers.js'

export const vehiclesRouter = Router()

vehiclesRouter.put('/:id', async (req, res) => {
  const id = idParam(req.params.id)
  const v = readVehicle(req.body)

  const keys = Object.keys(vehicleFieldColumns) as (keyof typeof v)[]
  const result = await pool.query(
    `
      UPDATE vehicles AS v
      SET ${keys.map((k, i) => `${vehicleFieldColumns[k]} = $${i + 2}`).join(', ')}, updated_at = NOW()
      WHERE v.id = $1
      RETURNING ${vehicleColumns}
    `,
    [id, ...keys.map((k) => v[k])],
  )

  if (result.rowCount === 0) {
    res.status(404).json({ error: 'Vehicle not found' })
    return
  }

  res.json({ vehicle: result.rows[0] })
})
