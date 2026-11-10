import type { ReactNode } from 'react'
import { cx } from './cx'

// A message in the page: errors, warnings, confirmations.
export function Alert({ tone = 'info', children }: { tone?: 'info' | 'success' | 'warning' | 'danger'; children: ReactNode }) {
  return (
    <div className={cx('ui-alert', `ui-alert-${tone}`)} role={tone === 'danger' ? 'alert' : 'status'}>
      {children}
    </div>
  )
}
