import { formatDateTime, type Ticket } from '../../../api'
import { Badge, Panel } from '../../../ui'
import { orderStatus } from './labels'

// On a quote: what's on the shelf. On a work order: what was ordered.
function StockPanel({ ticket }: { ticket: Ticket }) {
  if (ticket.status === 'quote' || ticket.status === 'declined') {
    return (
      <Panel title="Stock check" description="Reserved when the customer accepts.">
        {ticket.stockCheck.length === 0 ? (
          <p className="ed-muted">No inventory items on this quote.</p>
        ) : (
          <ul className="ed-rows">
            {ticket.stockCheck.map((s) => (
              <li key={s.productId}>
                <div>
                  <strong>
                    {s.brand} {s.model} {s.tireSize ?? ''}
                  </strong>
                  <div className="ed-muted">
                    Need {s.needed} · {s.available} available
                    {s.shortfall > 0 && s.restockQty > 0 && ` · order ${s.shortfall} + ${s.restockQty} to restock`}
                  </div>
                </div>
                {s.shortfall > 0 ? <Badge tone="warning">Order {s.orderQty}</Badge> : <Badge tone="success">In stock</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    )
  }

  if (ticket.pendingOrders.length === 0 && ticket.callLogs.length === 0) return null

  return (
    <Panel title="Orders" description="Vendors and arrival dates are filled in on the Orders page.">
      <ul className="ed-rows">
        {ticket.pendingOrders.map((o) => (
          <li key={o.id}>
            <div>
              <strong>
                {o.qtyOrdered} × {o.description}
              </strong>
              <div className="ed-muted">
                {o.qtyArrived > 0 && o.qtyArrived < o.qtyOrdered ? `${o.qtyArrived} of ${o.qtyOrdered} arrived` : o.vendor ?? ''}
                {!o.returnable && ' · not returnable'}
              </div>
            </div>
            <Badge tone={orderStatus[o.status].tone}>{orderStatus[o.status].label}</Badge>
          </li>
        ))}
      </ul>
      {ticket.callLogs.length > 0 && (
        <ul className="ed-call-log">
          {ticket.callLogs.map((c) => (
            <li key={c.id}>
              <span className="ed-muted">{formatDateTime(c.calledAt)}</span> {c.note ?? 'Called'}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

export default StockPanel
