// Small helpers for reading request bodies without a schema library.

export class ValidationError extends Error {}
export class NotFoundError extends Error {}
// The request is valid but the record's state doesn't allow it,
// e.g. editing a quote that has already been accepted.
export class ConflictError extends Error {}

export type Body = Record<string, unknown>

export function requiredNumber(
  body: Body,
  key: string,
  label: string,
  {
    min = 0,
    max = Infinity,
    integer = false,
    money = false,
  }: { min?: number; max?: number; integer?: boolean; money?: boolean } = {},
): number {
  const value = Number(body[key])
  if (
    body[key] === undefined ||
    body[key] === null ||
    body[key] === '' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  ) {
    throw new ValidationError(
      `${label} must be ${integer ? 'a whole number' : 'a number'} ` +
        (max === Infinity ? `of at least ${min}` : `from ${min} to ${max}`),
    )
  }
  // Dollars and cents only: 10.005 would be compared as one amount here and
  // stored as another by Postgres.
  if (money && Math.abs(value * 100 - Math.round(value * 100)) > 1e-6) {
    throw new ValidationError(`${label} can't have more than 2 decimal places`)
  }
  return value
}

export function optionalNumber(
  body: Body,
  key: string,
  label: string,
  options?: { min?: number; max?: number; integer?: boolean; money?: boolean },
): number | null {
  const value = body[key]
  if (value === undefined || value === null || value === '') return null
  return requiredNumber(body, key, label, options)
}

// A calendar date as YYYY-MM-DD, or null.
export function optionalDate(body: Body, key: string, label: string): string | null {
  const value = body[key]
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ValidationError(`${label} must be a date`)
  }
  return value
}

export function optionalId(body: Body, key: string): string | null {
  const value = body[key]
  if (value === undefined || value === null || value === '') return null
  const text = String(value)
  if (!/^\d+$/.test(text)) throw new ValidationError(`${key} must be an id`)
  return text
}

export function asBody(value: unknown): Body {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError('Request body must be a JSON object')
  }
  return value as Body
}

export function requiredText(body: Body, key: string, label: string): string {
  const value = body[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${label} is required`)
  }
  return value.trim()
}

// Empty strings become NULL so optional columns stay clean.
export function optionalText(body: Body, key: string): string | null {
  const value = body[key]
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') {
    throw new ValidationError(`${key} must be text`)
  }
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export function optionalBoolean(body: Body, key: string, fallback: boolean): boolean {
  const value = body[key]
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'boolean') {
    throw new ValidationError(`${key} must be true or false`)
  }
  return value
}

export function requiredYear(body: Body): number {
  const value = Number(body.year)
  if (!Number.isInteger(value) || value < 1900 || value > 2100) {
    throw new ValidationError('Year must be a 4-digit year')
  }
  return value
}

export function vehicleClass(body: Body): 'car' | 'truck' {
  const value = body.vehicleClass ?? 'car'
  if (value !== 'car' && value !== 'truck') {
    throw new ValidationError('Vehicle class must be car or truck')
  }
  return value
}

// Store phone numbers as digits only so searching and duplicate checks
// ignore formatting like "(555) 123-4567".
export function normalizePhone(value: string | null): string | null {
  if (value === null) return null
  const digits = value.replace(/\D/g, '')
  return digits === '' ? null : digits
}

export function idParam(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new ValidationError('Invalid id')
  }
  return value
}
