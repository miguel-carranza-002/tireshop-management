import { pageLabels, type Page } from '../../router'
import { Count, cx } from '../../ui'
import PageIcon from './PageIcon'

// Grouped the way the day runs: the floor and tickets first, then buying, then money.
const groups: { label: string; pages: Page[] }[] = [
  { label: 'Work', pages: ['shop', 'quotes', 'customers'] },
  { label: 'Parts & stock', pages: ['orders', 'inventory', 'lowStock'] },
  { label: 'Money', pages: ['accounts'] },
  { label: 'Shop', pages: ['settings'] },
]

type Props = {
  page: Page
  counts: Partial<Record<Page, number>>
  open: boolean
  onNavigate: (page: Page) => void
}

function Sidebar({ page, counts, open, onNavigate }: Props) {
  return (
    <nav className={cx('sidebar', open && 'sidebar-open')} aria-label="Main">
      <div className="sidebar-brand">
        <span className="sidebar-logo" aria-hidden="true">
          TS
        </span>
        <span className="sidebar-name">Tire Shop</span>
      </div>
      {groups.map((g) => (
        <div key={g.label} className="sidebar-group">
          <p className="sidebar-group-label">{g.label}</p>
          {g.pages.map((p) => (
            <button
              key={p}
              type="button"
              className={cx('sidebar-link', p === page && 'sidebar-link-active')}
              aria-current={p === page ? 'page' : undefined}
              onClick={() => onNavigate(p)}
            >
              <PageIcon page={p} />
              <span className="sidebar-link-label">{pageLabels[p]}</span>
              <Count value={counts[p] ?? 0} alert />
            </button>
          ))}
        </div>
      ))}
    </nav>
  )
}

export default Sidebar
