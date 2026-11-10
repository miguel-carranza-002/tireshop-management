import { useEffect, useState } from 'react'
import { api, type Queue, type Ticket } from '../../api'
import { Alert, Badge, Button, useDialogs } from '../../ui'
import ComparisonDialog, { type CompareTarget } from './compare/ComparisonDialog'
import AcceptDialog from './editor/AcceptDialog'
import CheckoutPanel from './editor/CheckoutPanel'
import { statusBadges, ticketNumber } from './editor/labels'
import StockPanel from './editor/StockPanel'
import TicketSummary from './editor/TicketSummary'
import TiresDialog from './editor/TiresDialog'
import TotalsPanel from './editor/TotalsPanel'
import WorkItemCard from './editor/WorkItemCard'
import './QuoteEditor.css'

type Props = {
  ticketId: string
  onBack: () => void
  onOpenTicket: (id: string) => void
}

// The quote / work order / invoice screen. Work items on the left; who it's
// for, where it stands and the money on the right.
function QuoteEditor({ ticketId, onBack, onOpenTicket }: Props) {
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showCosts, setShowCosts] = useState(false)
  const [accepting, setAccepting] = useState(false)
  // Which tires dialog is open: 'new', a work item id, or none.
  const [tiresFor, setTiresFor] = useState<string | null>(null)
  // The tire comparison: open for a new Tires item, or for an existing one.
  const [compare, setCompare] = useState<CompareTarget | null>(null)
  // Current waits, so the advisor can tell a walk-in how long it'll be.
  const [waits, setWaits] = useState<Record<Queue, number> | null>(null)
  const dialogs = useDialogs()

  useEffect(() => {
    const controller = new AbortController()
    api
      .waitEstimates(controller.signal)
      .then((data) => setWaits(data.estimates))
      .catch(() => {})
    return () => controller.abort()
  }, [ticketId])

  useEffect(() => {
    const controller = new AbortController()
    api
      .getTicket(ticketId, controller.signal)
      .then((data) => setTicket(data.ticket))
      .catch((err) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not load ticket')
      })
    return () => controller.abort()
  }, [ticketId])

  // Every change returns the whole updated ticket, so totals stay in sync.
  async function run(action: () => Promise<{ ticket: Ticket }>) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const data = await action()
      setTicket(data.ticket)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      return false
    } finally {
      setBusy(false)
    }
  }

  if (!ticket) {
    return error ? <Alert tone="danger">{error}</Alert> : <p className="ed-muted">Loading…</p>
  }

  const isQuote = ticket.status === 'quote'
  const isWorkOrder = ticket.status === 'work_order'
  const isInvoice = ticket.status === 'invoiced'
  const editable = isQuote || isWorkOrder
  const status = statusBadges[ticket.status]
  const hasAlignment = ticket.workItems.some((w) => w.itemType === 'alignment')
  const tiresItem = tiresFor && tiresFor !== 'new' ? ticket.workItems.find((w) => w.id === tiresFor) : undefined

  async function addNamed(itemType: 'mechanic' | 'other') {
    const title = await dialogs.prompt(
      itemType === 'mechanic'
        ? { title: 'Add mechanic work', label: 'What work?', placeholder: 'e.g. Front brakes', confirmLabel: 'Add', required: false }
        : { title: 'Add other item', label: 'What is it?', placeholder: 'e.g. Rims', confirmLabel: 'Add', required: false },
    )
    if (title !== null) void run(() => api.addWorkItem(ticket!.id, { itemType, title }))
  }

  return (
    <div className="ed" aria-busy={busy}>
      <header className="ed-header">
        <div>
          <button type="button" className="ed-back" onClick={onBack}>
            ← Quotes &amp; work orders
          </button>
          <div className="ed-title-row">
            <h1 className="ed-title">
              {isInvoice ? 'Invoice' : isWorkOrder ? 'Work order' : 'Quote'} {ticketNumber(ticket)}
            </h1>
            <Badge tone={status.tone}>{status.label}</Badge>
            {isWorkOrder && (
              <Badge tone={ticket.checkedInAt ? 'accent' : 'warning'}>
                {ticket.checkedInAt ? 'Vehicle checked in' : 'Vehicle not here yet'}
              </Badge>
            )}
            {isInvoice && (
              <Badge tone={ticket.paidAt ? 'success' : 'warning'}>{ticket.paidAt ? 'Paid' : 'On account'}</Badge>
            )}
          </div>
        </div>
        <div className="ed-header-actions">
          <label className="ed-check ed-muted">
            <input type="checkbox" checked={showCosts} onChange={(e) => setShowCosts(e.target.checked)} />
            Show costs &amp; margin
          </label>
          {/* Costs are never printed. The PDF opens in a new tab to print or save. */}
          <a className="ui-btn ui-btn-secondary" href={api.ticketPdfUrl(ticket.id)} target="_blank" rel="noreferrer">
            Print
          </a>
          <a className="ui-btn ui-btn-secondary" href={api.ticketPdfUrl(ticket.id, true)}>
            Download PDF
          </a>
        </div>
      </header>

      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="warning">{notice}</Alert>}

      <div className="ed-layout">
        <div className="ed-main">
          {ticket.workItems.length === 0 && (
            <div className="ed-item ed-empty-ticket">
              <p>Nothing on this {isQuote ? 'quote' : 'ticket'} yet. Add tires, an alignment, mechanic work or another item.</p>
            </div>
          )}

          {ticket.workItems.map((item) => (
            <WorkItemCard
              key={item.id}
              ticket={ticket}
              item={item}
              showCosts={showCosts}
              busy={busy}
              run={run}
              dialogs={dialogs}
              onEditTires={() => setTiresFor(item.id)}
              onCompare={() =>
                setCompare({
                  workItemId: item.id,
                  quantity: item.tireQuantity ?? undefined,
                  axle: item.title === 'Front' ? 'front' : item.title === 'Rear' ? 'rear' : null,
                })
              }
              onOpenTicket={onOpenTicket}
              onNotice={setNotice}
              onError={setError}
            />
          ))}

          {editable && (
            <div className="ed-add-work">
              <span className="ed-muted">{isWorkOrder ? 'Customer approved more work:' : 'Add to quote:'}</span>
              <Button size="sm" variant="primary" onClick={() => setCompare({})}>
                Compare tires
              </Button>
              <Button size="sm" onClick={() => setTiresFor('new')}>
                + Tires
              </Button>
              <Button
                size="sm"
                disabled={hasAlignment || busy}
                title={hasAlignment ? 'This ticket already has an alignment' : undefined}
                onClick={() => void run(() => api.addWorkItem(ticket.id, { itemType: 'alignment' }))}
              >
                + Alignment
              </Button>
              <Button size="sm" disabled={busy} onClick={() => void addNamed('mechanic')}>
                + Mechanic work
              </Button>
              <Button size="sm" disabled={busy} onClick={() => void addNamed('other')}>
                + Other
              </Button>
            </div>
          )}
        </div>

        <aside className="ed-side">
          <TicketSummary
            ticket={ticket}
            busy={busy}
            run={run}
            dialogs={dialogs}
            waits={waits}
            onAccept={() => setAccepting(true)}
          />
          <TotalsPanel ticket={ticket} showCosts={showCosts} busy={busy} run={run} />
          {isWorkOrder && (
            <CheckoutPanel
              key={`${ticket.balance.balance}-${ticket.invoiceReadiness?.pendingItems}-${ticket.invoiceReadiness?.openOrders}`}
              ticket={ticket}
              busy={busy}
              onInvoice={(input) => void run(() => api.createInvoice(ticket.id, input))}
            />
          )}
          <StockPanel ticket={ticket} />
        </aside>
      </div>

      {accepting && isQuote && (
        <AcceptDialog
          ticket={ticket}
          busy={busy}
          onClose={() => setAccepting(false)}
          onAccept={async (input) => {
            let toOrder: string[] = []
            const accepted = await run(async () => {
              const data = await api.acceptTicket(ticket.id, input)
              toOrder = data.ticket.pendingOrders.filter((o) => o.status === 'needed').map((o) => `${o.qtyOrdered}× ${o.description}`)
              return data
            })
            if (accepted) {
              setAccepting(false)
              // The orders are already on the list; say so, so nobody wonders.
              if (toOrder.length > 0) {
                setNotice(`Added to Orders → Needs ordering: ${toOrder.join(', ')}. Place the order with the distributor.`)
              }
            }
          }}
        />
      )}

      {tiresFor && (
        <TiresDialog
          vehicleTireSize={ticket.vehicle.tireSize}
          initial={tiresItem}
          busy={busy}
          onClose={() => setTiresFor(null)}
          onSubmit={async (config) => {
            const done = await run(() =>
              tiresItem
                ? api.updateWorkItem(tiresItem.id, { title: tiresItem.title, ...config })
                : api.addWorkItem(ticket.id, { itemType: 'tires', ...config }),
            )
            if (done) setTiresFor(null)
          }}
        />
      )}

      {compare && (
        <ComparisonDialog
          ticket={ticket}
          target={compare}
          busy={busy}
          onClose={() => setCompare(null)}
          onPick={async (productId, quantity, axle) => {
            const config = {
              customerSuppliedTires: false,
              tireProductId: productId,
              tireQuantity: quantity,
              oldTiresRemoved: quantity,
              customerTireSize: null,
              difficultyMinutes: null,
            }
            const title = axle === 'front' ? 'Front' : axle === 'rear' ? 'Rear' : undefined
            const item = compare.workItemId ? ticket.workItems.find((w) => w.id === compare.workItemId) : undefined
            const done = await run(() =>
              item
                ? api.updateWorkItem(item.id, { title: item.title, ...config })
                : api.addWorkItem(ticket.id, { itemType: 'tires', title, ...config }),
            )
            if (done) setCompare(null)
          }}
          onQuote={async (input) => {
            const item = compare.workItemId ? ticket.workItems.find((w) => w.id === compare.workItemId) : undefined
            // Replace the options on an item still waiting for a pick; otherwise add a new item.
            const replace = item && !item.tireProductId && !item.customerSuppliedTires ? item.id : null
            const done = await run(() => api.saveTireOptions(ticket.id, { ...input, workItemId: replace }))
            if (done) setCompare(null)
          }}
        />
      )}

      {dialogs.dialog}
    </div>
  )
}

export default QuoteEditor
