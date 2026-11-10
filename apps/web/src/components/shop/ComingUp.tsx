import { customerName, formatDate, formatPhone, type UpcomingTicket } from '../../api'
import { Badge, Button, EmptyState, Panel } from '../../ui'

type Props = {
  tickets: UpcomingTicket[]
  busy: boolean
  onOpenTicket: (id: string) => void
  onPlan: (ticketId: string, date: string | null) => void
  onCheckIn: (ticketId: string) => void
}

const itemLabels = { tires: 'Tires', mechanic: 'Mechanic', alignment: 'Alignment', other: 'Other' }

// YYYY-MM-DD in the shop's local time.
function localISO(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function groupFor(date: string | null, today: string, tomorrow: string, weekEnd: string) {
  if (!date) return 'No date yet'
  if (date < today) return 'Overdue'
  if (date === today) return 'Today'
  if (date === tomorrow) return 'Tomorrow'
  if (date <= weekEnd) return 'This week'
  return 'Later'
}

const groupOrder = ['Overdue', 'Today', 'Tomorrow', 'This week', 'Later', 'No date yet']

function statusLine(t: UpcomingTicket) {
  const orders = t.orders ?? []
  const open = orders.filter((o) => o.status !== 'arrived')
  if (t.needsOrdering) {
    return { text: `${open.length} item${open.length === 1 ? '' : 's'} still to be ordered`, warn: true }
  }
  if (open.length > 0) {
    return {
      text: `Waiting on ${open.length} order${open.length === 1 ? '' : 's'}${t.expectedBy ? `, expected ${formatDate(t.expectedBy)}` : ''}`,
      warn: false,
    }
  }
  if (!t.checkedInAt) {
    if (orders.length === 0) return { text: 'Everything is in stock', warn: false }
    return {
      text: t.customerNotifiedAt ? 'Everything is in · customer told' : 'Everything is in · call the customer',
      warn: !t.customerNotifiedAt,
    }
  }
  return { text: 'Ready to join the line', warn: false }
}

// Accepted work that isn't on the floor: the car isn't here yet, or a job is
// still waiting on tires or parts. None of it counts toward today's waits.
function ComingUp({ tickets, busy, onOpenTicket, onPlan, onCheckIn }: Props) {
  const now = new Date()
  const today = localISO(now)
  const tomorrow = localISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))
  const weekEnd = localISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7))

  const groups = new Map<string, UpcomingTicket[]>()
  for (const t of tickets) {
    const key = groupFor(t.plannedFor ?? t.expectedBy, today, tomorrow, weekEnd)
    groups.set(key, [...(groups.get(key) ?? []), t])
  }

  return (
    <Panel
      flush
      title="Coming up"
      description="Accepted work that isn’t on the floor yet. It doesn’t count toward any wait, and joins the back of the line once the car is here and everything has arrived."
    >
      {tickets.length === 0 ? (
        <EmptyState title="Nothing waiting. Every work order is on the floor." />
      ) : (
        groupOrder
          .filter((g) => groups.has(g))
          .map((g) => (
            <div key={g} className="coming-group">
              <h3 className={g === 'Overdue' ? 'coming-overdue' : undefined}>{g}</h3>
              <ul className="coming-list">
                {groups.get(g)!.map((t) => {
                  const status = statusLine(t)
                  const waitingItems = (t.items ?? []).filter((i) => !i.queued)
                  return (
                    <li key={t.id} className="coming-card">
                      <div className="coming-main">
                        <p className="sf-car-name">
                          {t.year} {t.make} {t.model}
                          {t.licensePlate && <span className="sf-plate">{t.licensePlate}</span>}{' '}
                          {t.checkedInAt ? <Badge tone="accent">Car is here</Badge> : <Badge>Not here yet</Badge>}
                        </p>
                        <p className="sf-muted">
                          <button type="button" className="sf-link" onClick={() => onOpenTicket(t.id)}>
                            WO-{t.ticketNumber}
                          </button>{' '}
                          · {customerName(t)}
                          {t.phone && ` · ${formatPhone(t.phone)}`}
                          {' · '}
                          {waitingItems
                            .map((i) =>
                              i.itemType === 'tires' && i.tireQuantity
                                ? `${i.tireQuantity} tires`
                                : `${itemLabels[i.itemType]}${i.title ? ` (${i.title})` : ''}`,
                            )
                            .join(', ')}
                        </p>
                        <p className={status.warn ? 'coming-status coming-warn' : 'coming-status'}>
                          {status.text}
                          {t.plannedFor && t.expectedBy && t.expectedBy > t.plannedFor && (
                            <span className="coming-warn"> · orders arrive after the planned date</span>
                          )}
                        </p>
                      </div>
                      <div className="coming-actions">
                        <label className="sf-muted coming-plan">
                          Planned for{' '}
                          <input
                            type="date"
                            value={t.plannedFor ?? ''}
                            disabled={busy}
                            onChange={(e) => onPlan(t.id, e.target.value || null)}
                          />
                        </label>
                        {!t.checkedInAt && (
                          <Button size="sm" disabled={busy} onClick={() => onCheckIn(t.id)}>
                            Car is here: check in
                          </Button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))
      )}
    </Panel>
  )
}

export default ComingUp
