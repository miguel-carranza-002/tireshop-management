import type { ReactNode } from 'react'
import { cx } from './cx'

// A row of controls: filters on the left, actions pushed right with <Toolbar.Spacer />.
export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('ui-toolbar', className)}>{children}</div>
}

export function ToolbarSpacer() {
  return <span className="ui-toolbar-spacer" />
}
