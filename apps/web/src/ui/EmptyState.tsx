import type { ReactNode } from 'react'

export function EmptyState({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="ui-empty">
      <p className="ui-empty-title">{title}</p>
      {children && <div className="ui-empty-body">{children}</div>}
    </div>
  )
}
