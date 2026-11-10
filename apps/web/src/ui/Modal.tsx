import { useEffect, useRef, type FormEvent, type ReactNode } from 'react'

type Props = {
  open: boolean
  title: ReactNode
  onClose: () => void
  // When set, the body is a form and Enter submits it.
  onSubmit?: () => void
  footer?: ReactNode
  children: ReactNode
  width?: number
}

// A real dialog in place of window.prompt/confirm. Escape and the backdrop close it.
export function Modal({ open, title, onClose, onSubmit, footer, children, width = 480 }: Props) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  function submit(e: FormEvent) {
    e.preventDefault()
    onSubmit?.()
  }

  const content = (
    <>
      <header className="ui-modal-header">
        <h2 className="ui-modal-title">{title}</h2>
        <button type="button" className="ui-modal-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="ui-modal-body">{children}</div>
      {footer && <footer className="ui-modal-footer">{footer}</footer>}
    </>
  )

  return (
    <dialog
      ref={ref}
      className="ui-modal"
      style={{ width }}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
    >
      {onSubmit ? <form onSubmit={submit}>{content}</form> : content}
    </dialog>
  )
}
