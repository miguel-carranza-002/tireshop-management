import type { DriveType, Vehicle, VehicleInput } from '../../api'

// Form values for a vehicle. Blank strings mean unknown.
export function toVehicleInput(v?: Vehicle): VehicleInput {
  return {
    year: v ? String(v.year) : '',
    make: v?.make ?? '',
    model: v?.model ?? '',
    trim: v?.trim ?? '',
    vehicleClass: v?.vehicleClass ?? 'car',
    driveType: v?.driveType ?? 'unknown',
    liftedLowered: v?.liftedLowered ?? false,
    multiLinkSuspension: v?.multiLinkSuspension ?? false,
    licensePlate: v?.licensePlate ?? '',
    vin: v?.vin ?? '',
    tireSize: v?.tireSize ?? '',
    rearTireSize: v?.rearTireSize ?? '',
    isEv: v?.isEv ?? false,
    heavyDuty: v?.heavyDuty ?? false,
    runFlat: v?.runFlat ?? false,
    requiredLoadIndex: v?.requiredLoadIndex != null ? String(v.requiredLoadIndex) : '',
    requiredLoadRange: v?.requiredLoadRange ?? '',
    requiredSpeedRating: v?.requiredSpeedRating ?? '',
  }
}

export const driveTypeLabels: Record<DriveType, string> = {
  unknown: 'Unknown (treated as AWD)',
  '2wd': '2WD (front or rear)',
  awd: 'AWD',
  '4wd': '4WD',
}

export const vehicleIsComplete = (v: VehicleInput) => /^\d{4}$/.test(v.year.trim()) && v.make.trim() !== '' && v.model.trim() !== ''
