import { useEffect, useState } from 'react'
import { api, customerName, formatDate, formatMoney, type TicketStatus, type TicketSummary } from '../../api'
import { Alert, Badge, Button, EmptyState, PageHeader, Panel, Table, Tabs } from '../../ui'
import { ticketNumber } from './editor/labels'
import NewQuoteDialog from './NewQuoteDialog'
import QuoteEditor from './QuoteEditor'
import './QuotesPage.css'

type Props = {
  ticketId: string | null
  onOpenTicket: (id: string | null) => void
}

const tabs: { id: TicketStatus; label: string }[] = [
  { id: 'quote', label: 'Open quotes' },
  { id: 'work_order', label: 'Work orders' },
  { id: 'invoiced', label: 'Invoices' },
  { id: 'declined', label: 'Declined' },
]

function StatusCell({ t }: { t: TicketSummary }) {
  if (t.status === 'invoiced') {
    return (
      <span className="qp-status">
        {t.paidAt ? <Badge tone="success">Paid</Badge> : <Badge tone="warning">Owes {formatMoney(t.balance)}</Badge>}
        {t.invoicedAt && <span className="ed-muted">{formatDate(t.invoicedAt)}</span>}
      </span>
    )
  }
  if (t.status === 'work_order') {
    return (
      <span className="qp-status">
        <Badge tone={t.checkedInAt ? 'accent' : 'warning'}>{t.checkedInAt ? 'Checked in' : 'Not here yet'}</Badge>
        {t.openOrders > 0 && (
          <Badge tone="warning">
            {t.openOrders} item{t.openOrders === 1 ? '' : 's'} on order
          </Badge>
        )}
      </span>
    )
  }
  return (
    <span className={t.expired ? 'ed-warn' : 'ed-muted'}>
      {formatDate(t.validUntil)}
      {t.expired && ' (expired)'}
    </span>
  )
}

function QuotesPage({ ticketId, onOpenTicket }: Props) {
  const [status, setStatus] = useState<TicketStatus>('quote')
  const [tickets, setTickets] = useState<TicketSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (ticketId) return
    const controller = new AbortController()
    api
      .listTickets(status, controller.signal)
      .then((data) => {
        setTickets(data.tickets)
        setError(null)
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not load quotes')
      })
    return () => controller.abort()
  }, [status, ticketId])

  if (ticketId) {
    return (
      <QuoteEditor key={ticketId} ticketId={ticketId} onBack={() => onOpenTicket(null)} onOpenTicket={(id) => onOpenTicket(id)} />
    )
  }

  return (
    <>
      <PageHeader
        title="Quotes & work orders"
        subtitle="Price a customer’s vehicle, then track the accepted work through to the invoice."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            New quote
          </Button>
        }
      />

      <Panel flush>
        <Tabs
          label="Ticket status"
          tabs={tabs}
          value={status}
          onChange={(next) => {
            setTickets(null)
            setStatus(next)
          }}
        />
        {error && <Alert tone="danger">{error}</Alert>}
        {!error && tickets === null && <EmptyState title="Loading…" />}
        {tickets?.length === 0 && <EmptyState title="Nothing here yet." />}
        {tickets && tickets.length > 0 && (
          <Table>
            <thead>
              <tr>
                <th scope="col">Number</th>
                <th scope="col">Customer</th>
                <th scope="col">Vehicle</th>
                <th scope="col" className="num">
                  Total
                </th>
                <th scope="col">{status === 'quote' || status === 'declined' ? 'Valid until' : 'Status'}</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id} className="qp-row" onClick={() => onOpenTicket(t.id)}>
                  <td>
                    <button
                      type="button"
                      className="qp-number"
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpenTicket(t.id)
                      }}
                    >
                      {ticketNumber(t)}
                    </button>
                  </td>
                  <td>{customerName(t)}</td>
                  <td>
                    {t.year} {t.make} {t.model}
                  </td>
                  <td className="num">{formatMoney(t.total)}</td>
                  <td>
                    <StatusCell t={t} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      {creating && <NewQuoteDialog onClose={() => setCreating(false)} onCreated={(id) => onOpenTicket(id)} />}
    </>
  )
}

export default QuotesPage
