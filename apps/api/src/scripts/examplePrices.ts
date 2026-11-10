// Example prices for the test and demo databases. A new database starts every
// price at 0 (each shop enters its own in Settings); tests and the demo need
// something to calculate with.
import type { Queryable } from '../db.js'

export const examplePrices = {
  products_tax_rate: 0.08,
  shop_rate_per_hour: 95,
  alignment_car_price: 80,
  alignment_truck_price: 100,
  alignment_surcharge: 20,
  mount_balance_car_price: 20,
  mount_balance_truck_price: 30,
  mount_balance_surcharge: 10,
  disposal_fee: 5,
  valve_stem_customer_supplied_price: 5,
  trailer_valve_stem_price: 10,
  tpms_sensor_single_price: 70,
  tpms_sensor_multi_price: 60,
  tpms_reset_price: 50,
  used_tire_car_price: 45,
  used_tire_truck_price: 60,
  min_deposit: 100,
  tire_markup_percent: 30,
  tire_min_profit: 20,
}

export async function applyExamplePrices(db: Queryable) {
  const columns = Object.keys(examplePrices)
  const assignments = columns.map((c, i) => `${c} = $${i + 1}`).join(', ')
  await db.query(`UPDATE settings SET ${assignments}, updated_at = NOW()`, Object.values(examplePrices))
}
