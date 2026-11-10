import type { ButtonHTMLAttributes } from 'react'
import { cx } from './cx'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
}

export function Button({ variant = 'secondary', size = 'md', className, type = 'button', ...rest }: Props) {
  return (
    <button
      type={type}
      className={cx('ui-btn', `ui-btn-${variant}`, size === 'sm' && 'ui-btn-sm', className)}
      {...rest}
    />
  )
}
