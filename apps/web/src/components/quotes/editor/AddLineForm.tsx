import { useState, type FormEvent } from 'react'
import type { NewLineInput, OrderKind, WorkItemType } from '../../../api'
import { Button } from '../../../ui'

type Kind = NewLineInput['kind']

const kindLabels: Record<Kind, string> = {
  tpms_sensor: 'TPMS sensor',
  tpms_reset: 'TPMS reset (customer sensors)',
  trailer_valve_stem: 'Trailer valve stem',
  labor: 'Labor (hours × shop rate)',
  part: 'Part (supplier list price)',
  custom: 'Other item (rims, one-offs)',
}

const kindsByType: Record<WorkItemType, Kind[]> = {
  tires: ['tpms_sensor', 'tpms_reset', 'trailer_valve_stem', 'custom'],
  mechanic: ['labor', 'part', 'custom'],
  alignment: ['part', 'custom'],
  other: ['custom', 'tpms_sensor'],
}

type Props = {
  itemType: WorkItemType
  // Customers can see the screen, so the cost box only shows when costs are on.
  showCosts: boolean
  // On a work order, parts and other items can be ordered as they're added.
  onWorkOrder: boolean
  onAdd: (input: NewLineInput) => void
}

function AddLineForm({ itemType, showCosts, onWorkOrder, onAdd }: Props) {
  const kinds = kindsByType[itemType]
  const [kind, setKind] = useState<Kind>(kinds[0])
  const [description, setDescription] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [price, setPrice] = useState('')
  const [cost, setCost] = useState('')
  const [taxable, setTaxable] = useState(true)
  const [order, setOrder] = useState(true)
  const [orderKind, setOrderKind] = useState<OrderKind>('other')

  const needsDescription = kind === 'part' || kind === 'custom'
  const needsPrice = kind === 'part' || kind === 'custom'

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const qty = Number(quantity)
    const unitCost = cost.trim() === '' ? null : Number(cost)

    let input: NewLineInput
    switch (kind) {
      case 'part':
        input = {
          kind,
          description,
          quantity: qty,
          unitPrice: Number(price),
          unitCost,
          order: onWorkOrder && order,
        }
        break
      case 'custom':
        input = {
          kind,
          description,
          quantity: qty,
          unitPrice: Number(price),
          unitCost,
          taxable,
          order: onWorkOrder && order,
          orderKind,
        }
        break
      case 'labor':
        input = { kind, quantity: qty, description: description || undefined }
        break
      default:
        input = { kind, quantity: qty }
    }

    onAdd(input)
    setDescription('')
    setQuantity('1')
    setPrice('')
    setCost('')
  }

  return (
    <form className="ed-add-line" onSubmit={handleSubmit}>
      <select
        className="ed-input"
        value={kind}
        onChange={(e) => setKind(e.target.value as Kind)}
        aria-label="Line type"
      >
        {kinds.map((k) => (
          <option key={k} value={k}>
            {kindLabels[k]}
          </option>
        ))}
      </select>

      {(needsDescription || kind === 'labor') && (
        <input
          className="ed-input ed-grow"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={kind === 'labor' ? 'Labor description (optional)' : 'Description'}
          required={needsDescription}
          aria-label="Description"
        />
      )}

      <input
        className="ed-input ed-short"
        inputMode="decimal"
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        aria-label={kind === 'labor' ? 'Hours' : 'Quantity'}
        title={kind === 'labor' ? 'Hours' : 'Quantity'}
        required
      />

      {needsPrice && (
        <>
          <input
            className="ed-input ed-short"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder={kind === 'part' ? 'List price' : 'Price'}
            aria-label="Price each"
            required
          />
          {showCosts && (
            <input
              className="ed-input ed-short ed-internal-input"
              inputMode="decimal"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="Our cost"
              aria-label="Our cost each (internal)"
              title="Internal only. Never shown to the customer."
            />
          )}
        </>
      )}

      {kind === 'custom' && (
        <label className="ed-check">
          <input
            type="checkbox"
            checked={taxable}
            onChange={(e) => setTaxable(e.target.checked)}
          />
          Taxable
        </label>
      )}

      {onWorkOrder && needsPrice && (
        <>
          <label className="ed-check">
            <input type="checkbox" checked={order} onChange={(e) => setOrder(e.target.checked)} />
            Order it
          </label>
          {kind === 'custom' && order && (
            <select
              className="ed-input"
              value={orderKind}
              onChange={(e) => setOrderKind(e.target.value as OrderKind)}
              aria-label="What is being ordered"
            >
              <option value="other">Other item</option>
              <option value="rim">Rim (can’t be returned)</option>
            </select>
          )}
        </>
      )}

      <Button type="submit" size="sm">
        Add line
      </Button>
    </form>
  )
}

export default AddLineForm
