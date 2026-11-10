import {
  api,
  customerName,
  formatDate,
  formatDateTime,
  formatMinutes,
  formatMoney,
  formatPhone,
  vehicleLabel,
  type Queue,
  type Ticket,
} from '../../../api'
import { Alert, Badge, Button, FormField, Panel, type Dialogs } from '../../../ui'
import { queueOf, type Run } from './labels'

type Props = {
  ticket: Ticket
  busy: boolean
  run: Run
  dialogs: Dialogs
  waits: Record<Queue, number> | null
  onAccept: () => void
}

// Who and what the ticket is for, where it stands, and the next step.
function TicketSummary({ ticket, busy, run, dialogs, waits, onAccept }: Props) {
  const { customer, vehicle } = ticket
  const isQuote = ticket.status === 'quote'
  const isWorkOrder = ticket.status === 'work_order'
  const isInvoice = ticket.status === 'invoiced'

  // Quoted tire options the customer hasn't chosen between yet.
  const undecided = ticket.workItems.some(
    (w) => w.itemType === 'tires' && w.status === 'pending' && !w.tireProductId && !w.customerSuppliedTires,
  )
  const queues = [...new Set(ticket.workItems.map((w) => queueOf[w.itemType]).filter(Boolean))] as Queue[]

  async function decline() {
    if (await dialogs.confirm({ title: 'Customer declined?', message: 'The quote moves to Declined.', confirmLabel: 'Mark declined', danger: true })) {
      void run(() => api.declineTicket(ticket.id))
    }
  }

  async function backToQuote() {
    if (
      await dialogs.confirm({
        title: 'Back to a quote?',
        message: 'Undoes the acceptance. Reserved tires are released. Only possible before any work, order or deposit.',
        confirmLabel: 'Back to quote',
      })
    ) {
      void run(() => api.revertToQuote(ticket.id))
    }
  }

  return (
    <>
      <Panel title="Customer & vehicle">
        <dl className="ed-facts">
          <dt>Customer</dt>
          <dd>
            {customerName(customer)}
            {customer.hasAccount && <Badge>Account</Badge>}
            {customer.phone && <div className="ed-muted">{formatPhone(customer.phone)}</div>}
          </dd>
          <dt>Vehicle</dt>
          <dd>
            {vehicleLabel(vehicle)}
            <div className="ed-badges">
              <Badge>{vehicle.vehicleClass === 'car' ? 'Car' : 'Truck'}</Badge>
              {vehicle.liftedLowered && <Badge tone="warning">Lifted/lowered</Badge>}
              {vehicle.multiLinkSuspension && <Badge tone="warning">Multi-link</Badge>}
            </div>
          </dd>
          {vehicle.tireSize && (
            <>
              <dt>Tire size</dt>
              <dd>{vehicle.tireSize}</dd>
            </>
          )}
          {vehicle.licensePlate && (
            <>
              <dt>Plate</dt>
              <dd>{vehicle.licensePlate}</dd>
            </>
          )}
          {ticket.createdByName && (
            <>
              <dt>Written by</dt>
              <dd>{ticket.createdByName}</dd>
            </>
          )}
          {ticket.acceptedByName && (
            <>
              <dt>Accepted by</dt>
              <dd>{ticket.acceptedByName}</dd>
            </>
          )}
        </dl>
      </Panel>

      {isQuote && (
        <Panel title="Next step">
          <div className="ed-stack">
            <p className={ticket.expired ? 'ed-warn' : 'ed-muted'}>
              {ticket.expired ? 'Expired ' : 'Price guaranteed until '}
              {formatDate(ticket.validUntil)}
            </p>
            {ticket.expired && (
              <Alert tone="warning">Past its price guarantee. Check tire prices before the customer accepts.</Alert>
            )}
            {waits && queues.length > 0 && (
              <p className="ed-muted">
                Wait if they stay: {queues.map((q) => `${q} ~${formatMinutes(waits[q])}`).join(' · ')}
              </p>
            )}
            <div className="ed-button-row">
              <Button variant="danger" disabled={busy} onClick={() => void decline()}>
                Declined
              </Button>
              <Button
                variant="primary"
                disabled={busy || ticket.workItems.length === 0 || undecided}
                title={undecided ? 'Pick one of the quoted tire options first' : undefined}
                onClick={onAccept}
              >
                Customer accepted
              </Button>
            </div>
            {undecided && <p className="ed-muted">Pick one of the quoted tire options before the customer accepts.</p>}
          </div>
        </Panel>
      )}

      {isWorkOrder && (
        <Panel title="Vehicle status">
          <div className="ed-stack">
            <div className="ed-button-row">
              {ticket.checkedInAt ? (
                <Badge tone="accent">Checked in {formatDateTime(ticket.checkedInAt)}</Badge>
              ) : (
                <>
                  <Badge tone="warning">Not here yet</Badge>
                  <Button size="sm" variant="primary" disabled={busy} onClick={() => void run(() => api.checkIn(ticket.id))}>
                    Check in vehicle
                  </Button>
                </>
              )}
            </div>
            <FormField label="Planned for" hint="When the work is expected to happen (optional)">
              <input
                type="date"
                value={ticket.plannedFor ?? ''}
                disabled={busy}
                onChange={(e) => void run(() => api.setPlannedFor(ticket.id, e.target.value || null))}
              />
            </FormField>
            {ticket.depositOverrideReason && (
              <p className="ed-muted">Accepted without the usual deposit: {ticket.depositOverrideReason}</p>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              title="Only before any work, deposit or order has happened"
              onClick={() => void backToQuote()}
            >
              Back to quote
            </Button>
          </div>
        </Panel>
      )}

      {isInvoice && ticket.invoicedAt && (
        <Panel title="Invoice">
          <dl className="ed-facts">
            <dt>Invoiced</dt>
            <dd>
              {formatDateTime(ticket.invoicedAt)}
              {ticket.invoicedByName && <div className="ed-muted">by {ticket.invoicedByName}</div>}
            </dd>
            <dt>Work order</dt>
            <dd>WO-{ticket.quoteNumber}</dd>
            <dt>Status</dt>
            <dd>
              {ticket.paidAt ? (
                <Badge tone="success">
                  Paid{ticket.chargedToAccount ? ` on account ${formatDate(ticket.paidAt)}` : ''}
                </Badge>
              ) : (
                <Badge tone="warning">On account · owes {formatMoney(ticket.balance.balance)}</Badge>
              )}
            </dd>
          </dl>
        </Panel>
      )}
    </>
  )
}

export default TicketSummary
