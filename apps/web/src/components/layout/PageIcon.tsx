// Small line icons for the sidebar (16px, stroke uses the current text color).
import type { ReactNode } from 'react'
import type { Page } from '../../router'

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

const icons: Record<Page, ReactNode> = {
  // Lift / bays
  shop: (
    <Icon>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M3 12h18M12 4v16" />
    </Icon>
  ),
  // Document
  quotes: (
    <Icon>
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v4h4M10 12h5M10 16h5" />
    </Icon>
  ),
  customers: (
    <Icon>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.6.8 2.6 2.5 3 5.2" />
    </Icon>
  ),
  // Truck
  orders: (
    <Icon>
      <path d="M2 6h11v10H2zM13 9h4l4 4v3h-8" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="17" cy="18" r="2" />
    </Icon>
  ),
  // Tire
  inventory: (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v5M12 16v5M3 12h5M16 12h5" />
    </Icon>
  ),
  lowStock: (
    <Icon>
      <path d="M12 3 2 20h20z" />
      <path d="M12 10v4M12 17.5v.5" />
    </Icon>
  ),
  // Sliders
  settings: (
    <Icon>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </Icon>
  ),
  // Ledger
  accounts: (
    <Icon>
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </Icon>
  ),
}

function PageIcon({ page }: { page: Page }) {
  return icons[page]
}

export default PageIcon
