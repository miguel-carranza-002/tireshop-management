import { useCallback, useState, type ReactNode } from 'react'
import { Button } from './Button'
import { FormField } from './FormField'
import { Modal } from './Modal'

type ConfirmOptions = {
  title: string
  message?: ReactNode
  confirmLabel?: string
  danger?: boolean
}

type PromptOptions = {
  title: string
  label: string
  message?: ReactNode
  initial?: string
  placeholder?: string
  confirmLabel?: string
  // Blank answers are refused unless this is false.
  required?: boolean
  multiline?: boolean
}

type Pending =
  | ({ kind: 'confirm'; resolve: (ok: boolean) => void } & ConfirmOptions)
  | ({ kind: 'prompt'; resolve: (value: string | null) => void } & PromptOptions)

// Promise-based confirm/prompt in real dialogs, in place of window.confirm and
// window.prompt:  if (await dialogs.confirm({ title: 'Remove?' })) ...
// Render {dialogs.dialog} once in the component that uses it.
export function useDialogs() {
  const [pending, setPending] = useState<Pending | null>(null)
  const [value, setValue] = useState('')

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setPending({ kind: 'confirm', resolve, ...options })),
    [],
  )

  const prompt = useCallback(
    (options: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        setValue(options.initial ?? '')
        setPending({ kind: 'prompt', resolve, ...options })
      }),
    [],
  )

  function cancel() {
    if (!pending) return
    if (pending.kind === 'confirm') pending.resolve(false)
    else pending.resolve(null)
    setPending(null)
  }

  function accept() {
    if (!pending) return
    if (pending.kind === 'confirm') pending.resolve(true)
    else {
      if (pending.required !== false && value.trim() === '') return
      pending.resolve(value.trim())
    }
    setPending(null)
  }

  const blank = pending?.kind === 'prompt' && pending.required !== false && value.trim() === ''

  const dialog = pending && (
    <Modal
      open
      title={pending.title}
      onClose={cancel}
      onSubmit={accept}
      footer={
        <>
          <Button variant="ghost" onClick={cancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant={pending.kind === 'confirm' && pending.danger ? 'danger' : 'primary'}
            disabled={blank}
          >
            {pending.confirmLabel ?? (pending.kind === 'confirm' ? 'Confirm' : 'Save')}
          </Button>
        </>
      }
    >
      {pending.message && <p className="ui-dialog-message">{pending.message}</p>}
      {pending.kind === 'prompt' && (
        <FormField label={pending.label}>
          {pending.multiline ? (
            <textarea autoFocus rows={3} value={value} placeholder={pending.placeholder} onChange={(e) => setValue(e.target.value)} />
          ) : (
            <input autoFocus value={value} placeholder={pending.placeholder} onChange={(e) => setValue(e.target.value)} />
          )}
        </FormField>
      )}
    </Modal>
  )

  return { confirm, prompt, dialog }
}

export type Dialogs = ReturnType<typeof useDialogs>
