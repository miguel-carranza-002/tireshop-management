import type { ReactNode } from 'react'
import { cx } from './cx'

type Props = {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  // No inner padding, for tables and lists that run edge to edge.
  flush?: boolean
  className?: string
  children?: ReactNode
}

export function Panel({ title, description, actions, flush, className, children }: Props) {
  return (
    <section className={cx('ui-panel', className)}>
      {(title || actions) && (
        <header className="ui-panel-header">
          <div>
            {title && <h2 className="ui-panel-title">{title}</h2>}
            {description && <p className="ui-panel-description">{description}</p>}
          </div>
          {actions && <div className="ui-panel-actions">{actions}</div>}
        </header>
      )}
      <div className={flush ? 'ui-panel-body-flush' : 'ui-panel-body'}>{children}</div>
    </section>
  )
}
