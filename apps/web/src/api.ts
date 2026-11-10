export type Customer = {
  id: string
  firstName: string
  lastName: string | null
  phone: string | null
  hasAccount: boolean
  notes: string | null
  createdAt: string
}

export type CustomerSummary = Customer & { vehicleCount: number }

export type DriveType = '2wd' | 'awd' | '4wd' | 'unknown'

export type Vehicle = {
  id: string
  customerId: string
  year: number
  make: string
  model: string
  trim: string | null
  vehicleClass: 'car' | 'truck'
  driveType: DriveType
  liftedLowered: boolean
  multiLinkSuspension: boolean
  licensePlate: string | null
  vin: string | null
  // Front size on staggered setups.
  tireSize: string | null
  rearTireSize: string | null
  // Special-tire flags: the only vehicles where load and speed get checked.
  isEv: boolean
  heavyDuty: boolean
  runFlat: boolean
  requiredLoadIndex: number | null
  requiredLoadRange: string | null
  requiredSpeedRating: string | null
}

// What the free NHTSA VIN decoder suggests. Only ever fills empty fields.
export type VinSuggestion = {
  year: number | null
  make: string | null
  model: string | null
  trim: string | null
  vehicleClass: 'car' | 'truck' | null
  driveType: '2wd' | 'awd' | '4wd' | null
  isEv: boolean
  heavyDuty: boolean
  warning: string | null
  source: { driveType: string | null; fuelType: string | null; gvwr: string | null; vehicleType: string | null }
}

export type CustomerDetail = Customer & { vehicles: Vehicle[] }

export type CustomerInput = {
  firstName: string
  lastName: string
  phone: string
  hasAccount: boolean
  notes: string
}

export type VehicleInput = {
  year: string
  make: string
  model: string
  trim: string
  vehicleClass: 'car' | 'truck'
  driveType: DriveType
  liftedLowered: boolean
  multiLinkSuspension: boolean
  licensePlate: string
  vin: string
  tireSize: string
  rearTireSize: string
  isEv: boolean
  heavyDuty: boolean
  runFlat: boolean
  requiredLoadIndex: string
  requiredLoadRange: string
  requiredSpeedRating: string
}

export type Season = 'all_season' | 'all_weather' | 'summer' | 'winter'

// What the tire is built for (season is when it can be driven).
export type TireType = 'touring' | 'performance' | 'highway' | 'all_terrain' | 'rugged_terrain' | 'mud_terrain'

// Brand + model: what every size of a tire shares.
export type TireLine = {
  id: string
  brand: string
  model: string
  tireType: TireType | null
  season: Season | null
  warrantyMiles: number | null
  roadHazard: boolean
  runFlat: boolean
  evRated: boolean
  severeSnow: boolean
  notes: string | null
  hasPhoto: boolean
  photoUpdatedAt: string | null
  sizeCount: number
}

export type TireLineInput = {
  brand: string
  model: string
  tireType: TireType | ''
  season: Season | ''
  warrantyMiles: number | null
  roadHazard: boolean
  runFlat: boolean
  evRated: boolean
  severeSnow: boolean
  notes: string
}

export type Product = {
  id: string
  sku: string
  brand: string
  model: string
  tireSize: string | null
  // Blank for catalog tires nobody has priced yet.
  cost: number | null
  price: number | null
  costUpdatedAt: string | null
  loadIndex: number | null
  loadIndexDual: number | null
  speedRating: string | null
  loadRange: string | null
  extraLoad: boolean
  tireLineId: string | null
  // Specs of this size, from the supplier file or typed in.
  sizeAlt: string | null
  treadDepth32nds: number | null
  utqgTreadwear: number | null
  utqgTraction: string | null
  utqgTemperature: string | null
  maxLoadLbs: number | null
  maxLoadPsi: number | null
  sidewall: string | null
  tireType: TireType | null
  season: Season | null
  // This size's warranty if it has its own, else the line's. 0 = none.
  warrantyMiles: number | null
  sizeWarrantyMiles: number | null
  lineWarrantyMiles?: number | null
  roadHazard: boolean
  runFlat: boolean
  evRated: boolean
  severeSnow: boolean
  hasPhoto: boolean
  photoUpdatedAt: string | null
  productType: 'tire' | 'tpms_sensor'
  condition: 'new' | 'used'
  // false = special order from a supplier, never kept on the shelf.
  stocked: boolean
  minQty: number
  supplier: string | null
  tireClassOverride: 'car' | 'truck' | null
  onHandQty: number
  reservedQty: number
  availableQty: number
  // Open orders not arrived yet (customer and restock).
  onOrderQty: number
}

export type ProductInput = {
  productType: 'tire' | 'tpms_sensor'
  sku: string
  brand: string
  model: string
  tireSize: string
  cost: number | null
  price: number | null
  loadIndex: number | null
  loadIndexDual: number | null
  speedRating: string
  loadRange: string
  extraLoad: boolean
  // Specs of this size, from the supplier file or typed in.
  sizeAlt: string | null
  treadDepth32nds: number | null
  utqgTreadwear: number | null
  utqgTraction: string | null
  utqgTemperature: string | null
  maxLoadLbs: number | null
  maxLoadPsi: number | null
  sidewall: string | null
  sizeWarrantyMiles: number | null
  // Saved on the tire line, shared by every size of this brand and model.
  line?: Omit<TireLineInput, 'brand' | 'model'>
  condition: 'new' | 'used'
  stocked: boolean
  minQty: number
  supplier: string
  tireClassOverride: 'car' | 'truck' | null
  initialQty?: number
}

export type StockMovement = {
  id: string
  movementType: string
  quantityDelta: number
  note: string | null
  createdAt: string
}

export type UpcomingTicket = {
  id: string
  ticketNumber: number
  plannedFor: string | null
  checkedInAt: string | null
  acceptedAt: string
  firstName: string
  lastName: string | null
  phone: string | null
  year: number
  make: string
  model: string
  licensePlate: string | null
  items: { id: string; itemType: WorkItemType; title: string | null; tireQuantity: number | null; queued: boolean }[] | null
  orders:
    | {
        id: string
        description: string
        status: 'needed' | 'ordered' | 'arrived'
        qtyOrdered: number
        qtyArrived: number
        expectedAt: string | null
        vendor: string | null
      }[]
    | null
  expectedBy: string | null
  needsOrdering: boolean
  allIn: boolean
  customerNotifiedAt: string | null
}

export type WorkItemType = 'tires' | 'alignment' | 'mechanic' | 'other'

export type TireInfo = {
  parsed: boolean
  tireClass: 'car' | 'truck'
  lowProfile: boolean
  oversized: boolean
  diameterIn: number | null
}

export type LineItem = {
  id: string
  workItemId: string
  lineKind: 'product' | 'service' | 'labor' | 'part' | 'custom'
  productId: string | null
  serviceCode: string | null
  description: string
  quantity: number
  unitPrice: number
  unitCost: number | null
  taxable: boolean
  discountType: 'amount' | 'percent' | null
  discountValue: number
  generated: boolean
  priceOverridden: boolean
  gross: number
  discount: number
  net: number
  // On a work order, lines from the accepted quote can't be changed.
  locked: boolean
  reservedQty: number
  onOrderQty: number
  orderStatuses: string[] | null
}

export type PendingOrder = {
  id: string
  customerNotifiedAt?: string | null
  lineItemId: string | null
  itemKind: 'tire' | 'rim' | 'tpms_sensor' | 'part' | 'other'
  description: string
  vendor: string | null
  qtyOrdered: number
  qtyArrived: number
  status: 'needed' | 'ordered' | 'arrived' | 'installed' | 'returned' | 'unclaimed' | 'cancelled'
  returnable: boolean
  expectedAt: string | null
}

export type PaymentMethod = 'cash' | 'card' | 'other'

export const methodLabels: Record<PaymentMethod, string> = {
  cash: 'Cash',
  card: 'Card',
  other: 'Other',
}

export type LowStockItem = {
  id: string
  sku: string
  brand: string
  model: string
  tireSize: string | null
  productType: 'tire' | 'tpms_sensor'
  cost: number
  minQty: number
  onHand: number
  reserved: number
  available: number
  onOrder: number
  suggestedQty: number
}

// Everything on the Settings screen. Tax is a fraction (0.08 = 8%).
export type ShopSettings = {
  shopName: string
  shopAddress: string | null
  shopPhone: string | null
  invoiceFooter: string | null
  productsTaxRate: number
  shopRatePerHour: number
  minDeposit: number
  quoteValidDays: number
  tireMarkupPercent: number
  tireMinProfit: number
  usedTireCarPrice: number
  usedTireTruckPrice: number
  mountBalanceCarPrice: number
  mountBalanceTruckPrice: number
  mountBalanceSurcharge: number
  disposalFee: number
  valveStemCustomerSuppliedPrice: number
  trailerValveStemPrice: number
  alignmentCarPrice: number
  alignmentTruckPrice: number
  alignmentSurcharge: number
  tpmsSensorSinglePrice: number
  tpmsSensorMultiPrice: number
  tpmsResetPrice: number
  lowProfileMaxAspect: number
  oversizedMinDiameterIn: number
  alignmentMinutes: number
  tireJobCarMinutes: number
  tireJobTruckMinutes: number
  tireJobMinMinutes: number
}

export type Payment = {
  id: string
  paymentKind: 'deposit' | 'payment' | 'refund' | 'return_fee'
  method: PaymentMethod
  amount: number
  note: string | null
  createdAt: string
  recordedByName: string | null
}

export type OrderKind = 'part' | 'rim' | 'other'

export type Balance = {
  total: number
  returnFees: number
  depositKept: number
  charges: number
  deposits: number
  payments: number
  refunds: number
  paid: number
  balance: number
}

export type InvoiceInput = {
  payments: { method: PaymentMethod; amount: number }[]
  chargeToAccount?: boolean
  refund?: { method: PaymentMethod }
  keepDeposit?: boolean
}

export type OpenInvoice = Balance & {
  id: string
  quoteNumber: number
  invoiceNumber: number
  invoicedAt: string
  paidAt: string | null
  chargedToAccount: boolean
  ageDays: number
  customerId: string
  firstName: string
  lastName: string | null
  phone: string | null
  year: number
  make: string
  model: string
}

export type AcceptInput = {
  orderLines: { lineItemId: string; itemKind: OrderKind }[]
  deposit: { amount: number; method: PaymentMethod } | null
  depositOverrideReason: string | null
  checkIn: boolean
  acknowledgeExpired: boolean
  plannedFor: string | null
}

export type Tier = 'cheap' | 'medium' | 'premium' | 'option'

// A tire option quoted on a Tires item, price locked when quoted.
export type QuotedTireOption = {
  id: string
  position: number
  tier: Tier
  productId: string
  description: string
  tireSize: string
  quantity: number
  unitPrice: number
  unitCost: number | null
  total: number
  createdAt: string
  tireLineId: string | null
  hasPhoto: boolean
  photoUpdatedAt: string | null
  warrantyMiles: number | null
  loadIndex: number | null
  speedRating: string | null
}

// One tire in the comparison, priced out the door for the quantity.
export type CompareOption = Product & {
  availability: 'in_stock' | 'partial' | 'order'
  diameterIn: number | null
  outTheDoor: { tires: number; mountBalance: number; disposal: number; tax: number; total: number } | null
  warnings: string[]
  diffPercent?: number
  // Filters this tire doesn't meet ("no road hazard"); empty when it matches.
  misses?: string[]
}

// Weakest to strongest; a minimum ("E" also shows F).
export const loadLevels = ['SL', 'XL', 'C', 'D', 'E', 'F'] as const
export type LoadLevel = (typeof loadLevels)[number]

export type TireFilters = {
  brands: string[]
  minWarranty: number | null
  season: Season | null
  tireType: TireType | null
  minLoad: LoadLevel | null
  maxPrice: number | null
  roadHazard: boolean
}

// What the advisor typed, as the comparison reads it.
export type TireRequest = {
  quantity: number | null
  size: string | null
  axle: 'front' | 'rear' | null
  filters: TireFilters
  understood: string[]
  unread: string[]
}

export const noFilters: TireFilters = {
  brands: [],
  minWarranty: null,
  season: null,
  tireType: null,
  minLoad: null,
  maxPrice: null,
  roadHazard: false,
}

export type Comparison = {
  vehicleSize: string | null
  staggered: boolean
  axle: 'front' | 'rear' | null
  quantity: number
  banner: string | null
} & (
  | { size: null; needsSize: true }
  | {
      size: string
      needsSize: false
      // Every brand in the catalog, for the brand filter (missing from an older API).
      brands?: string[]
      // Set when nothing on the shelf meets every filter (closest shown).
      filterNote: string | null
      tiers: { tier: Tier; option: CompareOption }[]
      others: CompareOption[]
      // Not on the shelf for the whole job: added by the advisor with today's cost.
      orderIn: CompareOption[]
      // Picked by the advisor from the whole catalog (any size).
      added: CompareOption[]
      used: CompareOption[]
      alternates: {
        allowed: boolean
        reason: string | null
        sizes: { size: string; diameterIn: number; diffPercent: number }[]
        options: CompareOption[]
      }
    }
)

export type WorkItem = {
  id: string
  itemType: WorkItemType
  title: string | null
  status: 'pending' | 'completed' | 'not_performed'
  customerSuppliedTires: boolean
  tireProductId: string | null
  tireQuantity: number | null
  oldTiresRemoved: number | null
  customerTireSize: string | null
  difficultyMinutes: number
  tireInfo: TireInfo | null
  lines: LineItem[]
  subtotal: number
  addedOnWorkOrder: boolean
  notPerformedReason: string | null
  completedAt: string | null
  // Options quoted and waiting for the customer to pick one.
  optionsSize: string | null
  tireOptions: QuotedTireOption[]
}

export type Queue = 'tires' | 'mechanic' | 'alignment'

export type ShopEntry = {
  id: string
  workItemId: string
  ticketId: string
  ticketNumber: number
  queue: Queue
  status: 'waiting' | 'on_lift'
  readyOverride: boolean | null
  liftId: string | null
  startedAt: string | null
  itemType: WorkItemType
  title: string | null
  tireQuantity: number | null
  customerSuppliedTires: boolean
  laborHours: number
  firstName: string
  lastName: string | null
  year: number
  make: string
  model: string
  licensePlate: string | null
  ready: boolean
  auto: boolean
  reason: string | null
  waitingOnParts: boolean
  jobMinutes: number
  elapsedMinutes: number
  remainingMinutes: number
  position?: number
  waitMinutes?: number
}

export type ShopFloor = {
  lifts: { id: string; name: string; queue: Queue; entry: ShopEntry | null }[]
  queues: Record<
    Queue,
    { lifts: number; entries: ShopEntry[]; nextEntryId: string | null; newCarWaitMinutes: number }
  >
  generatedAt: string
}

export type StockCheck = {
  productId: string
  brand: string
  model: string
  tireSize: string | null
  productType: 'tire' | 'tpms_sensor'
  stocked: boolean
  condition: 'new' | 'used'
  needed: number
  available: number
  shortfall: number
  orderQty: number
  restockQty: number
}

export type TicketStatus = 'quote' | 'declined' | 'work_order' | 'invoiced'

export type Ticket = {
  id: string
  quoteNumber: number
  invoiceNumber: number | null
  status: TicketStatus
  taxRate: number
  validUntil: string
  expired: boolean
  createdAt: string
  customer: Pick<Customer, 'id' | 'firstName' | 'lastName' | 'phone' | 'hasAccount'>
  vehicle: Pick<
    Vehicle,
    | 'id'
    | 'year'
    | 'make'
    | 'model'
    | 'vehicleClass'
    | 'liftedLowered'
    | 'multiLinkSuspension'
    | 'licensePlate'
    | 'tireSize'
    | 'trim'
    | 'driveType'
    | 'rearTireSize'
    | 'isEv'
    | 'heavyDuty'
    | 'runFlat'
    | 'requiredLoadIndex'
    | 'requiredLoadRange'
    | 'requiredSpeedRating'
  >
  totals: {
    gross: number
    discount: number
    subtotal: number
    taxableSubtotal: number
    tax: number
    total: number
  }
  workItems: WorkItem[]
  stockCheck: StockCheck[]
  acceptedAt: string | null
  createdByName: string | null
  acceptedByName: string | null
  invoicedByName: string | null
  checkedInAt: string | null
  plannedFor: string | null
  invoicedAt: string | null
  paidAt: string | null
  chargedToAccount: boolean
  depositOverrideReason: string | null
  pendingOrders: PendingOrder[]
  callLogs: { id: string; note: string | null; calledAt: string }[]
  payments: Payment[]
  depositsTotal: number
  minDeposit: number
  balance: Balance
  // Only on work orders: what still stands in the way of invoicing.
  invoiceReadiness: { pendingItems: number; openOrders: number; unclaimedOrders: number } | null
}

export type TicketSummary = {
  id: string
  quoteNumber: number
  status: TicketStatus
  validUntil: string
  expired: boolean
  createdAt: string
  acceptedAt: string | null
  checkedInAt: string | null
  openOrders: number
  customerId: string
  firstName: string
  lastName: string | null
  phone: string | null
  year: number
  make: string
  model: string
  total: number
  invoiceNumber: number | null
  invoicedAt: string | null
  paidAt: string | null
  chargedToAccount: boolean
  balance: number
}

export type TireConfig = {
  customerSuppliedTires: boolean
  tireProductId: string | null
  tireQuantity: number
  oldTiresRemoved: number
  customerTireSize: string | null
  difficultyMinutes: number | null
}

export type NewLineInput =
  | { kind: 'tpms_sensor'; quantity: number }
  | { kind: 'tpms_reset'; quantity: number }
  | { kind: 'trailer_valve_stem'; quantity: number }
  | { kind: 'labor'; quantity: number; description?: string }
  | {
      kind: 'part'
      description: string
      quantity: number
      unitPrice: number
      unitCost?: number | null
      order?: boolean
    }
  | {
      kind: 'custom'
      description: string
      quantity: number
      unitPrice: number
      unitCost?: number | null
      taxable: boolean
      order?: boolean
      orderKind?: OrderKind
    }

export type LineUpdate = Partial<{
  quantity: number
  unitPrice: number
  unitCost: number | null
  description: string
  taxable: boolean
  discountType: 'amount' | 'percent' | null
  discountValue: number
  resetPrice: boolean
}>

export type OrderView = 'needed' | 'ordered' | 'arrived' | 'closed'

export type OrderRow = PendingOrder & {
  ticketId: string | null
  productId: string | null
  unitCost: number | null
  returnFee: number | null
  orderedAt: string | null
  overdue: boolean
  arrivedAt: string | null
  customerNotifiedAt: string | null
  closedAt: string | null
  createdAt: string
  ticketNumber: number | null
  ticketStatus: TicketStatus | null
  checkedInAt: string | null
  firstName: string | null
  lastName: string | null
  phone: string | null
  year: number | null
  make: string | null
  model: string | null
}

export type OrderCounts = { needed: number; ordered: number; arrived: number; unclaimed: number }

export type CallTicket = {
  ticketId: string
  ticketNumber: number
  checkedInAt: string | null
  firstName: string
  lastName: string | null
  phone: string | null
  year: number
  make: string
  model: string
  items: {
    id: string
    description: string
    itemKind: string
    qtyOrdered: number
    qtyArrived: number
    status: PendingOrder['status']
  }[]
  allIn: boolean
  firstArrivedAt: string | null
  calls: { id: string; note: string | null; calledAt: string }[]
}

type TicketResponse = { ticket: Ticket }

export type Role = 'admin' | 'advisor'

export type CurrentUser = { id: string; username: string; displayName: string; role: Role }

export type User = CurrentUser & { active: boolean; createdAt: string; lastLoginAt: string | null }

// Sent when the API says the session has ended (signed out elsewhere, expired,
// or the login was turned off). App listens and shows the sign-in screen.
export const AUTH_REQUIRED = 'auth-required'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  })

  const data = await response.json().catch(() => null)

  if (response.status === 401 && !url.startsWith('/api/auth/')) {
    window.dispatchEvent(new Event(AUTH_REQUIRED))
  }

  if (!response.ok) {
    throw new Error(data?.error ?? `Request failed with status ${response.status}`)
  }

  return data as T
}

export const api = {
  me: () => request<{ user: CurrentUser | null; needsSetup: boolean }>('/api/auth/me'),

  setup: (body: { displayName: string; username: string; password: string }) =>
    request<{ ok: true }>('/api/auth/setup', { method: 'POST', body: JSON.stringify(body) }),

  login: (username: string, password: string) =>
    request<{ ok: true }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  listUsers: (signal?: AbortSignal) => request<{ users: User[] }>('/api/users', { signal }),

  createUser: (body: { displayName: string; username: string; role: Role; password: string }) =>
    request<{ user: User }>('/api/users', { method: 'POST', body: JSON.stringify(body) }),

  updateUser: (id: string, body: { displayName: string; role: Role; active: boolean }) =>
    request<{ user: User }>(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  resetPassword: (id: string, password: string) =>
    request<{ ok: true }>(`/api/users/${id}/password`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),

  searchCustomers: (q: string, signal?: AbortSignal) =>
    request<{ customers: CustomerSummary[] }>(
      `/api/customers?q=${encodeURIComponent(q)}`,
      { signal },
    ),

  getCustomer: (id: string, signal?: AbortSignal) =>
    request<{ customer: CustomerDetail }>(`/api/customers/${id}`, { signal }),

  checkPhone: (phone: string, excludeId?: string) =>
    request<{ duplicates: Customer[] }>(
      `/api/customers/phone-check?phone=${encodeURIComponent(phone)}` +
        (excludeId ? `&excludeId=${excludeId}` : ''),
    ),

  createCustomer: (input: CustomerInput) =>
    request<{ id: string; phoneDuplicates: Customer[] }>('/api/customers', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateCustomer: (id: string, input: CustomerInput) =>
    request<{ id: string; phoneDuplicates: Customer[] }>(`/api/customers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  decodeVin: (vin: string) =>
    request<{ suggestion: VinSuggestion }>(`/api/vin/${encodeURIComponent(vin.trim())}`),

  createVehicle: (customerId: string, input: VehicleInput) =>
    request<{ vehicle: Vehicle }>(`/api/customers/${customerId}/vehicles`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateVehicle: (id: string, input: VehicleInput) =>
    request<{ vehicle: Vehicle }>(`/api/vehicles/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  listProducts: (signal?: AbortSignal) =>
    request<{ products: Product[] }>('/api/products', { signal }),

  listTickets: (status: TicketStatus, signal?: AbortSignal) =>
    request<{ tickets: TicketSummary[] }>(`/api/tickets?status=${status}`, { signal }),

  getTicket: (id: string, signal?: AbortSignal) =>
    request<TicketResponse>(`/api/tickets/${id}`, { signal }),

  createTicket: (customerId: string, vehicleId: string) =>
    request<TicketResponse>('/api/tickets', {
      method: 'POST',
      body: JSON.stringify({ customerId, vehicleId }),
    }),

  declineTicket: (id: string) =>
    request<TicketResponse>(`/api/tickets/${id}/decline`, { method: 'POST' }),

  acceptTicket: (id: string, input: AcceptInput) =>
    request<TicketResponse>(`/api/tickets/${id}/accept`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  checkIn: (id: string) =>
    request<TicketResponse>(`/api/tickets/${id}/check-in`, { method: 'POST' }),

  revertToQuote: (id: string) =>
    request<TicketResponse>(`/api/tickets/${id}/revert-to-quote`, { method: 'POST' }),

  addWorkItem: (
    ticketId: string,
    input: { itemType: WorkItemType; title?: string } & Partial<TireConfig>,
  ) =>
    request<TicketResponse>(`/api/tickets/${ticketId}/work-items`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateWorkItem: (id: string, input: { title?: string | null } & Partial<TireConfig>) =>
    request<TicketResponse>(`/api/work-items/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  deleteWorkItem: (id: string) =>
    request<TicketResponse>(`/api/work-items/${id}`, { method: 'DELETE' }),

  addLine: (workItemId: string, input: NewLineInput) =>
    request<TicketResponse>(`/api/work-items/${workItemId}/lines`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateLine: (id: string, input: LineUpdate) =>
    request<TicketResponse>(`/api/line-items/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  deleteLine: (id: string) =>
    request<TicketResponse>(`/api/line-items/${id}`, { method: 'DELETE' }),

  listOrders: (view: OrderView, signal?: AbortSignal) =>
    request<{ orders: OrderRow[]; counts: OrderCounts }>(`/api/orders?view=${view}`, { signal }),

  markOrdered: (ids: string[], vendor: string, expectedAt: string) =>
    request<{ updated: number }>('/api/orders/mark-ordered', {
      method: 'POST',
      body: JSON.stringify({ ids, vendor, expectedAt }),
    }),

  updateOrder: (id: string, input: { vendor: string; expectedAt: string; unitCost: number | null }) =>
    request<{ ok: true }>(`/api/orders/${id}`, { method: 'PUT', body: JSON.stringify(input) }),

  receiveOrder: (id: string, quantity: number) =>
    request<{ arrived: number; complete: boolean }>(`/api/orders/${id}/receive`, {
      method: 'POST',
      body: JSON.stringify({ quantity }),
    }),

  // outcome: what happened to the job the order was for (see the API).
  cancelOrder: (id: string) =>
    request<{ ok: true; outcome: 'cancelled' | 'covered' | 'reserved' | 'ordered' | 'reserved_and_ordered' }>(
      `/api/orders/${id}/cancel`,
      { method: 'POST', body: '{}' },
    ),

  returnOrder: (id: string, returnFee: number) =>
    request<{ ok: true }>(`/api/orders/${id}/return`, {
      method: 'POST',
      body: JSON.stringify({ returnFee }),
    }),

  markUnclaimed: (id: string) =>
    request<{ ok: true }>(`/api/orders/${id}/unclaimed`, { method: 'POST', body: '{}' }),

  shopFloor: (signal?: AbortSignal) => request<ShopFloor>('/api/shop', { signal }),

  waitEstimates: (signal?: AbortSignal) =>
    request<{ estimates: Record<Queue, number> }>('/api/shop/estimates', { signal }),

  startJob: (entryId: string, liftId?: string, force = false) =>
    request<ShopFloor>(`/api/shop/entries/${entryId}/start`, {
      method: 'POST',
      body: JSON.stringify({ liftId, force }),
    }),

  backToQueue: (entryId: string) =>
    request<ShopFloor>(`/api/shop/entries/${entryId}/back`, { method: 'POST', body: '{}' }),

  jobDone: (entryId: string) =>
    request<ShopFloor>(`/api/shop/entries/${entryId}/done`, { method: 'POST', body: '{}' }),

  jobNotPerformed: (entryId: string, reason: string, suspensionIssue: boolean) =>
    request<ShopFloor & { ordersToResolve: number; ticketId: string }>(
      `/api/shop/entries/${entryId}/not-performed`,
      { method: 'POST', body: JSON.stringify({ reason, suspensionIssue }) },
    ),

  setReady: (entryId: string, override: boolean | null) =>
    request<ShopFloor>(`/api/shop/entries/${entryId}/ready`, {
      method: 'PUT',
      body: JSON.stringify({ override }),
    }),

  followUpQuote: (ticketId: string) =>
    request<{ ticketId: string }>(`/api/shop/follow-up/${ticketId}`, { method: 'POST', body: '{}' }),

  addDeposit: (ticketId: string, amount: number, method: PaymentMethod) =>
    request<TicketResponse>(`/api/tickets/${ticketId}/deposits`, {
      method: 'POST',
      body: JSON.stringify({ amount, method }),
    }),

  refund: (ticketId: string, amount: number, method: PaymentMethod) =>
    request<TicketResponse>(`/api/tickets/${ticketId}/refunds`, {
      method: 'POST',
      body: JSON.stringify({ amount, method }),
    }),

  createInvoice: (ticketId: string, input: InvoiceInput) =>
    request<TicketResponse>(`/api/tickets/${ticketId}/invoice`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  openAccounts: (signal?: AbortSignal) =>
    request<{ invoices: OpenInvoice[] }>('/api/invoices/open-accounts', { signal }),

  accountPayment: (ticketId: string, amount: number, method: PaymentMethod, note: string | null) =>
    request<TicketResponse>(`/api/invoices/${ticketId}/payments`, {
      method: 'POST',
      body: JSON.stringify({ amount, method, note }),
    }),

  createProduct: (input: ProductInput) =>
    request<{ product: Product }>('/api/products', { method: 'POST', body: JSON.stringify(input) }),

  updateProduct: (id: string, input: ProductInput) =>
    request<{ product: Product }>(`/api/products/${id}`, { method: 'PUT', body: JSON.stringify(input) }),

  // Today's cost. Special-order tires get their price from the Settings markup
  // unless a price is given; stocked items keep theirs.
  tireComparison: (
    ticketId: string,
    query: {
      quantity: number
      size?: string | null
      axle?: 'front' | 'rear' | null
      extra?: string[]
      filters?: TireFilters
    },
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams({ quantity: String(query.quantity) })
    if (query.size) params.set('size', query.size)
    if (query.extra?.length) params.set('extra', query.extra.join(','))
    const f = query.filters
    if (f) {
      if (f.brands.length) params.set('brands', f.brands.join(','))
      if (f.minWarranty) params.set('minWarranty', String(f.minWarranty))
      if (f.season) params.set('season', f.season)
      if (f.tireType) params.set('tireType', f.tireType)
      if (f.minLoad) params.set('minLoad', f.minLoad)
      if (f.maxPrice) params.set('maxPrice', String(f.maxPrice))
      if (f.roadHazard) params.set('roadHazard', 'true')
    }
    if (query.axle) params.set('axle', query.axle)
    return request<Comparison>(`/api/tickets/${ticketId}/tire-options?${params}`, { signal })
  },

  // "4 215/55r16 road hazard 40k+" read into a size, count and filters.
  readTireRequest: (ticketId: string, text: string, quantity: number) =>
    request<TireRequest>(`/api/tickets/${ticketId}/tire-request`, {
      method: 'POST',
      body: JSON.stringify({ text, quantity }),
    }),

  saveTireOptions: (
    ticketId: string,
    input: { size: string; quantity: number; axle: 'front' | 'rear' | null; productIds: string[]; workItemId?: string | null },
  ) =>
    request<TicketResponse>(`/api/tickets/${ticketId}/tire-options`, { method: 'POST', body: JSON.stringify(input) }),

  pickTireOption: (workItemId: string, optionId: string) =>
    request<TicketResponse>(`/api/work-items/${workItemId}/pick-option`, {
      method: 'POST',
      body: JSON.stringify({ optionId }),
    }),

  setProductCost: (id: string, cost: number, price?: number) =>
    request<{ product: Product }>(`/api/products/${id}/cost`, {
      method: 'POST',
      body: JSON.stringify({ cost, price }),
    }),

  listTireLines: (signal?: AbortSignal) => request<{ lines: TireLine[] }>('/api/tire-lines', { signal }),

  saveTireLine: (id: string | null, input: TireLineInput) =>
    request<{ line: TireLine }>(id ? `/api/tire-lines/${id}` : '/api/tire-lines', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify({ ...input, season: input.season || null, tireType: input.tireType || null }),
    }),

  uploadTireLinePhoto: (id: string, dataUrl: string) =>
    request<{ line: TireLine }>(`/api/tire-lines/${id}/photo`, { method: 'PUT', body: JSON.stringify({ dataUrl }) }),

  deleteTireLinePhoto: (id: string) =>
    request<{ line: TireLine }>(`/api/tire-lines/${id}/photo`, { method: 'DELETE' }),

  // The version makes the browser fetch a replaced photo instead of its cached copy.
  tireLinePhotoUrl: (id: string, version: string | null) =>
    `/api/tire-lines/${id}/photo${version ? `?v=${encodeURIComponent(version)}` : ''}`,

  changeStock: (id: string, mode: 'receive' | 'count', quantity: number, note: string | null) =>
    request<{ product: Product }>(`/api/products/${id}/stock`, {
      method: 'POST',
      body: JSON.stringify({ mode, quantity, note }),
    }),

  productMovements: (id: string, signal?: AbortSignal) =>
    request<{ movements: StockMovement[] }>(`/api/products/${id}/movements`, { signal }),

  upcoming: (signal?: AbortSignal) => request<{ tickets: UpcomingTicket[] }>('/api/shop/upcoming', { signal }),

  setPlannedFor: (ticketId: string, plannedFor: string | null) =>
    request<TicketResponse>(`/api/tickets/${ticketId}/planned-for`, {
      method: 'PUT',
      body: JSON.stringify({ plannedFor }),
    }),

  ticketPdfUrl: (ticketId: string, download = false) =>
    `/api/tickets/${ticketId}/pdf${download ? '?download=1' : ''}`,

  getSettings: (signal?: AbortSignal) => request<{ settings: ShopSettings }>('/api/settings', { signal }),

  saveSettings: (changes: Partial<ShopSettings>) =>
    request<{ settings: ShopSettings }>('/api/settings', { method: 'PUT', body: JSON.stringify(changes) }),

  lowStock: (signal?: AbortSignal) => request<{ items: LowStockItem[] }>('/api/low-stock', { signal }),

  orderLowStock: (items: { productId: string; quantity: number }[]) =>
    request<{ items: LowStockItem[] }>('/api/low-stock/order', {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),

  completeWorkItem: (id: string) =>
    request<TicketResponse>(`/api/work-items/${id}/complete`, { method: 'POST', body: '{}' }),

  workItemNotPerformed: (id: string, reason: string, suspensionIssue = false) =>
    request<TicketResponse & { ordersToResolve: number }>(`/api/work-items/${id}/not-performed`, {
      method: 'POST',
      body: JSON.stringify({ reason, suspensionIssue }),
    }),

  callList: (signal?: AbortSignal) =>
    request<{ tickets: CallTicket[] }>('/api/calls', { signal }),

  logCall: (ticketId: string, note: string) =>
    request<{ ok: true }>(`/api/calls/${ticketId}`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),

  customerNotified: (ticketId: string, note: string) =>
    request<{ ok: true }>(`/api/calls/${ticketId}/notified`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),
}

// "about 1 h 25 min" style for wait times.
// Same formula as the API's tirePriceFromCost (apps/api/src/pricing.ts); keep them in step.
// Cost plus the markup, at least cost + the minimum profit, rounded up to the next .99.
export function tirePriceFromCost(
  settings: Pick<ShopSettings, 'tireMarkupPercent' | 'tireMinProfit'>,
  cost: number,
) {
  const price = Math.max(cost * (1 + settings.tireMarkupPercent / 100), cost + settings.tireMinProfit)
  const cents = Math.round(price * 100)
  return (Math.ceil((cents + 1) / 100) * 100 - 1) / 100
}

export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return 'now'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

// A blank amount (e.g. a catalog tire with no price yet) shows as a dash.
export function formatMoney(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  return money.format(Number(value))
}

export function formatDate(isoDate: string): string {
  // Plain dates (YYYY-MM-DD) are read as local dates; timestamps are converted
  // from UTC so an evening payment isn't shown as the next day.
  const date =
    isoDate.length > 10
      ? new Date(isoDate)
      : (([y, m, d]) => new Date(y, m - 1, d))(isoDate.split('-').map(Number))
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatPhone(phone: string | null): string {
  if (!phone) return ''
  if (phone.length === 10) {
    return `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}`
  }
  if (phone.length === 7) {
    return `${phone.slice(0, 3)}-${phone.slice(3)}`
  }
  return phone
}

export function customerName(c: Pick<Customer, 'firstName' | 'lastName'>): string {
  return [c.firstName, c.lastName].filter(Boolean).join(' ')
}

export function vehicleLabel(v: Pick<Vehicle, 'year' | 'make' | 'model'>): string {
  return `${v.year} ${v.make} ${v.model}`
}
