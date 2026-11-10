import type { ReactNode } from 'react'
import { cx } from './cx'

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'internal'

// Small status label. Color only when it means something.
export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={cx('ui-badge', `ui-badge-${tone}`)} title={title}>
      {children}
    </span>
  )
}

// Count bubble for navigation and tabs.
export function Count({ value, alert }: { value: number; alert?: boolean }) {
  if (value <= 0) return null
  return <span className={cx('ui-count', alert && 'ui-count-alert')}>{value}</span>
}
