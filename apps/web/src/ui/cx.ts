// Join class names, skipping empty ones: cx('a', on && 'b').
export function cx(...names: (string | false | null | undefined)[]) {
  return names.filter(Boolean).join(' ')
}
