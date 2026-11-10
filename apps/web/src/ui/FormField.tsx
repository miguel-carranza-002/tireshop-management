import type { ReactNode } from 'react'
import { cx } from './cx'

// Label above a control, with an optional hint or error underneath.
export function FormField({
  label,
  required,
  hint,
  error,
  wide,
  children,
}: {
  label: ReactNode
  required?: boolean
  hint?: ReactNode
  error?: ReactNode
  wide?: boolean
  children: ReactNode
}) {
  return (
    <label className={cx('ui-field', wide && 'ui-field-wide')}>
      <span className="ui-field-label">
        {label}
        {required && <span className="ui-required" aria-hidden="true"> *</span>}
      </span>
      {children}
      {error ? <span className="ui-field-error">{error}</span> : hint && <span className="ui-field-hint">{hint}</span>}
    </label>
  )
}
