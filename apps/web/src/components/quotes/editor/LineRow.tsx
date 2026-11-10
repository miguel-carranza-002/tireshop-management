import { useState, type KeyboardEvent } from 'react'
import { formatMoney, type LineItem, type LineUpdate } from '../../../api'
import { Badge } from '../../../ui'

type Props = {
  line: LineItem
  editable: boolean
  // Work orders show what's reserved or on order for each line.
  showStock: boolean
  showCosts: boolean
  onUpdate: (input: LineUpdate) => void
  onDelete: () => void
}

// One line. Editable fields save when you leave them or press Enter.
function LineRow({ line, editable, showStock, showCosts, onUpdate, onDelete }: Props) {
  const [quantity, setQuantity] = useState(String(line.quantity))
  const [price, setPrice] = useState(line.unitPrice.toFixed(2))
  const [discountValue, setDiscountValue] = useState(line.discountType ? String(line.discountValue) : '')

  const qtyEditable = editable && !line.generated
  const isLabor = line.lineKind === 'labor'

  function commitQuantity() {
    const value = Number(quantity)
    if (quantity.trim() === '' || !Number.isFinite(value) || value === line.quantity) {
      setQuantity(String(line.quantity))
      return
    }
    onUpdate({ quantity: value })
  }

  function commitPrice() {
    const value = Number(price)
    if (price.trim() === '' || !Number.isFinite(value) || value === line.unitPrice) {
      setPrice(line.unitPrice.toFixed(2))
      return
    }
    onUpdate({ unitPrice: value })
  }

  function commitDiscount(type: LineItem['discountType'], rawValue: string) {
    if (type === null) {
      if (line.discountType !== null) onUpdate({ discountType: null })
      setDiscountValue('')
      return
    }
    const value = Number(rawValue || 0)
    if (!Number.isFinite(value) || value < 0) {
      setDiscountValue(line.discountType ? String(line.discountValue) : '')
      return
    }
    if (type === line.discountType && value === line.discountValue) return
    onUpdate({ discountType: type, discountValue: value })
  }

  const onEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur()
  }

  const lineCost = line.unitCost === null ? null : Math.round(line.unitCost * line.quantity * 100) / 100

  return (
    <tr>
      <td className="ed-line-description">
        <span>{line.description}</span>
        <span className="ed-line-tags">
          {!line.taxable && <Badge>no tax</Badge>}
          {showStock && line.reservedQty > 0 && <Badge tone="success">{line.reservedQty} reserved</Badge>}
          {showStock && line.onOrderQty > 0 && <Badge tone="warning">{line.onOrderQty} on order</Badge>}
          {showStock && line.orderStatuses?.includes('arrived') && line.onOrderQty === 0 && (
            <Badge tone="success">arrived</Badge>
          )}
          {line.priceOverridden && (
            <Badge tone="warning">
              price changed
              {editable && (
                <button type="button" className="ed-inline-link" onClick={() => onUpdate({ resetPrice: true })}>
                  reset
                </button>
              )}
            </Badge>
          )}
        </span>
      </td>

      <td className="num">
        {qtyEditable ? (
          <input
            className="ed-cell-input ed-cell-qty"
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            onBlur={commitQuantity}
            onKeyDown={onEnter}
            aria-label={isLabor ? 'Hours' : 'Quantity'}
          />
        ) : (
          line.quantity
        )}
        {isLabor && <span className="ed-unit"> h</span>}
      </td>

      <td className="num">
        {editable ? (
          <input
            className="ed-cell-input"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            onBlur={commitPrice}
            onKeyDown={onEnter}
            aria-label="Unit price"
          />
        ) : (
          formatMoney(line.unitPrice)
        )}
      </td>

      <td className="num">
        {editable ? (
          <span className="ed-discount">
            <select
              className="ed-cell-select"
              value={line.discountType ?? ''}
              onChange={(e) => commitDiscount((e.target.value || null) as LineItem['discountType'], discountValue)}
              aria-label="Discount type"
            >
              <option value="">—</option>
              <option value="amount">$</option>
              <option value="percent">%</option>
            </select>
            {line.discountType && (
              <input
                className="ed-cell-input ed-cell-qty"
                inputMode="decimal"
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                onBlur={() => commitDiscount(line.discountType, discountValue)}
                onKeyDown={onEnter}
                aria-label="Discount amount"
              />
            )}
          </span>
        ) : line.discount > 0 ? (
          `−${formatMoney(line.discount)}`
        ) : (
          ''
        )}
      </td>

      <td className="num ed-line-total">{formatMoney(line.net)}</td>

      {showCosts && <td className="num ed-internal">{lineCost === null ? '—' : formatMoney(lineCost)}</td>}

      <td className="ed-row-actions">
        {editable && !line.generated && (
          <button
            type="button"
            className="ed-remove"
            onClick={onDelete}
            aria-label={`Remove ${line.description}`}
            title="Remove line"
          >
            ×
          </button>
        )}
      </td>
    </tr>
  )
}

export default LineRow
