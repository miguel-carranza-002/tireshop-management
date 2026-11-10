import { useState } from 'react'
import { api, formatMoney, type CompareOption, type Tier } from '../../../api'
import { Badge, Button } from '../../../ui'
import { kindLabel, maxLoadLabel, sidewallLabel, specLabel, utqgLabel, warrantyLabel } from '../../inventory/tireSpec'
import { costAge, tierLabel } from './labels'

type Props = {
  option: CompareOption
  tier: Tier
  quantity: number
  customerView: boolean
  included?: boolean
  onToggleInclude?: () => void
  onPick: () => void
  swapChoices?: CompareOption[]
  onSwap?: (productId: string) => void
  onCost: (cost: number) => void
  busy: boolean
}

export function AvailabilityBadge({ option: o, customerView }: { option: CompareOption; customerView: boolean }) {
  if (o.availability === 'in_stock') return <Badge tone="success">In stock · same day</Badge>
  // Used tires can't be ordered in: only what's on the shelf.
  if (o.condition === 'used') return <Badge tone="warning">Only {o.availableQty} in stock</Badge>
  if (o.availability === 'partial') return <Badge tone="warning">{o.availableQty} in stock, rest ordered</Badge>
  return <Badge tone="accent">{customerView ? 'Order in' : `Order${o.supplier ? ` from ${o.supplier}` : ''}`}</Badge>
}

// One tire option: what it is, what's on hand, and what it costs out the door.
function OptionCard({ option: o, tier, quantity, customerView, included, onToggleInclude, onPick, swapChoices, onSwap, onCost, busy }: Props) {
  const [editingCost, setEditingCost] = useState(false)
  const [cost, setCost] = useState(o.cost === null ? '' : String(o.cost))
  const otd = o.outTheDoor
  const age = costAge(o.costUpdatedAt)

  return (
    <article className={included === false ? 'cmp-card cmp-card-out' : 'cmp-card'}>
      <header className="cmp-card-head">
        <span className={`cmp-tier cmp-tier-${tier}`}>{tierLabel(tier, customerView)}</span>
        {onToggleInclude && !customerView && (
          <label className="cmp-include">
            <input type="checkbox" checked={included} onChange={onToggleInclude} /> Quote this
          </label>
        )}
      </header>

      <div className="cmp-photo">
        {o.hasPhoto && o.tireLineId ? (
          <img src={api.tireLinePhotoUrl(o.tireLineId, o.photoUpdatedAt)} alt="" />
        ) : (
          <span>No photo</span>
        )}
      </div>

      <div className="cmp-name">
        <strong>{o.brand}</strong> {o.model}
      </div>
      <div className="cmp-specs">
        {o.tireSize}
        {specLabel(o) && ` · ${specLabel(o)}`}
        {o.diffPercent !== undefined && (
          <Badge tone="warning">
            {o.diffPercent > 0 ? '+' : ''}
            {o.diffPercent}% height
          </Badge>
        )}
      </div>
      <ul className="cmp-facts">
        <li>{kindLabel(o) || 'Type and season not set'}</li>
        <li>{warrantyLabel(o.warrantyMiles) ?? 'Warranty not listed'}</li>
        {utqgLabel(o) && (
          <li title="UTQG: treadwear, traction, temperature">
            Treadwear {o.utqgTreadwear} <span className="cmp-muted">· UTQG {utqgLabel(o)}</span>
          </li>
        )}
        {o.treadDepth32nds && <li>{o.treadDepth32nds}/32" tread when new</li>}
        {!customerView && maxLoadLabel(o) && <li className="cmp-muted">Max load {maxLoadLabel(o)}</li>}
        {!customerView && o.sidewall && <li className="cmp-muted">{sidewallLabel(o.sidewall)}</li>}
        {(o.roadHazard || o.severeSnow || o.runFlat || o.evRated) && (
          <li className="cmp-feature-badges">
            {o.roadHazard && <Badge tone="success">Road hazard included</Badge>}
            {o.severeSnow && <Badge>Severe snow</Badge>}
            {o.runFlat && <Badge>Run-flat</Badge>}
            {o.evRated && <Badge>EV-rated</Badge>}
          </li>
        )}
      </ul>

      <div className="cmp-availability">
        <AvailabilityBadge option={o} customerView={customerView} />
        {!customerView && o.availability !== 'in_stock' && age && <span className="cmp-muted"> cost {age}</span>}
      </div>

      {!customerView && !!o.misses?.length && (
        <div className="cmp-miss">Doesn’t match: {o.misses.join(' · ')}</div>
      )}

      {o.warnings.length > 0 && (
        <ul className="cmp-warnings">
          {o.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <div className="cmp-price">
        <div className="cmp-each">{formatMoney(o.price)} each</div>
        {otd && (
          <>
            <div className="cmp-total">{formatMoney(otd.total)}</div>
            <div className="cmp-muted">
              out the door for {quantity}
              {!customerView && ` · tires ${formatMoney(otd.tires)} + install ${formatMoney(otd.mountBalance + otd.disposal)} + tax ${formatMoney(otd.tax)}`}
            </div>
          </>
        )}
      </div>

      {!customerView && (
        <div className="cmp-card-actions">
          {editingCost ? (
            <span className="cmp-cost-edit">
              <input
                className="ed-input"
                inputMode="decimal"
                aria-label="Today's cost"
                value={cost}
                autoFocus
                onChange={(e) => setCost(e.target.value)}
              />
              <Button
                size="sm"
                variant="primary"
                disabled={busy || !(Number(cost) >= 0) || cost === ''}
                onClick={() => {
                  onCost(Number(cost))
                  setEditingCost(false)
                }}
              >
                Save cost
              </Button>
            </span>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setEditingCost(true)} title="Today's cost from the supplier">
              Update cost
            </Button>
          )}
          {swapChoices && swapChoices.length > 0 && onSwap && (
            <select className="ed-input cmp-swap" value="" onChange={(e) => e.target.value && onSwap(e.target.value)} aria-label="Swap for another tire">
              <option value="">Swap…</option>
              {swapChoices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.brand} {c.model} · {formatMoney(c.price)}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      <Button variant="primary" disabled={busy || o.price === null} onClick={onPick}>
        {customerView ? 'Choose this tire' : 'Pick this tire'}
      </Button>
    </article>
  )
}

export default OptionCard
