// A URL per screen, kept in the hash (#/tickets/1002) so it needs no server
// setup: refreshing keeps your place and the browser's Back button works.
import { useCallback, useSyncExternalStore } from 'react'

export type Page =
  | 'shop'
  | 'customers'
  | 'quotes'
  | 'orders'
  | 'accounts'
  | 'inventory'
  | 'lowStock'
  | 'settings'

// What each screen is called in the sidebar and top bar.
export const pageLabels: Record<Page, string> = {
  shop: 'Shop floor',
  quotes: 'Quotes & work orders',
  customers: 'Customers',
  orders: 'Orders',
  inventory: 'Inventory',
  lowStock: 'Low stock',
  accounts: 'Accounts',
  settings: 'Settings',
}

export type Route = { page: Page; ticketId: string | null }

const paths: Record<Page, string> = {
  shop: 'shop',
  customers: 'customers',
  quotes: 'tickets',
  orders: 'orders',
  accounts: 'accounts',
  inventory: 'inventory',
  lowStock: 'low-stock',
  settings: 'settings',
}

const pageByPath = Object.fromEntries(Object.entries(paths).map(([page, path]) => [path, page])) as Record<
  string,
  Page
>

export function parseHash(hash: string): Route {
  const [path = '', id] = hash.replace(/^#\/?/, '').split('/')
  const page = pageByPath[path] ?? 'shop'
  return { page, ticketId: page === 'quotes' && id && /^\d+$/.test(id) ? id : null }
}

export function hashFor(route: Route): string {
  const base = `#/${paths[route.page]}`
  return route.page === 'quotes' && route.ticketId ? `${base}/${route.ticketId}` : base
}

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

const getHash = () => window.location.hash

export function useRoute(): [Route, (route: Route) => void] {
  const hash = useSyncExternalStore(subscribe, getHash)
  const navigate = useCallback((route: Route) => {
    const next = hashFor(route)
    if (next !== window.location.hash) window.location.hash = next
  }, [])
  return [parseHash(hash), navigate]
}
