import { useEffect, useState } from 'react'
import { api, formatMoney, type LowStockItem } from '../../api'
import { Alert, Badge, Button, EmptyState, PageHeader, Panel, Table } from '../../ui'
import './LowStockPage.css'

type Props = {
  onGoToOrders: () => void
  onCountChange: (count: number) => void
}

function itemName(item: LowStockItem) {
  return [item.brand, item.model, item.tireSize].filter(Boolean).join(' ')
}

// Stocked items below their minimum, with a suggested quantity to order.
function LowStockPage({ onGoToOrders, onCountChange }: Props) {
  const [items, setItems] = useState<LowStockItem[] | null>(null)
  // Order quantity per product, as typed; defaults to the suggestion.
  const [qty, setQty] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function show(list: LowStockItem[]) {
    setItems(list)
    setQty(Object.fromEntries(list.map((i) => [i.id, String(i.suggestedQty || '')])))
    setSelected(new Set(list.filter((i) => i.suggestedQty > 0).map((i) => i.id)))
    onCountChange(list.filter((i) => i.suggestedQty > 0).length)
  }

  useEffect(() => {
    const controller = new AbortController()
    api
      .lowStock(controller.signal)
      .then((data) => show(data.items))
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Could not load low stock')
        }
      })
    return () => controller.abort()
    // show() only calls setters and the parent's count callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const qtyOf = (id: string) => {
    const n = Number(qty[id])
    return Number.isInteger(n) && n > 0 ? n : 0
  }

  async function order(ids: string[]) {
    const lines = ids.map((id) => ({ productId: id, quantity: qtyOf(id) })).filter((l) => l.quantity > 0)
    if (lines.length === 0) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const data = await api.orderLowStock(lines)
      const total = lines.reduce((sum, l) => sum + l.quantity, 0)
      show(data.items)
      setNotice(
        `Added ${total} item${total === 1 ? '' : 's'} (${lines.length} product${lines.length === 1 ? '' : 's'}) to Orders → Needs ordering.`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add to orders')
    } finally {
      setBusy(false)
    }
  }

  const chosen = [...selected].filter((id) => qtyOf(id) > 0)
  const chosenCost = (items ?? [])
    .filter((i) => chosen.includes(i.id))
    .reduce((sum, i) => sum + i.cost * qtyOf(i.id), 0)

  return (
    <>
      <PageHeader
        title="Low stock"
        subtitle="Stocked tires and sensors with fewer available than their minimum. Available = on hand minus what’s reserved for customers; restock already on order is counted."
        actions={
          items &&
          items.length > 0 && (
            <>
              {chosen.length > 0 && <span className="ls-muted">Estimated cost {formatMoney(chosenCost)}</span>}
              <Button variant="primary" disabled={busy || chosen.length === 0} onClick={() => void order(chosen)}>
                Add {chosen.length} selected to orders
              </Button>
            </>
          )
        }
      />
      {error && <Alert tone="danger">{error}</Alert>}
      {notice && (
        <Alert tone="success">
          {notice}{' '}
          <button type="button" className="ls-link" onClick={onGoToOrders}>
            Go to Orders
          </button>
        </Alert>
      )}

      <Panel flush>
        {!error && !items && <EmptyState title="Loading…" />}
        {items && items.length === 0 && <EmptyState title="Everything is at or above its minimum." />}
        {items && items.length > 0 && (
          <Table>
            <thead>
              <tr>
                <th scope="col" className="ls-check">
                  <span className="visually-hidden">Select</span>
                </th>
                <th scope="col">Item</th>
                <th scope="col" className="num">On hand</th>
                <th scope="col" className="num">Reserved</th>
                <th scope="col" className="num">Available</th>
                <th scope="col" className="num">Minimum</th>
                <th scope="col" className="num">On order</th>
                <th scope="col" className="num">Order</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const covered = item.suggestedQty === 0
                return (
                  <tr key={item.id}>
                    <td className="ls-check">
                      <input
                        type="checkbox"
                        aria-label={`Select ${itemName(item)}`}
                        checked={selected.has(item.id)}
                        onChange={(e) => {
                          const next = new Set(selected)
                          if (e.target.checked) next.add(item.id)
                          else next.delete(item.id)
                          setSelected(next)
                        }}
                      />
                    </td>
                    <td>
                      <strong className="ls-name">{itemName(item)}</strong>
                      {item.productType === 'tpms_sensor' && (
                        <>
                          {' '}
                          <Badge>TPMS sensor</Badge>
                        </>
                      )}
                      <div className="ls-muted">
                        {item.sku} · cost {formatMoney(item.cost)}
                      </div>
                    </td>
                    <td className="num">{item.onHand}</td>
                    <td className="num">{item.reserved}</td>
                    <td className={item.available <= 0 ? 'num ls-warn' : 'num'}>
                      <strong>{item.available}</strong>
                    </td>
                    <td className="num">{item.minQty}</td>
                    <td className="num">
                      {item.onOrder} {covered && <Badge tone="success">covered</Badge>}
                    </td>
                    <td className="num">
                      <input
                        className="ls-qty"
                        inputMode="numeric"
                        aria-label={`Quantity to order of ${itemName(item)}`}
                        value={qty[item.id] ?? ''}
                        placeholder="0"
                        onChange={(e) => setQty({ ...qty, [item.id]: e.target.value })}
                      />
                    </td>
                    <td className="ls-actions">
                      <Button size="sm" disabled={busy || qtyOf(item.id) === 0} onClick={() => void order([item.id])}>
                        Add to orders
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  )
}

export default LowStockPage
