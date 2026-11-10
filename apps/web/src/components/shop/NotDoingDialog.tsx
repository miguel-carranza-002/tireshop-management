import { useState } from 'react'
import type { ShopEntry } from '../../api'
import { Button, FormField, Modal } from '../../ui'

type Props = {
  entry: ShopEntry
  busy: boolean
  onSave: (reason: string, suspensionIssue: boolean, followUp: boolean) => void
  onClose: () => void
}

// A job that won't be done: why, and for an alignment whether the
// suspension is the problem (with an optional follow-up quote for the repair).
function NotDoingDialog({ entry, busy, onSave, onClose }: Props) {
  const isAlignment = entry.itemType === 'alignment'
  const [suspension, setSuspension] = useState(false)
  const [reason, setReason] = useState(isAlignment ? '' : 'Customer declined')
  const [followUp, setFollowUp] = useState(true)
  const valid = reason.trim() !== ''

  return (
    <Modal
      open
      title={`Can’t do it: WO-${entry.ticketNumber} ${entry.year} ${entry.make} ${entry.model}`}
      onClose={onClose}
      onSubmit={() => valid && onSave(reason.trim(), suspension, isAlignment && suspension && followUp)}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !valid}>
            Mark not performed
          </Button>
        </>
      }
    >
      <p className="ui-dialog-message">It stays on the work order for the record but isn’t charged. Reserved stock is released.</p>
      {isAlignment && (
        <fieldset className="sf-choices">
          <legend className="ui-field-label">Why can’t the alignment be done?</legend>
          <label>
            <input type="radio" checked={suspension} onChange={() => setSuspension(true)} /> Suspension issue (worn parts, can’t get in spec)
          </label>
          <label>
            <input type="radio" checked={!suspension} onChange={() => setSuspension(false)} /> Another reason
          </label>
        </fieldset>
      )}
      <FormField label={suspension ? 'What did you find?' : 'Reason'} required>
        <textarea
          autoFocus
          rows={2}
          value={reason}
          placeholder={suspension ? 'e.g. worn inner tie rod ends' : 'e.g. Customer declined'}
          onChange={(e) => setReason(e.target.value)}
        />
      </FormField>
      {isAlignment && suspension && (
        <label className="sf-check">
          <input type="checkbox" checked={followUp} onChange={(e) => setFollowUp(e.target.checked)} /> Start a follow-up quote for the
          suspension repair
        </label>
      )}
    </Modal>
  )
}

export default NotDoingDialog
