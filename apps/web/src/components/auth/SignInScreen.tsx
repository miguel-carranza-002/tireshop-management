import { useState, type FormEvent } from 'react'
import { api, type CurrentUser } from '../../api'
import { Alert, Button, FormField } from '../../ui'
import './Auth.css'

type Props = {
  // First run: no logins exist yet, so this creates the first admin.
  setup: boolean
  onSignedIn: (user: CurrentUser) => void
}

function SignInScreen({ setup, onSignedIn }: Props) {
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (setup && password !== confirm) {
      setError('The two passwords don’t match')
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (setup) await api.setup({ displayName, username, password })
      else await api.login(username, password)
      const { user } = await api.me()
      if (!user) throw new Error('Could not sign in')
      onSignedIn(user)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in')
      setBusy(false)
    }
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <span className="sidebar-logo">TS</span>
          <span className="sidebar-name">Tire Shop</span>
        </div>
        <h1 className="auth-title">{setup ? 'Create the admin login' : 'Sign in'}</h1>
        {setup && (
          <p className="auth-lead">
            This is the first login. The admin can change settings and add logins for the other advisors.
          </p>
        )}

        {error && <Alert tone="danger">{error}</Alert>}

        {setup && (
          <FormField label="Your name" required>
            <input autoFocus required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </FormField>
        )}
        <FormField label="Username" required>
          <input
            autoFocus={!setup}
            required
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </FormField>
        <FormField label="Password" required hint={setup ? 'At least 8 characters' : undefined}>
          <input
            type="password"
            required
            autoComplete={setup ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </FormField>
        {setup && (
          <FormField label="Password again" required>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </FormField>
        )}

        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'One moment…' : setup ? 'Create login' : 'Sign in'}
        </Button>
        {!setup && <p className="auth-foot">Forgot your password? Ask the admin to set a new one.</p>}
      </form>
    </div>
  )
}

export default SignInScreen
