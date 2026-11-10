import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { api, formatMoney, tirePriceFromCost, type CurrentUser, type ShopSettings } from '../../api'
import { Alert, Button, FormField, InputAffix, PageHeader, Panel } from '../../ui'
import UsersPanel from './UsersPanel'
import './SettingsPage.css'

type Key = keyof ShopSettings

// How each setting is shown and typed. Tax is stored as a fraction but typed
// as a percent.
type Field = {
  key: Key
  label: string
  kind: 'text' | 'textarea' | 'money' | 'taxPercent' | 'percent' | 'number' | 'minutes'
  hint?: string
  required?: boolean
}

type Section = { title: string; description: string; columns: 2 | 3; fields: Field[] }

const sections: Section[] = [
  {
    title: 'Shop details',
    description: 'Printed at the top of quotes, work orders and invoices.',
    columns: 2,
    fields: [
      { key: 'shopName', label: 'Shop name', kind: 'text', required: true },
      { key: 'shopPhone', label: 'Phone', kind: 'text' },
      { key: 'shopAddress', label: 'Address', kind: 'textarea', hint: 'One line per row, as it should print.' },
      { key: 'invoiceFooter', label: 'Invoice footer', kind: 'textarea', hint: 'e.g. Thank you for your business!' },
    ],
  },
  {
    title: 'Tax, labor and quotes',
    description: 'Tax applies to products only (tires, sensors, parts, rims). Services and labor are not taxed.',
    columns: 3,
    fields: [
      { key: 'productsTaxRate', label: 'Tax on products', kind: 'taxPercent' },
      { key: 'shopRatePerHour', label: 'Shop rate per hour', kind: 'money' },
      { key: 'quoteValidDays', label: 'Quotes are valid for', kind: 'number', hint: 'Days. Accepting after that shows a warning.' },
      { key: 'minDeposit', label: 'Minimum deposit', kind: 'money', hint: 'For tires we don’t stock, and rims.' },
    ],
  },
  {
    title: 'Tire pricing',
    description: 'How a tire’s price is worked out from its cost when you price a tire you buy in for a quote.',
    columns: 3,
    fields: [
      { key: 'tireMarkupPercent', label: 'Markup on cost', kind: 'percent' },
      { key: 'tireMinProfit', label: 'Minimum profit per tire', kind: 'money' },
      { key: 'usedTireCarPrice', label: 'Used tire, car', kind: 'money', hint: 'Default per tire; change it on the line for condition.' },
      { key: 'usedTireTruckPrice', label: 'Used tire, truck', kind: 'money' },
    ],
  },
  {
    title: 'Tire services',
    description: 'Added automatically to a Tires item.',
    columns: 3,
    fields: [
      { key: 'mountBalanceCarPrice', label: 'Mount & balance, car', kind: 'money', hint: 'Per tire' },
      { key: 'mountBalanceTruckPrice', label: 'Mount & balance, truck', kind: 'money', hint: 'Per tire' },
      { key: 'mountBalanceSurcharge', label: 'Low-profile / oversized surcharge', kind: 'money', hint: 'Per tire' },
      { key: 'disposalFee', label: 'Disposal fee', kind: 'money', hint: 'Per old tire removed' },
      { key: 'valveStemCustomerSuppliedPrice', label: 'Valve stem, customer’s tires', kind: 'money', hint: 'Free when they buy tires here' },
      { key: 'trailerValveStemPrice', label: 'Trailer valve stem', kind: 'money' },
    ],
  },
  {
    title: 'TPMS',
    description: 'The 2-or-more price applies when the car gets two or more sensors in total.',
    columns: 3,
    fields: [
      { key: 'tpmsSensorSinglePrice', label: 'Sensor, one', kind: 'money' },
      { key: 'tpmsSensorMultiPrice', label: 'Sensor, 2 or more (each)', kind: 'money' },
      { key: 'tpmsResetPrice', label: 'Reset with customer’s sensors', kind: 'money' },
    ],
  },
  {
    title: 'Alignment',
    description: 'Priced by the vehicle. The surcharge applies once for lifted/lowered or multi-link suspension.',
    columns: 3,
    fields: [
      { key: 'alignmentCarPrice', label: 'Car', kind: 'money' },
      { key: 'alignmentTruckPrice', label: 'Truck', kind: 'money' },
      { key: 'alignmentSurcharge', label: 'Surcharge', kind: 'money' },
    ],
  },
  {
    title: 'Tire size rules',
    description: 'When a tire counts as low-profile or oversized (for the mount & balance surcharge and extra shop time).',
    columns: 3,
    fields: [
      { key: 'lowProfileMaxAspect', label: 'Low-profile at aspect ratio of', kind: 'number', hint: 'or lower' },
      { key: 'oversizedMinDiameterIn', label: 'Oversized at overall diameter of', kind: 'number', hint: 'inches or more' },
    ],
  },
  {
    title: 'Shop floor times',
    description: 'Used for wait estimates. They are meant to lean long.',
    columns: 3,
    fields: [
      { key: 'tireJobCarMinutes', label: 'Car tire job', kind: 'minutes', hint: '4 tires, one tech' },
      { key: 'tireJobTruckMinutes', label: 'Truck tire job', kind: 'minutes', hint: '4 tires, one tech' },
      { key: 'tireJobMinMinutes', label: 'Shortest tire job', kind: 'minutes' },
      { key: 'alignmentMinutes', label: 'Alignment', kind: 'minutes' },
    ],
  },
]

const allFields = sections.flatMap((s) => s.fields)
type Draft = Record<Key, string>

function toDraft(s: ShopSettings): Draft {
  const draft = {} as Draft
  for (const f of allFields) {
    const value = s[f.key]
    draft[f.key] =
      value === null || value === undefined
        ? ''
        : f.kind === 'taxPercent'
          ? String(Math.round((value as number) * 100 * 1000) / 1000)
          : String(value)
  }
  return draft
}

function toValue(f: Field, text: string): string | number | null {
  if (f.kind === 'text' || f.kind === 'textarea') return text.trim() === '' ? null : text
  if (f.kind === 'taxPercent') return Math.round(Number(text) * 1000) / 100000
  return Number(text)
}

function SettingsPage({ user }: { user: CurrentUser }) {
  const isAdmin = user.role === 'admin'
  const [saved, setSaved] = useState<ShopSettings | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    api
      .getSettings(controller.signal)
      .then(({ settings }) => {
        setSaved(settings)
        setDraft(toDraft(settings))
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not load settings')
      })
    return () => controller.abort()
  }, [])

  const original = useMemo(() => (saved ? toDraft(saved) : null), [saved])
  const changed = useMemo(
    () => (draft && original ? allFields.filter((f) => draft[f.key] !== original[f.key]) : []),
    [draft, original],
  )

  function set(key: Key, value: string) {
    setNotice(null)
    setDraft((d) => (d ? { ...d, [key]: value } : d))
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!draft || changed.length === 0) return
    setSaving(true)
    setError(null)
    try {
      const changes = Object.fromEntries(changed.map((f) => [f.key, toValue(f, draft[f.key])]))
      const { settings } = await api.saveSettings(changes)
      setSaved(settings)
      setDraft(toDraft(settings))
      setNotice(
        `Saved ${changed.length} change${changed.length === 1 ? '' : 's'}. New quotes and new lines use them; existing tickets keep their prices.`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save settings')
    } finally {
      setSaving(false)
    }
  }

  if (!draft) {
    return error ? <Alert tone="danger">{error}</Alert> : <p className="settings-loading">Loading settings…</p>
  }

  const markup = { tireMarkupPercent: Number(draft.tireMarkupPercent) || 0, tireMinProfit: Number(draft.tireMinProfit) || 0 }

  function input(f: Field) {
    const common = {
      value: draft![f.key],
      onChange: (e: { target: { value: string } }) => set(f.key, e.target.value),
      required: f.required,
    }
    switch (f.kind) {
      case 'text':
        return <input {...common} />
      case 'textarea':
        return <textarea rows={3} {...common} />
      case 'money':
        return <InputAffix prefix="$" inputMode="decimal" {...common} />
      case 'taxPercent':
      case 'percent':
        return <InputAffix suffix="%" inputMode="decimal" {...common} />
      case 'minutes':
        return <InputAffix suffix="min" inputMode="numeric" {...common} />
      default:
        return <input inputMode="decimal" {...common} />
    }
  }

  return (
    <div className="settings-page">
      <PageHeader
        title="Settings"
        subtitle="Prices and rules for new quotes. Existing tickets keep the prices they were given."
        actions={
          isAdmin && (
          <>
            {changed.length > 0 && (
              <span className="settings-unsaved">
                {changed.length} unsaved change{changed.length === 1 ? '' : 's'}
              </span>
            )}
            <Button variant="ghost" disabled={changed.length === 0 || saving} onClick={() => saved && setDraft(toDraft(saved))}>
              Discard
            </Button>
            <Button type="submit" form="settings-form" variant="primary" disabled={changed.length === 0 || saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </>
          )
        }
      />

      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      {!isAdmin && <Alert tone="info">Only an admin can change settings.</Alert>}

      {isAdmin && <UsersPanel currentUserId={user.id} />}

      {/* The Logins panel has its own dialogs and forms, so it stays outside this one. */}
      <form id="settings-form" onSubmit={save}>
      <fieldset className="settings-fields" disabled={!isAdmin}>

      {sections.map((section) => (
        <Panel key={section.title} title={section.title} description={section.description}>
          <div className={section.columns === 3 ? 'settings-grid settings-grid-3' : 'settings-grid'}>
            {section.fields.map((f) => (
              <FormField
                key={f.key}
                label={
                  <>
                    {f.label}
                    {original && draft[f.key] !== original[f.key] && <span className="settings-dot" title="Changed" />}
                  </>
                }
                required={f.required}
                hint={f.hint}
              >
                {input(f)}
              </FormField>
            ))}
          </div>
          {section.title === 'Tire pricing' && (
            <p className="settings-example">
              Example: a tire that costs $100 sells for {formatMoney(tirePriceFromCost(markup, 100))}; one that
              costs $45 sells for {formatMoney(tirePriceFromCost(markup, 45))}. Prices round up to the next .99.
            </p>
          )}
        </Panel>
      ))}
      </fieldset>
      </form>
    </div>
  )
}

export default SettingsPage
