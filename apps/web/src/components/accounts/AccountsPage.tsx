import { useEffect, useState } from 'react'
import { api, customerName, formatDate, formatMoney, formatPhone, type OpenInvoice } from '../../api'
import { Alert, Badge, EmptyState, PageHeader, Panel, Table } from '../../ui'
import './AccountsPage.css'

type Props = {
  onOpenTicket: (id: string) => void
}

type CustomerGroup = {
  customerId: string
  name: string
  phone: string | null
  owed: number
  oldestDays: number
  invoices: OpenInvoice[]
}

function groupByCustomer(invoices: OpenInvoice[]): CustomerGroup[] {
  const groups = new Map<string, CustomerGroup>()
  for (const inv of invoices) {
    let group = groups.get(inv.customerId)
    if (!group) {
      group = {
        customerId: inv.customerId,
        name: customerName(inv),
        phone: inv.phone,
        owed: 0,
        oldestDays: 0,
        invoices: [],
      }
      groups.set(inv.customerId, group)
    }
    group.owed += inv.balance
    group.oldestDays = Math.max(group.oldestDays, inv.ageDays)
    group.invoices.push(inv)
  }
  return [...groups.values()]
}

// Account customers' invoices that are still owed.
function AccountsPage({ onOpenTicket }: Props) {
  const [invoices, setInvoices] = useState<OpenInvoice[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    api
      .openAccounts(controller.signal)
      .then((data) => setInvoices(data.invoices))
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Could not load open accounts')
        }
      })
    return () => controller.abort()
  }, [])

  const groups = invoices ? groupByCustomer(invoices) : []
  const totalOwed = groups.reduce((sum, g) => sum + g.owed, 0)

  return (
    <>
      <PageHeader
        title="Accounts"
        subtitle="Invoices charged to a business account and not paid yet. Open one to record a payment."
        actions={
          groups.length > 0 && (
            <span className="ac-total">
              <strong>{formatMoney(totalOwed)}</strong> owed by {groups.length} customer{groups.length === 1 ? '' : 's'}
            </span>
          )
        }
      />
      {error && <Alert tone="danger">{error}</Alert>}
      <Panel flush>
        {!error && !invoices && <EmptyState title="Loading…" />}
        {invoices && groups.length === 0 && <EmptyState title="Nobody owes anything on account." />}
        {groups.length > 0 && (
          <Table>
            <thead>
              <tr>
                <th scope="col">Invoice</th>
                <th scope="col">Date</th>
                <th scope="col">Vehicle</th>
                <th scope="col" className="num">Invoice total</th>
                <th scope="col" className="num">Still owed</th>
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.customerId}>
                <tr className="ac-group">
                  <th scope="rowgroup" colSpan={4}>
                    {g.name}
                    {g.phone && <span className="ac-muted"> · {formatPhone(g.phone)}</span>}
                    {g.oldestDays >= 30 && (
                      <>
                        {' '}
                        <Badge tone="warning">oldest {g.oldestDays} days</Badge>
                      </>
                    )}
                  </th>
                  <td className="num ac-owed">{formatMoney(g.owed)}</td>
                </tr>
                {g.invoices.map((inv) => (
                  <tr key={inv.id} className="ac-row" onClick={() => onOpenTicket(inv.id)}>
                    <td>
                      <button
                        type="button"
                        className="ac-link"
                        onClick={(e) => {
                          e.stopPropagation()
                          onOpenTicket(inv.id)
                        }}
                      >
                        INV-{inv.invoiceNumber}
                      </button>
                    </td>
                    <td>
                      {formatDate(inv.invoicedAt)}
                      <span className="ac-muted"> · {inv.ageDays} days</span>
                    </td>
                    <td>
                      {inv.year} {inv.make} {inv.model}
                    </td>
                    <td className="num">{formatMoney(inv.charges)}</td>
                    <td className="num">{formatMoney(inv.balance)}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </Table>
        )}
      </Panel>
    </>
  )
}

export default AccountsPage
