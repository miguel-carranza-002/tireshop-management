import type { ReactNode, TableHTMLAttributes } from 'react'
import { cx } from './cx'

// Dense data table. Wraps in a horizontal scroller on narrow screens.
export function Table({ className, children, ...rest }: TableHTMLAttributes<HTMLTableElement> & { children: ReactNode }) {
  return (
    <div className="ui-table-wrap">
      <table className={cx('ui-table', className)} {...rest}>
        {children}
      </table>
    </div>
  )
}
