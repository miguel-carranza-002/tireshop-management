import { Count } from './Badge'
import { cx } from './cx'

type Tab<T extends string> = { id: T; label: string; count?: number; alert?: boolean }

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: Tab<T>[]
  value: T
  onChange: (id: T) => void
  label: string
}) {
  return (
    <div className="ui-tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          className={cx('ui-tab', value === t.id && 'ui-tab-active')}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.count !== undefined && <Count value={t.count} alert={t.alert} />}
        </button>
      ))}
    </div>
  )
}
