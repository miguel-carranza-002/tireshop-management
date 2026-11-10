import { useEffect, useState } from 'react'
import { api, formatDateTime, type Role, type User } from '../../api'
import { Alert, Badge, Button, FormField, Modal, Panel, Table, useDialogs } from '../../ui'

type Editing = { user: User | null } // null = a new login

// Admin only: the logins for the service advisors.
function UsersPanel({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<User[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  // Bumped to reload the list after a change.
  const [version, setVersion] = useState(0)
  const dialogs = useDialogs()

  useEffect(() => {
    const controller = new AbortController()
    api
      .listUsers(controller.signal)
      .then(({ users }) => setUsers(users))
      .catch((err) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not load logins')
      })
    return () => controller.abort()
  }, [version])

  const load = () => setVersion((v) => v + 1)

  async function run(action: () => Promise<unknown>, message: string) {
    setError(null)
    setNotice(null)
    try {
      await action()
      setNotice(message)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  async function resetPassword(u: User) {
    const password = await dialogs.prompt({
      title: `New password for ${u.displayName}`,
      label: 'New password',
      message: 'They’ll be signed out and need this password next time. At least 8 characters.',
      confirmLabel: 'Set password',
    })
    if (password) void run(() => api.resetPassword(u.id, password), `New password set for ${u.displayName}.`)
  }

  async function toggleActive(u: User) {
    if (u.active) {
      const ok = await dialogs.confirm({
        title: `Turn off ${u.displayName}’s login?`,
        message: 'They’re signed out and can’t sign in again until it’s turned back on. Their name stays on past tickets.',
        confirmLabel: 'Turn off',
        danger: true,
      })
      if (!ok) return
    }
    void run(
      () => api.updateUser(u.id, { displayName: u.displayName, role: u.role, active: !u.active }),
      `${u.displayName}’s login is ${u.active ? 'off' : 'back on'}.`,
    )
  }

  return (
    <Panel
      title="Logins"
      description="Who can sign in. Admins can also change settings and manage logins."
      actions={
        <Button size="sm" onClick={() => setEditing({ user: null })}>
          Add login
        </Button>
      }
      flush
    >
      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      {users && (
        <Table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Username</th>
              <th>Role</th>
              <th>Last signed in</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.active ? undefined : 'settings-user-off'}>
                <td>
                  {u.displayName}
                  {u.id === currentUserId && <span className="settings-you"> (you)</span>}
                </td>
                <td>{u.username}</td>
                <td>
                  {u.role === 'admin' ? <Badge tone="accent">Admin</Badge> : <Badge>Advisor</Badge>}
                  {!u.active && <Badge tone="warning">Off</Badge>}
                </td>
                <td>{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Never'}</td>
                <td className="settings-user-actions">
                  <Button size="sm" variant="ghost" onClick={() => setEditing({ user: u })}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void resetPassword(u)}>
                    {u.id === currentUserId ? 'Set password' : 'Reset password'}
                  </Button>
                  {u.id !== currentUserId && (
                    <Button size="sm" variant="ghost" onClick={() => void toggleActive(u)}>
                      {u.active ? 'Turn off' : 'Turn on'}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {editing && (
        <UserDialog
          user={editing.user}
          isSelf={editing.user?.id === currentUserId}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null)
            setNotice(message)
            setError(null)
            load()
          }}
        />
      )}
      {dialogs.dialog}
    </Panel>
  )
}

function UserDialog({
  user,
  isSelf,
  onClose,
  onSaved,
}: {
  user: User | null
  isSelf: boolean
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [username, setUsername] = useState(user?.username ?? '')
  const [role, setRole] = useState<Role>(user?.role ?? 'advisor')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      if (user) {
        await api.updateUser(user.id, { displayName, role, active: user.active })
        onSaved(`Saved ${displayName}.`)
      } else {
        await api.createUser({ displayName, username, role, password })
        onSaved(`${displayName} can now sign in as “${username.trim().toLowerCase()}”.`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      title={user ? `Edit ${user.displayName}` : 'Add a login'}
      onClose={onClose}
      onSubmit={() => void save()}
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {user ? 'Save' : 'Add login'}
          </Button>
        </>
      }
    >
      <div className="settings-user-form">
        {error && <Alert tone="danger">{error}</Alert>}
        <FormField label="Name" required hint="Shown on tickets they write">
          <input autoFocus required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </FormField>
        <FormField
          label="Username"
          required
          hint={user ? 'Usernames can’t be changed' : 'Letters, numbers, dots, dashes or underscores'}
        >
          <input
            required
            disabled={!!user}
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </FormField>
        <FormField label="Role" hint={isSelf ? 'You can’t remove your own admin access' : undefined}>
          <select value={role} disabled={isSelf} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="advisor">Advisor: quotes, work orders, invoices, inventory</option>
            <option value="admin">Admin: also settings and logins</option>
          </select>
        </FormField>
        {!user && (
          <FormField label="Password" required hint="At least 8 characters. They can change it after signing in.">
            <input type="password" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </FormField>
        )}
      </div>
    </Modal>
  )
}

export default UsersPanel
