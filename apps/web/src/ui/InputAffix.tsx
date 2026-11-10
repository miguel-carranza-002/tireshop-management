import type { InputHTMLAttributes } from 'react'

// An input with a unit inside it: "$" before or "%" / "min" after.
export function InputAffix({
  prefix,
  suffix,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { prefix?: string; suffix?: string }) {
  return (
    <span className="ui-affix">
      {prefix && <span className="ui-affix-text">{prefix}</span>}
      <input {...input} />
      {suffix && <span className="ui-affix-text">{suffix}</span>}
    </span>
  )
}
