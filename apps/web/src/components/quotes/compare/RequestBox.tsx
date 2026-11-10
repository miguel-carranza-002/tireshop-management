import { useState } from 'react'
import { api, type TireRequest } from '../../../api'
import { Button } from '../../../ui'

type Props = {
  ticketId: string
  quantity: number
  onRead: (request: TireRequest) => void
}

// Type what the customer asked for; it sets the count, size and filters.
// Says what it read and what it couldn't, so nothing is silently guessed.
function RequestBox({ ticketId, quantity, onRead }: Props) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<TireRequest | null>(null)
  const [error, setError] = useState<string | null>(null)

  function read() {
    if (!text.trim() || busy) return
    setBusy(true)
    setError(null)
    api
      .readTireRequest(ticketId, text.trim(), quantity)
      .then((r) => {
        setLast(r)
        onRead(r)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not read that'))
      .finally(() => setBusy(false))
  }

  return (
    <div className="cmp-request">
      <form
        className="cmp-request-row"
        onSubmit={(e) => {
          e.preventDefault()
          read()
        }}
      >
        <input
          autoFocus
          aria-label="What the customer wants"
          placeholder="What does the customer want? e.g. 4 215/55R16 road hazard, 40k+ warranty, under $150"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit" variant="primary" disabled={busy || !text.trim()}>
          Find tires
        </Button>
      </form>
      {error && <p className="cmp-request-unread">{error}</p>}
      {last && (
        <p className="cmp-muted">
          {last.understood.length ? `Read as: ${last.understood.join(' · ')}` : 'Nothing in that could be read.'}
          {last.unread.length > 0 && (
            <span className="cmp-request-unread"> Not understood: {last.unread.join(' ')}. Set those by hand.</span>
          )}
        </p>
      )}
    </div>
  )
}

export default RequestBox
