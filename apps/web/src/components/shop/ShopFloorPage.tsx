import { useEffect, useState } from 'react'
import { api, customerName, formatMinutes, type Queue, type ShopEntry, type ShopFloor, type UpcomingTicket } from '../../api'
import { Alert, Badge, Button, EmptyState, PageHeader } from '../../ui'
import ComingUp from './ComingUp'
import NotDoingDialog from './NotDoingDialog'
import './ShopFloorPage.css'

type Props = {
  onOpenTicket: (id: string) => void
}

const queueLabels: Record<Queue, string> = {
  tires: 'Tires',
  mechanic: 'Mechanic',
  alignment: 'Alignment',
}

function jobLabel(e: ShopEntry) {
  if (e.itemType === 'tires') return `${e.tireQuantity ?? 4} tires${e.customerSuppliedTires ? ' (customer’s)' : ''}`
  if (e.itemType === 'mechanic') return `${e.title ?? 'Mechanic work'}${e.laborHours ? ` · ${e.laborHours} h` : ''}`
  return 'Alignment'
}

function Car({ e, onOpenTicket }: { e: ShopEntry; onOpenTicket: (id: string) => void }) {
  return (
    <div className="sf-car">
      <div className="sf-car-name">
        {e.year} {e.make} {e.model}
        {e.licensePlate && <span className="sf-plate">{e.licensePlate}</span>}
      </div>
      <div className="sf-muted">
        <button type="button" className="sf-link" onClick={() => onOpenTicket(e.ticketId)}>
          WO-{e.ticketNumber}
        </button>{' '}
        · {customerName(e)} · {jobLabel(e)}
      </div>
    </div>
  )
}

const REFRESH_MS = 30_000

function ShopFloorPage({ onOpenTicket }: Props) {
  const [floor, setFloor] = useState<ShopFloor | null>(null)
  const [upcoming, setUpcoming] = useState<UpcomingTicket[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notDoing, setNotDoing] = useState<ShopEntry | null>(null)

  // Times and waits move on their own, so refresh every 30 seconds.
  useEffect(() => {
    const controller = new AbortController()
    const load = () =>
      Promise.all([api.shopFloor(controller.signal), api.upcoming(controller.signal)])
        .then(([f, u]) => {
          setFloor(f)
          setUpcoming(u.tickets)
        })
        .catch((err) => {
          if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not load the shop floor')
        })
    void load()
    const timer = setInterval(() => void load(), REFRESH_MS)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [])

  async function act(action: () => Promise<ShopFloor>) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      setFloor(await action())
      // Finishing or moving a job can change what's coming up, too.
      setUpcoming((await api.upcoming()).tickets)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function saveNotDoing(e: ShopEntry, reason: string, suspension: boolean, followUp: boolean) {
    let ticketId: string | null = null
    const done = await act(async () => {
      const result = await api.jobNotPerformed(e.id, reason, suspension)
      ticketId = result.ticketId
      if (result.ordersToResolve > 0) {
        setNotice(
          `WO-${e.ticketNumber}: ${result.ordersToResolve} special-ordered item${result.ordersToResolve === 1 ? '' : 's'} need a decision on the Orders page (return or unclaimed).`,
        )
      }
      return result
    })
    if (!done) return
    setNotDoing(null)
    if (followUp && ticketId) {
      try {
        const created = await api.followUpQuote(ticketId)
        onOpenTicket(created.ticketId)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not create the follow-up quote')
      }
    }
  }

  if (!floor) return error ? <Alert tone="danger">{error}</Alert> : <p className="sf-muted">Loading the shop floor…</p>

  const freeLifts = floor.lifts.filter((l) => !l.entry)

  return (
    <div className="sf" aria-busy={busy}>
      <PageHeader title="Shop floor" subtitle="What’s on each lift, who’s next, and what’s coming. Updates every 30 seconds." />
      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="warning">{notice}</Alert>}

      <section className="sf-lifts" aria-label="Lifts">
        {floor.lifts.map((lift) => {
          const e = lift.entry
          const over = e && e.elapsedMinutes > e.jobMinutes
          return (
            <article key={lift.id} className={e ? 'sf-lift sf-lift-busy' : 'sf-lift'}>
              <header className="sf-lift-head">
                <h3>{lift.name}</h3>
                {e ? <Badge tone={over ? 'danger' : 'accent'}>{over ? 'Over time' : 'Working'}</Badge> : <Badge>Free</Badge>}
              </header>
              {e ? (
                <>
                  <Car e={e} onOpenTicket={onOpenTicket} />
                  {e.queue !== lift.queue && <Badge tone="warning">Moved from the {queueLabels[e.queue]} line</Badge>}
                  <div className={over ? 'sf-time sf-time-over' : 'sf-time'}>
                    {e.elapsedMinutes} of ~{e.jobMinutes} min
                  </div>
                  <div className="sf-actions">
                    <Button size="sm" variant="primary" disabled={busy} onClick={() => void act(() => api.jobDone(e.id))}>
                      Done
                    </Button>
                    <Button size="sm" disabled={busy} onClick={() => setNotDoing(e)}>
                      Can’t do it
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      title="Back into line, keeping its place"
                      onClick={() => void act(() => api.backToQueue(e.id))}
                    >
                      Back in line
                    </Button>
                  </div>
                </>
              ) : (
                <p className="sf-muted">Nothing on this lift.</p>
              )}
            </article>
          )
        })}
      </section>

      <section className="sf-queues">
        {(Object.keys(queueLabels) as Queue[]).map((queue) => {
          const q = floor.queues[queue]
          const freeHere = freeLifts.filter((l) => l.queue === queue)
          return (
            <article key={queue} className="sf-queue">
              <header className="sf-queue-head">
                <h2>{queueLabels[queue]}</h2>
                <span className="sf-wait" title="Wait for a car joining this line now">
                  New car: ~{formatMinutes(q.newCarWaitMinutes)}
                </span>
              </header>
              {q.entries.length === 0 ? (
                <EmptyState title="No cars waiting." />
              ) : (
                <ol className="sf-list">
                  {q.entries.map((e) => {
                    const isNext = e.id === q.nextEntryId
                    return (
                      <li key={e.id} className={['sf-entry', isNext ? 'sf-entry-next' : '', e.ready ? '' : 'sf-entry-held'].join(' ')}>
                        <span className="sf-position">{e.position}</span>
                        <div className="sf-entry-body">
                          <Car e={e} onOpenTicket={onOpenTicket} />
                          <div className="sf-status">
                            {isNext && <Badge tone="success">Next up</Badge>}
                            <span className={e.ready ? 'sf-ready' : 'sf-held'}>{e.reason ?? (e.ready ? 'Ready' : 'Waiting')}</span>
                            <span className="sf-muted">
                              ~{e.jobMinutes} min job · wait ~{formatMinutes(e.waitMinutes ?? 0)}
                            </span>
                          </div>
                          <div className="sf-actions">
                            {freeHere.length > 0 && e.ready && (
                              <Button size="sm" variant={isNext ? 'primary' : 'secondary'} disabled={busy} onClick={() => void act(() => api.startJob(e.id))}>
                                Start on {freeHere[0].name}
                              </Button>
                            )}
                            {freeLifts.some((l) => l.queue !== queue) && e.ready && (
                              <select
                                className="sf-select"
                                aria-label="Move to another free lift"
                                value=""
                                disabled={busy}
                                onChange={(ev) => {
                                  if (ev.target.value) void act(() => api.startJob(e.id, ev.target.value))
                                }}
                              >
                                <option value="">Move to…</option>
                                {freeLifts
                                  .filter((l) => l.queue !== queue)
                                  .map((l) => (
                                    <option key={l.id} value={l.id}>
                                      {l.name}
                                    </option>
                                  ))}
                              </select>
                            )}
                            <select
                              className="sf-select"
                              aria-label="Ready override"
                              value={e.readyOverride === null ? 'auto' : e.readyOverride ? 'ready' : 'hold'}
                              disabled={busy}
                              onChange={(ev) => {
                                const v = ev.target.value
                                void act(() => api.setReady(e.id, v === 'auto' ? null : v === 'ready'))
                              }}
                            >
                              <option value="auto">Ready: automatic</option>
                              <option value="ready">Force ready</option>
                              <option value="hold">Hold</option>
                            </select>
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setNotDoing(e)}>
                              Not doing it
                            </Button>
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ol>
              )}
            </article>
          )
        })}
      </section>

      <ComingUp
        tickets={upcoming}
        busy={busy}
        onOpenTicket={onOpenTicket}
        onPlan={(ticketId, date) =>
          void act(async () => {
            await api.setPlannedFor(ticketId, date)
            return api.shopFloor()
          })
        }
        onCheckIn={(ticketId) =>
          void act(async () => {
            await api.checkIn(ticketId)
            return api.shopFloor()
          })
        }
      />

      <p className="sf-muted">
        Waits count every car in line ahead, so they lean long. Work waiting on orders is under Coming up and never counts.
      </p>

      {notDoing && (
        <NotDoingDialog
          entry={notDoing}
          busy={busy}
          onClose={() => setNotDoing(null)}
          onSave={(reason, suspension, followUp) => void saveNotDoing(notDoing, reason, suspension, followUp)}
        />
      )}
    </div>
  )
}

export default ShopFloorPage
