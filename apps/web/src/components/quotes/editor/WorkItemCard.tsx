import { api, formatDate, formatMoney, type Ticket, type WorkItem } from '../../../api'
import { Badge, Button, type Dialogs } from '../../../ui'
import AddLineForm from './AddLineForm'
import { typeLabels, type Run } from './labels'
import LineRow from './LineRow'

type Props = {
  ticket: Ticket
  item: WorkItem
  showCosts: boolean
  busy: boolean
  run: Run
  dialogs: Dialogs
  onEditTires: () => void
  onCompare: () => void
  onOpenTicket: (id: string) => void
  onNotice: (message: string) => void
  onError: (message: string) => void
}

function tireSummary(item: WorkItem) {
  if (!item.tireInfo) return null
  const info = item.tireInfo
  const notes = [
    item.customerSuppliedTires
      ? `${item.tireQuantity} customer-supplied tires (${item.customerTireSize})`
      : `${item.tireQuantity} tires`,
    info.tireClass === 'truck' ? 'truck tire' : 'car tire',
    info.lowProfile && 'low-profile',
    info.oversized && 'oversized',
    info.diameterIn && `${info.diameterIn}" tall`,
    item.difficultyMinutes > 0 && `+${item.difficultyMinutes} min difficulty`,
  ].filter(Boolean)
  return (
    <>
      {notes.join(' · ')}
      {!info.parsed && (
        <>
          {' '}
          <Badge tone="warning">size not recognized; priced as a regular car tire</Badge>
        </>
      )}
    </>
  )
}

function WorkItemCard({ ticket, item, showCosts, busy, run, dialogs, onEditTires, onCompare, onOpenTicket, onNotice, onError }: Props) {
  const isQuote = ticket.status === 'quote'
  const isWorkOrder = ticket.status === 'work_order'
  const pending = item.status === 'pending'
  const editable = (isQuote || isWorkOrder) && pending
  // On a work order, only work added after acceptance can be reworked or removed.
  const canRework = isQuote || (isWorkOrder && item.addedOnWorkOrder)
  const name = item.title ? `${typeLabels[item.itemType]} · ${item.title}` : typeLabels[item.itemType]
  // Options quoted, the customer hasn't chosen yet.
  const choosing = item.itemType === 'tires' && !item.tireProductId && !item.customerSuppliedTires
  const tierNames: Record<string, string> = { cheap: 'Cheap', medium: 'Medium', premium: 'Premium', option: 'Option' }

  async function notPerformed() {
    const reason = await dialogs.prompt({
      title: `Not performed: ${name}`,
      label: 'Why won’t this be done?',
      initial: 'Customer declined',
      message: 'It stays on the work order for the record but isn’t charged. Reserved stock is released.',
      confirmLabel: 'Mark not performed',
    })
    if (!reason) return
    void run(async () => {
      const result = await api.workItemNotPerformed(item.id, reason)
      if (result.ordersToResolve > 0) {
        onNotice(
          `${result.ordersToResolve} special-ordered item${result.ordersToResolve === 1 ? '' : 's'} for ${name} need a decision on the Orders page: return to the vendor, or mark unclaimed.`,
        )
      }
      return result
    })
  }

  async function rename() {
    const title = await dialogs.prompt({
      title: 'Rename work item',
      label: 'Name',
      initial: item.title ?? '',
      required: false,
    })
    if (title !== null) void run(() => api.updateWorkItem(item.id, { title }))
  }

  async function remove() {
    if (await dialogs.confirm({ title: `Remove ${name}?`, message: 'Its lines are removed too.', confirmLabel: 'Remove', danger: true })) {
      void run(() => api.deleteWorkItem(item.id))
    }
  }

  async function followUp() {
    try {
      const created = await api.followUpQuote(ticket.id)
      onOpenTicket(created.ticketId)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not create quote')
    }
  }

  return (
    <section className="ed-item">
      <header className="ed-item-header">
        <div className="ed-item-heading">
          <h3 className="ed-item-title">
            {typeLabels[item.itemType]}
            {item.title && <span className="ed-item-subtitle"> · {item.title}</span>}
          </h3>
          {isWorkOrder && item.addedOnWorkOrder && <Badge tone="warning">Added on work order</Badge>}
          {item.status === 'completed' && <Badge tone="success">Done</Badge>}
          {item.status === 'not_performed' && <Badge tone="danger">Not performed · not charged</Badge>}
        </div>

        <div className="ed-item-actions">
          {editable && item.itemType === 'tires' && canRework && (
            <Button size="sm" variant="ghost" onClick={onCompare}>
              {choosing ? 'Change options' : 'Compare'}
            </Button>
          )}
          {editable && item.itemType === 'tires' && canRework && !choosing && (
            <Button size="sm" variant="ghost" onClick={onEditTires}>
              Edit tires
            </Button>
          )}
          {editable && item.itemType === 'alignment' && canRework && (
            <Button
              size="sm"
              variant="ghost"
              title="Recalculate from the vehicle's current details"
              onClick={() => void run(() => api.updateWorkItem(item.id, {}))}
            >
              Recalculate
            </Button>
          )}
          {editable && (item.itemType === 'mechanic' || item.itemType === 'other') && (
            <Button size="sm" variant="ghost" onClick={() => void rename()}>
              Rename
            </Button>
          )}
          {editable && canRework && (
            <Button size="sm" variant="ghost" className="ed-danger-text" onClick={() => void remove()}>
              Remove
            </Button>
          )}
          {isWorkOrder && pending && (
            <>
              <Button size="sm" disabled={busy} onClick={() => void notPerformed()}>
                Not performed
              </Button>
              <Button size="sm" variant="primary" disabled={busy} onClick={() => void run(() => api.completeWorkItem(item.id))}>
                Mark done
              </Button>
            </>
          )}
          {isWorkOrder && item.itemType === 'alignment' && item.status === 'not_performed' && (
            <Button
              size="sm"
              disabled={busy}
              title="A new quote for the same vehicle with a suspension repair item"
              onClick={() => void followUp()}
            >
              Create follow-up quote
            </Button>
          )}
        </div>
      </header>

      {(item.itemType === 'tires' || item.notPerformedReason) && (
        <div className="ed-item-meta">
          {item.itemType === 'tires' && <p>{tireSummary(item)}</p>}
          {item.notPerformedReason && <p>Reason: {item.notPerformedReason}</p>}
        </div>
      )}

      {choosing ? (
        <div className="ui-table-wrap">
          <table className="ui-table ed-lines">
            <thead>
              <tr>
                <th scope="col">Option</th>
                <th scope="col">Tire</th>
                <th scope="col" className="num">Each</th>
                <th scope="col" className="num">Out the door</th>
                <th scope="col">
                  <span className="visually-hidden">Pick</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {item.tireOptions.map((o) => (
                <tr key={o.id}>
                  <td>
                    <strong>{tierNames[o.tier]}</strong>
                  </td>
                  <td>
                    <span className="ed-option">
                      {o.hasPhoto && o.tireLineId && (
                        <img className="ed-option-photo" src={api.tireLinePhotoUrl(o.tireLineId, o.photoUpdatedAt)} alt="" />
                      )}
                      <span>
                        {o.description}
                        <span className="ed-muted">
                          {' '}
                          {[o.loadIndex && o.speedRating && `${o.loadIndex}${o.speedRating}`, o.warrantyMiles && `${o.warrantyMiles.toLocaleString()} mi`]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="num">{formatMoney(o.unitPrice)}</td>
                  <td className="num ed-line-total">
                    {formatMoney(o.total)} <span className="ed-muted">for {o.quantity}</span>
                  </td>
                  <td className="ed-row-actions">
                    {editable && (
                      <Button size="sm" variant="primary" disabled={busy} onClick={() => void run(() => api.pickTireOption(item.id, o.id))}>
                        Pick
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="ed-empty-lines">
            Prices quoted {item.tireOptions[0] && formatDate(item.tireOptions[0].createdAt)} and held for the quote’s guarantee.
            Out-the-door totals include mount &amp; balance, disposal and tax. Not in the quote total until one is picked.
          </p>
        </div>
      ) : item.lines.length > 0 ? (
        <div className="ui-table-wrap">
          <table className="ui-table ed-lines">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col" className="num">Qty</th>
                <th scope="col" className="num">Each</th>
                <th scope="col" className="num">Discount</th>
                <th scope="col" className="num">Total</th>
                {showCosts && <th scope="col" className="num">Cost</th>}
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {item.lines.map((line) => (
                <LineRow
                  key={`${line.id}-${line.quantity}-${line.unitPrice}-${line.discountType}-${line.discountValue}`}
                  line={line}
                  editable={editable && !line.locked && !busy}
                  showStock={isWorkOrder}
                  showCosts={showCosts}
                  onUpdate={(input) => void run(() => api.updateLine(line.id, input))}
                  onDelete={() => void run(() => api.deleteLine(line.id))}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="ed-empty-lines">No lines yet. Add labor, parts or items below.</p>
      )}

      {/* Finished work is settled: new work goes in a new work item. */}
      {editable && !choosing && (
        <AddLineForm
          itemType={item.itemType}
          showCosts={showCosts}
          onWorkOrder={isWorkOrder}
          onAdd={(input) => void run(() => api.addLine(item.id, input))}
        />
      )}
    </section>
  )
}

export default WorkItemCard
