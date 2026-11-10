import { useState } from 'react'
import { formatDate, formatMoney } from '../../../api'
import { Button } from '../../../ui'

// Today's distributor cost for an ordered-in tire; saving puts it on a card.
// The last cost is only a reminder, never used on its own.
function OrderInCost({
  lastCost,
  lastCostAt,
  onSave,
  busy,
}: {
  lastCost: number | null
  lastCostAt: string | null
  onSave: (cost: number) => void
  busy: boolean
}) {
  const [cost, setCost] = useState('')
  return (
    <span className="cmp-cost-edit">
      <input
        className="ed-input"
        inputMode="decimal"
        placeholder="Cost"
        aria-label="Today's cost"
        title={lastCost !== null && lastCostAt ? `Last cost ${formatMoney(lastCost)} on ${formatDate(lastCostAt)}` : undefined}
        value={cost}
        onChange={(e) => setCost(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && Number(cost) > 0) onSave(Number(cost))
        }}
      />
      <Button size="sm" disabled={busy || !(Number(cost) > 0)} onClick={() => onSave(Number(cost))}>
        Add
      </Button>
      {lastCost !== null && lastCostAt && (
        <span className="cmp-muted cmp-last-cost">
          last {formatMoney(lastCost)} · {formatDate(lastCostAt)}
        </span>
      )}
    </span>
  )
}

export default OrderInCost
