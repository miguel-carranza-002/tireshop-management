import { useEffect, useRef, useState } from 'react'
import { api, type CurrentUser } from '../../api'
import { Alert, Button, FormField, Modal } from '../../ui'
import './Auth.css'

// Name in the top bar, with Change password and Sign out.
function UserMenu({ user, onSignedOut }: { user: CurrentUser; onSignedOut: () => void }) {
  const [open, setOpen] = useState(false)
  const [changing, setChanging] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function close(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  async function signOut() {
    await api.logout().catch(() => {})
    onSignedOut()
  }

  return (
    <div className="auth-menu" ref={ref}>
      <button
        type="button"
        className="auth-menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="auth-avatar" aria-hidden="true">
          {user.displayName.trim().charAt(0).toUpperCase()}
        </span>
        <span className="auth-menu-name">{user.displayName}</span>
      </button>
      {open && (
        <div className="auth-menu-list" role="menu">
          <div className="auth-menu-who">
            {user.displayName}
            <span>
              {user.username} · {user.role === 'admin' ? 'Admin' : 'Advisor'}
            </span>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              setChanging(true)
            }}
          >
            Change password
          </button>
          <button type="button" role="menuitem" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      )}
      {changing && <ChangePasswordDialog onClose={() => setChanging(false)} />}
    </div>
  )
}

function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  async function save() {
    if (next !== again) {
      setError('The two new passwords don’t match')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.changePassword(current, next)
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      title="Change password"
      onClose={onClose}
      onSubmit={done ? onClose : () => void save()}
      width={400}
      footer={
        done ? (
          <Button type="submit" variant="primary">
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy || !current || !next}>
              Change password
            </Button>
          </>
        )
      }
    >
      {done ? (
        <Alert tone="success">Password changed. Use the new one next time you sign in.</Alert>
      ) : (
        <div className="auth-stack">
          {error && <Alert tone="danger">{error}</Alert>}
          <FormField label="Current password">
            <input type="password" autoFocus autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </FormField>
          <FormField label="New password" hint="At least 8 characters">
            <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </FormField>
          <FormField label="New password again">
            <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
          </FormField>
        </div>
      )}
    </Modal>
  )
}

export default UserMenu
