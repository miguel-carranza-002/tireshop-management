import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { driveTypeFrom, heavyDutyFrom, suggestionFromVpic } from '../src/routes/vin.js'
import { api, customerWithVehicle, ok, refused, useTestApp } from './helpers.js'

useTestApp()

describe('vehicle tire needs', () => {
  test('new fields save, come back, and default to unknown', async () => {
    const { customerId } = await customerWithVehicle()
    const saved = await ok(
      api.post(`/customers/${customerId}/vehicles`, {
        year: 2021,
        make: 'Ford',
        model: 'F-250',
        trim: 'XLT',
        vehicleClass: 'truck',
        driveType: '4wd',
        tireSize: 'lt275/70r18',
        rearTireSize: '',
        heavyDuty: true,
        requiredLoadRange: 'e',
        requiredLoadIndex: 125,
        requiredSpeedRating: 's',
      }),
    )
    const v = saved.vehicle
    assert.equal(v.trim, 'XLT')
    assert.equal(v.driveType, '4wd')
    assert.equal(v.tireSize, 'LT275/70R18')
    assert.equal(v.rearTireSize, null, 'blank stays unknown')
    assert.equal(v.heavyDuty, true)
    assert.equal(v.isEv, false)
    assert.equal(v.requiredLoadRange, 'E')
    assert.equal(v.requiredSpeedRating, 'S')

    const updated = await ok(api.put(`/vehicles/${v.id}`, { year: 2021, make: 'Ford', model: 'F-250', vehicleClass: 'truck' }))
    assert.equal(updated.vehicle.driveType, 'unknown', 'not given = unknown, never guessed')
    assert.equal(updated.vehicle.heavyDuty, false)
  })

  test('bad values are refused', async () => {
    const { customerId } = await customerWithVehicle()
    const base = { year: 2020, make: 'Honda', model: 'Civic' }
    assert.match(await refused(api.post(`/customers/${customerId}/vehicles`, { ...base, driveType: 'fwd' }), 400), /Drive type/)
    assert.match(await refused(api.post(`/customers/${customerId}/vehicles`, { ...base, requiredLoadRange: 'Z' }), 400), /Load range/)
    assert.match(await refused(api.post(`/customers/${customerId}/vehicles`, { ...base, requiredSpeedRating: 'HH' }), 400), /Speed rating/)
  })
})

describe('VIN decoding (vPIC response mapping, no network)', () => {
  test('an F-250 comes back as a 4WD heavy-duty truck', () => {
    const s = suggestionFromVpic({
      ModelYear: '2022',
      Make: 'FORD',
      Model: 'F-250',
      Trim: '',
      Series: 'F-Series Super Duty - Single Rear Wheel',
      DriveType: '4WD/4-Wheel Drive/4x4',
      FuelTypePrimary: 'Diesel',
      GVWR: 'Class 2H: 9,001 - 10,000 lb (4,082 - 4,536 kg)',
      VehicleType: 'TRUCK',
      ErrorCode: '0',
      ErrorText: '0 - VIN decoded clean.',
    })
    assert.deepEqual(
      { year: s.year, make: s.make, model: s.model, trim: s.trim, cls: s.vehicleClass, drive: s.driveType, hd: s.heavyDuty, ev: s.isEv, warning: s.warning },
      { year: 2022, make: 'Ford', model: 'F-250', trim: null, cls: 'truck', drive: '4wd', hd: true, ev: false, warning: null },
    )
  })

  test('a Tesla is an EV; missing values stay unknown', () => {
    const s = suggestionFromVpic({
      ModelYear: '2018',
      Make: 'TESLA',
      Model: 'Model 3',
      DriveType: '',
      FuelTypePrimary: 'Electric',
      GVWR: 'Class 1C: 4,001 - 5,000 lb',
      VehicleType: 'PASSENGER CAR',
      ErrorCode: '1',
      ErrorText: '1 - Check Digit (9th position) does not calculate properly',
    })
    assert.equal(s.isEv, true)
    assert.equal(s.driveType, null)
    assert.equal(s.heavyDuty, false)
    assert.equal(s.vehicleClass, 'car')
    assert.match(s.warning ?? '', /Check Digit/)
  })

  test('drive type and weight class rules', () => {
    assert.equal(driveTypeFrom('AWD/All-Wheel Drive'), 'awd')
    assert.equal(driveTypeFrom('4x2'), '2wd')
    assert.equal(driveTypeFrom('FWD/Front-Wheel Drive'), '2wd')
    assert.equal(driveTypeFrom('6x6'), null)
    assert.equal(heavyDutyFrom('Class 2G: 8,001 - 9,000 lb'), false)
    assert.equal(heavyDutyFrom('Class 2H: 9,001 - 10,000 lb'), true)
    assert.equal(heavyDutyFrom('Class 3: 10,001 - 14,000 lb'), true)
    assert.equal(heavyDutyFrom(null), false)
  })
})
