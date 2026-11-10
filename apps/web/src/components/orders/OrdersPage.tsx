import { useEffect, useState } from 'react'
import {
  api,
  customerName,
  formatDate,
  formatDateTime,
  formatMoney,
  formatPhone,
  type CallTicket,
  type OrderCounts,
  type OrderRow,
  type OrderView,
} from '../../api'
import { Alert, Badge, Button, EmptyState, PageHeader, Panel, Table, Tabs, useDialogs, type Tone } from '../../ui'
import { OrderDetailsDialog, ReceiveDialog, ReturnDialog } from './OrderDialogs'
import './OrdersPage.css'

type Props = {
  onOpenTicket: (id: string) => void
}

type View = OrderView | 'calls'

const kindLabels: Record<OrderRow['itemKind'], string> = {
  tire: 'Tire',
  tpms_sensor: 'TPMS sensor',
  rim: 'Rim',
  part: 'Part',
  other: 'Other',
}

const statusBadge: Record<OrderRow['status'], { label: string; tone: Tone }> = {
  needed: { label: 'Needs ordering', tone: 'warning' },
  ordered: { label: 'Ordered', tone: 'accent' },
  arrived: { label: 'Arrived', tone: 'success' },
  installed: { label: 'Installed', tone: 'neutral' },
  returned: { label: 'Returned', tone: 'neutral' },
  unclaimed: { label: 'Unclaimed', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

type Open =
  | { kind: 'receive'; order: OrderRow }
  | { kind: 'edit'; order: OrderRow }
  | { kind: 'return'; order: OrderRow }
  | { kind: 'mark' }
  | null

function ForCell({ order, onOpenTicket }: { order: OrderRow; onOpenTicket: (id: string) => void }) {
  if (!order.ticketId) return <span className="od-muted">Shelf restock</span>
  return (
    <>
      <button type="button" className="od-link" onClick={() => onOpenTicket(order.ticketId!)}>
        WO-{order.ticketNumber}
      </button>{' '}
      {customerName({ firstName: order.firstName ?? '', lastName: order.lastName })}
      <div className="od-muted">
        {order.year} {order.make} {order.model}
      </div>
    </>
  )
}

function OrdersPage({ onOpenTicket }: Props) {
  const [view, setView] = useState<View>('needed')
  const [orders, setOrders] = useState<OrderRow[] | null>(null)
  const [counts, setCounts] = useState<OrderCounts | null>(null)
  const [calls, setCalls] = useState<CallTicket[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<Open>(null)
  const dialogs = useDialogs()

  useEffect(() => {
    const controller = new AbortController()
    // Counts come with every orders call; the calls tab needs both.
    const ordersView: OrderView = view === 'calls' ? 'arrived' : view
    Promise.all([api.listOrders(ordersView, controller.signal), api.callList(controller.signal)])
      .then(([data, callData]) => {
        setCounts(data.counts)
        setOrders(data.orders)
        setCalls(callData.tickets)
        setError(null)
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not load orders')
      })
    return () => controller.abort()
  }, [view, refreshKey])

  async function act(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      setRefreshKey((k) => k + 1)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      return false
    } finally {
      setBusy(false)
    }
  }

  // Close the dialog only when the action worked; errors show on the page.
  async function finish(action: () => Promise<unknown>) {
    if (await act(action)) setOpen(null)
  }

  async function cancel(o: OrderRow) {
    const ok = await dialogs.confirm({
      title: `Cancel the order for ${o.description}?`,
      message: o.ticketId
        ? 'If the job is still to be done, it’s refilled from the shelf or put back under Needs ordering. If the customer no longer wants it, mark the job not performed on the work order instead.'
        : 'This shelf restock order is cancelled.',
      confirmLabel: 'Cancel order',
      danger: true,
    })
    if (!ok) return
    void act(async () => {
      const { outcome } = await api.cancelOrder(o.id)
      const what: Record<string, string> = {
        reserved: 'Cancelled. The job took what it needs from the shelf instead.',
        ordered: 'Cancelled. The job still needs it, so it’s back under Needs ordering.',
        reserved_and_ordered: 'Cancelled. Some came from the shelf; the rest is back under Needs ordering.',
      }
      setNotice(what[outcome] ?? `Cancelled ${o.description}.`)
    })
  }

  async function unclaimed(o: OrderRow) {
    const ok = await dialogs.confirm({
      title: `Mark ${o.description} unclaimed?`,
      message: 'The customer backed out and it can’t go back. It leaves stock, never becomes shelf stock, and the deposit is kept.',
      confirmLabel: 'Mark unclaimed',
      danger: true,
    })
    if (ok) void act(() => api.markUnclaimed(o.id))
  }

  async function logCall(c: CallTicket) {
    const note = await dialogs.prompt({ title: `Call ${customerName(c)}`, label: 'What happened on the call?', initial: 'Left voicemail', confirmLabel: 'Log call', multiline: true })
    if (note !== null) void act(() => api.logCall(c.ticketId, note))
  }

  async function notified(c: CallTicket) {
    const note = await dialogs.prompt({
      title: `${customerName(c)} knows their order is in`,
      label: 'Note',
      initial: 'Customer notified',
      placeholder: 'e.g. coming Thursday 9am',
      confirmLabel: 'Customer notified',
      multiline: true,
    })
    if (note !== null) void act(() => api.customerNotified(c.ticketId, note))
  }

  const list = orders ?? []
  const vendors = [...new Set(list.map((o) => o.vendor).filter(Boolean) as string[])]
  const readyToCall = calls.filter((c) => c.allIn).length
  const tabs: { id: View; label: string; count?: number; alert?: boolean }[] = [
    { id: 'needed', label: 'Needs ordering', count: counts?.needed },
    { id: 'ordered', label: 'On order', count: counts?.ordered },
    { id: 'calls', label: 'Call customers', count: readyToCall, alert: readyToCall > 0 },
    { id: 'arrived', label: 'Arrived', count: counts?.arrived },
    { id: 'closed', label: 'Closed' },
  ]

  return (
    <div className="od" aria-busy={busy}>
      <PageHeader title="Orders" subtitle="Special orders, mechanic parts and shelf restock, from ordering to arrival." />
      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <Panel flush>
        <Tabs
          label="Order status"
          tabs={tabs}
          value={view}
          onChange={(v) => {
            setSelected(new Set())
            setNotice(null)
            setOrders(null)
            setView(v)
          }}
        />

        {view === 'needed' && list.length > 0 && (
          <div className="od-bar">
            <span className="od-muted">{selected.size} selected</span>
            <Button size="sm" variant="primary" disabled={selected.size === 0 || busy} onClick={() => setOpen({ kind: 'mark' })}>
              Mark ordered…
            </Button>
          </div>
        )}

        {view === 'calls' ? (
          calls.length === 0 ? (
            <EmptyState title="Nobody to call.">Arrived tires, rims and alignment parts show up here.</EmptyState>
          ) : (
            <ul className="od-calls">
              {calls.map((c) => (
                <li key={c.ticketId} className={c.allIn ? 'od-call od-call-ready' : 'od-call'}>
                  <div className="od-call-head">
                    <div>
                      <strong className="od-call-name">{customerName(c)}</strong>
                      {c.phone && (
                        <a className="od-phone" href={`tel:${c.phone}`}>
                          {formatPhone(c.phone)}
                        </a>
                      )}
                      <div className="od-muted">
                        <button type="button" className="od-link" onClick={() => onOpenTicket(c.ticketId)}>
                          WO-{c.ticketNumber}
                        </button>{' '}
                        · {c.year} {c.make} {c.model}
                      </div>
                    </div>
                    <Badge tone={c.allIn ? 'success' : 'warning'}>{c.allIn ? 'Everything is in · call now' : 'Partly in'}</Badge>
                  </div>
                  <ul className="od-call-items">
                    {c.items.map((i) => (
                      <li key={i.id}>
                        {i.qtyArrived}/{i.qtyOrdered} × {i.description}{' '}
                        <Badge tone={statusBadge[i.status].tone}>{statusBadge[i.status].label}</Badge>
                      </li>
                    ))}
                  </ul>
                  {c.calls.length > 0 && (
                    <ul className="od-call-log">
                      {c.calls.map((call) => (
                        <li key={call.id}>
                          <span className="od-muted">{formatDateTime(call.calledAt)}</span> {call.note ?? 'Called'}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="od-call-actions">
                    <Button size="sm" disabled={busy} onClick={() => void logCall(c)}>
                      Log call attempt
                    </Button>
                    <Button size="sm" variant="primary" disabled={busy} onClick={() => void notified(c)}>
                      Customer notified
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : orders === null ? (
          <EmptyState title="Loading…" />
        ) : list.length === 0 ? (
          <EmptyState title="Nothing here." />
        ) : (
          <Table>
            <thead>
              <tr>
                {view === 'needed' && (
                  <th scope="col" className="od-check">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={selected.size === list.length}
                      onChange={(e) => setSelected(e.target.checked ? new Set(list.map((o) => o.id)) : new Set())}
                    />
                  </th>
                )}
                <th scope="col">Item</th>
                <th scope="col" className="num">
                  Qty
                </th>
                <th scope="col">For</th>
                {view === 'needed' && <th scope="col">Waiting since</th>}
                {view !== 'needed' && <th scope="col">Vendor</th>}
                {view === 'ordered' && <th scope="col">Expected</th>}
                {view === 'arrived' && <th scope="col">Arrived</th>}
                {view === 'closed' && <th scope="col">Status</th>}
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((o) => (
                <tr key={o.id}>
                  {view === 'needed' && (
                    <td className="od-check">
                      <input
                        type="checkbox"
                        checked={selected.has(o.id)}
                        onChange={() =>
                          setSelected((cur) => {
                            const next = new Set(cur)
                            if (!next.delete(o.id)) next.add(o.id)
                            return next
                          })
                        }
                        aria-label={`Select ${o.description}`}
                      />
                    </td>
                  )}
                  <td>
                    <strong className="od-item">{o.description}</strong>
                    <span className="od-tags">
                      <Badge>{kindLabels[o.itemKind]}</Badge>
                      {!o.returnable && <Badge>not returnable</Badge>}
                    </span>
                  </td>
                  <td className="num">{o.qtyArrived > 0 && o.qtyArrived < o.qtyOrdered ? `${o.qtyArrived} of ${o.qtyOrdered}` : o.qtyOrdered}</td>
                  <td>
                    <ForCell order={o} onOpenTicket={onOpenTicket} />
                  </td>
                  {view === 'needed' && (
                    <td className={new Date(o.createdAt).toDateString() === new Date().toDateString() ? undefined : 'od-late'}>
                      {formatDateTime(o.createdAt)}
                    </td>
                  )}
                  {view !== 'needed' && <td>{o.vendor ?? <span className="od-muted">—</span>}</td>}
                  {view === 'ordered' && (
                    <td className={o.overdue ? 'od-late' : undefined}>
                      {o.expectedAt ? formatDate(o.expectedAt) : '—'}
                      {o.overdue && ' · late'}
                    </td>
                  )}
                  {view === 'arrived' && <td>{o.arrivedAt ? formatDateTime(o.arrivedAt) : ''}</td>}
                  {view === 'closed' && (
                    <td>
                      <Badge tone={statusBadge[o.status].tone}>{o.status === 'arrived' ? 'On the shelf' : statusBadge[o.status].label}</Badge>
                      {o.returnFee ? <span className="od-muted"> fee {formatMoney(o.returnFee)}</span> : null}
                    </td>
                  )}
                  <td className="od-actions">
                    {(view === 'needed' || view === 'ordered') && (
                      <Button size="sm" disabled={busy} onClick={() => setOpen({ kind: 'receive', order: o })}>
                        {view === 'needed' ? 'Got it today' : 'Receive'}
                      </Button>
                    )}
                    {view === 'ordered' && (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen({ kind: 'edit', order: o })}>
                        Edit
                      </Button>
                    )}
                    {(view === 'needed' || view === 'ordered') && o.qtyArrived === 0 && (
                      <Button size="sm" variant="ghost" className="od-danger" disabled={busy} onClick={() => void cancel(o)}>
                        Cancel
                      </Button>
                    )}
                    {(view === 'ordered' || view === 'arrived') && o.qtyArrived > 0 && o.returnable && (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen({ kind: 'return', order: o })}>
                        Return
                      </Button>
                    )}
                    {(view === 'ordered' || view === 'arrived') && o.qtyArrived > 0 && o.ticketId && (
                      <Button size="sm" variant="ghost" className="od-danger" disabled={busy} onClick={() => void unclaimed(o)}>
                        Unclaimed
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      {open?.kind === 'receive' && (
        <ReceiveDialog
          order={open.order}
          busy={busy}
          onClose={() => setOpen(null)}
          onReceive={(qty) => void finish(() => api.receiveOrder(open.order.id, qty))}
        />
      )}
      {open?.kind === 'edit' && (
        <OrderDetailsDialog
          title={`Edit order: ${open.order.description}`}
          submitLabel="Save"
          initial={{ vendor: open.order.vendor ?? '', expectedAt: open.order.expectedAt ?? '', unitCost: open.order.unitCost }}
          showCost
          vendors={vendors}
          busy={busy}
          onClose={() => setOpen(null)}
          onSave={(v) => void finish(() => api.updateOrder(open.order.id, v))}
        />
      )}
      {open?.kind === 'mark' && (
        <OrderDetailsDialog
          title={`Mark ${selected.size} ordered`}
          submitLabel="Mark ordered"
          initial={{ vendor: '', expectedAt: '', unitCost: null }}
          showCost={false}
          vendors={vendors}
          busy={busy}
          onClose={() => setOpen(null)}
          onSave={(v) =>
            void finish(async () => {
              await api.markOrdered([...selected], v.vendor, v.expectedAt)
              setSelected(new Set())
            })
          }
        />
      )}
      {open?.kind === 'return' && (
        <ReturnDialog
          order={open.order}
          busy={busy}
          onClose={() => setOpen(null)}
          onReturn={(fee) => void finish(() => api.returnOrder(open.order.id, fee))}
        />
      )}
      {dialogs.dialog}
    </div>
  )
}

export default OrdersPage
