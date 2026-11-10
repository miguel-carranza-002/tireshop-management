import { useEffect, useState } from 'react'
import { api, AUTH_REQUIRED, type CurrentUser } from './api'
import SignInScreen from './components/auth/SignInScreen'
import UserMenu from './components/auth/UserMenu'
import AccountsPage from './components/accounts/AccountsPage'
import CustomersPage from './components/customers/CustomersPage'
import InventoryPage from './components/inventory/InventoryPage'
import Sidebar from './components/layout/Sidebar'
import LowStockPage from './components/lowStock/LowStockPage'
import OrdersPage from './components/orders/OrdersPage'
import QuotesPage from './components/quotes/QuotesPage'
import SettingsPage from './components/settings/SettingsPage'
import ShopFloorPage from './components/shop/ShopFloorPage'
import { pageLabels, useRoute, type Page } from './router'
import './App.css'

const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })

// Who is signed in decides what shows: the first-run setup, the sign-in
// screen, or the app.
type Session = { state: 'loading' } | { state: 'signedOut'; needsSetup: boolean } | { state: 'signedIn'; user: CurrentUser }

function App() {
  const [session, setSession] = useState<Session>({ state: 'loading' })
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    api
      .me()
      .then(({ user, needsSetup }) =>
        setSession(user ? { state: 'signedIn', user } : { state: 'signedOut', needsSetup }),
      )
      .catch(() => setLoadError('Can’t reach the shop server. Check that it’s running, then reload.'))
    // Any request refused for a missing session sends us back to sign in.
    const signedOut = () => setSession({ state: 'signedOut', needsSetup: false })
    window.addEventListener(AUTH_REQUIRED, signedOut)
    return () => window.removeEventListener(AUTH_REQUIRED, signedOut)
  }, [])

  if (session.state === 'loading') {
    return loadError ? <p className="app-load-error">{loadError}</p> : null
  }
  if (session.state === 'signedOut') {
    return (
      <SignInScreen
        setup={session.needsSetup}
        onSignedIn={(user) => setSession({ state: 'signedIn', user })}
      />
    )
  }
  return (
    <Shop
      // A different person signing in starts from a fresh screen.
      key={session.user.id}
      user={session.user}
      onSignedOut={() => setSession({ state: 'signedOut', needsSetup: false })}
    />
  )
}

function Shop({ user, onSignedOut }: { user: CurrentUser; onSignedOut: () => void }) {
  const [{ page, ticketId }, navigate] = useRoute()
  const [lowStockCount, setLowStockCount] = useState(0)
  const [callCount, setCallCount] = useState(0)
  const [toOrderCount, setToOrderCount] = useState(0)
  // The sidebar is a slide-out menu on narrow screens.
  const [menuOpen, setMenuOpen] = useState(false)

  // Stock and arrivals move as work is accepted, received and finished, so
  // recheck the sidebar counts on every page change.
  useEffect(() => {
    const controller = new AbortController()
    api
      .lowStock(controller.signal)
      .then((data) => setLowStockCount(data.items.filter((i) => i.suggestedQty > 0).length))
      .catch(() => {})
    api
      .callList(controller.signal)
      .then((data) => setCallCount(data.tickets.length))
      .catch(() => {})
    // Accepted special orders land in Needs ordering on their own; the count
    // keeps them in sight until someone places the order.
    api
      .listOrders('needed', controller.signal)
      .then((data) => setToOrderCount(data.counts.needed))
      .catch(() => {})
    return () => controller.abort()
  }, [page])

  function go(next: Page) {
    setMenuOpen(false)
    // Choosing Quotes again goes back to the list.
    navigate({ page: next, ticketId: null })
  }

  function openTicket(id: string | null) {
    navigate({ page: 'quotes', ticketId: id })
  }

  return (
    <div className="app-shell">
      <Sidebar
        page={page}
        open={menuOpen}
        counts={{ lowStock: lowStockCount, orders: toOrderCount + callCount }}
        onNavigate={go}
      />
      {menuOpen && <div className="sidebar-scrim" onClick={() => setMenuOpen(false)} />}

      <div className="app-body">
        <header className="topbar">
          <button
            type="button"
            className="topbar-menu"
            aria-label="Open menu"
            onClick={() => setMenuOpen(true)}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
          <span className="topbar-title">{pageLabels[page]}</span>
          <span className="topbar-date">{today}</span>
          <UserMenu user={user} onSignedOut={onSignedOut} />
        </header>

        <main className="app-main">
          {page === 'shop' && <ShopFloorPage onOpenTicket={openTicket} />}
          {page === 'customers' && <CustomersPage onOpenTicket={openTicket} />}
          {page === 'quotes' && <QuotesPage ticketId={ticketId} onOpenTicket={openTicket} />}
          {page === 'orders' && <OrdersPage onOpenTicket={openTicket} />}
          {page === 'accounts' && <AccountsPage onOpenTicket={openTicket} />}
          {page === 'inventory' && <InventoryPage />}
          {page === 'settings' && <SettingsPage user={user} />}
          {page === 'lowStock' && (
            <LowStockPage onGoToOrders={() => go('orders')} onCountChange={setLowStockCount} />
          )}
        </main>
      </div>
    </div>
  )
}

export default App
