// Who is making the current request, available anywhere in the call without
// passing it through every function. Set by the auth middleware.
import { AsyncLocalStorage } from 'node:async_hooks'

export type CurrentUser = {
  id: string
  username: string
  displayName: string
  role: 'admin' | 'advisor'
}

export const requestContext = new AsyncLocalStorage<{ user: CurrentUser | null }>()

export function currentUser(): CurrentUser | null {
  return requestContext.getStore()?.user ?? null
}
