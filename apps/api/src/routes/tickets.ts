import { Router } from 'express'
import type { PoolClient } from 'pg'
import {
  allocateProductLine,
  openRestockQty,
  orderNonInventoryLine,
  releaseLine,
  syncQueue,
  type OrderKind,
} from '../allocation.js'
import { invoiceReadiness, loadBalance } from '../balances.js'
import { pool, withTransaction, type Queryable } from '../db.js'
import {
  alignmentDescription,
  alignmentPrice,
  defaultDifficultyMinutes,
  mountBalanceDescription,
  mountBalancePrice,
  parseTireSize,
  type Settings,
  type TireSizeInfo,
} from '../pricing.js'
import {
  asBody,
  ConflictError,
  idParam,
  NotFoundError,
  optionalBoolean,
  optionalDate,
  optionalId,
  optionalNumber,
  optionalText,
  requiredNumber,
  requiredText,
  ValidationError,
  type Body,
} from '../validation.js'
import { vehicleColumns } from './customers.js'
import { loadSettings } from './settings.js'

export const ticketsRouter = Router()
export const workItemsRouter = Router()
export const lineItemsRouter = Router()

const workItemTypes = ['tires', 'alignment', 'mechanic', 'other'] as const
type WorkItemStatus = 'pending' | 'completed' | 'not_performed'
type WorkItemType = (typeof workItemTypes)[number]

type Vehicle = {
  id: string
  vehicleClass: 'car' | 'truck'
  liftedLowered: boolean
  multiLinkSuspension: boolean
  tireSize: string | null
}

export type WorkItem = {
  id: string
  ticketId: string
  itemType: WorkItemType
  title: string | null
  customerSuppliedTires: boolean
  tireProductId: string | null
  tireQuantity: number | null
  oldTiresRemoved: number | null
  customerTireSize: string | null
  difficultyMinutes: number
  // Set while quoted tire options wait for the customer to pick one.
  optionsSize?: string | null
}

type Product = {
  id: string
  brand: string
  model: string
  tireSize: string | null
  productType: 'tire' | 'tpms_sensor'
  condition: 'new' | 'used'
  // Blank for catalog tires nobody has priced yet.
  price: number | null
  cost: number | null
  tireClassOverride: 'car' | 'truck' | null
}

type NewLine = {
  lineKind: 'product' | 'service' | 'labor' | 'part' | 'custom'
  productId?: string | null
  serviceCode?: string | null
  description: string
  quantity: number
  unitPrice: number
  unitCost?: number | null
  taxable: boolean
  // TPMS sensors: the single and 2+ prices this line is priced from (see ticketTpmsPrices).
  tpmsPrices?: { single: number; multi: number }
}

export const workItemColumns = `
  wi.id::text AS id,
  wi.ticket_id::text AS "ticketId",
  wi.item_type AS "itemType",
  wi.title,
  wi.status,
  wi.customer_supplied_tires AS "customerSuppliedTires",
  wi.tire_product_id::text AS "tireProductId",
  wi.tire_quantity AS "tireQuantity",
  wi.old_tires_removed AS "oldTiresRemoved",
  wi.customer_tire_size AS "customerTireSize",
  wi.difficulty_minutes AS "difficultyMinutes",
  wi.sort_order AS "sortOrder",
  wi.created_at AS "createdAt",
  wi.not_performed_reason AS "notPerformedReason",
  wi.completed_at AS "completedAt",
  wi.options_size AS "optionsSize"
`

const productColumns = `
  p.id::text AS id,
  p.brand,
  p.model,
  p.tire_size AS "tireSize",
  p.product_type AS "productType",
  p.condition,
  p.price::float8 AS price,
  p.cost::float8 AS cost,
  p.tire_class_override AS "tireClassOverride"
`

// ---------------------------------------------------------------------------
// Locking: every change locks the ticket row and checks its status, so two
// screens can't change the same ticket at the same moment.
// ---------------------------------------------------------------------------

type TicketStatus = 'quote' | 'declined' | 'work_order' | 'invoiced'
const editable: TicketStatus[] = ['quote', 'work_order']

export async function lockTicket(
  client: PoolClient,
  ticketId: string,
  allowed: TicketStatus[] = ['quote'],
) {
  const ticket = await client.query(
    `
      SELECT
        status,
        vehicle_id::text AS "vehicleId",
        accepted_at AS "acceptedAt",
        checked_in_at AS "checkedInAt",
        valid_until < CURRENT_DATE AS expired
      FROM tickets
      WHERE id = $1
      FOR UPDATE
    `,
    [ticketId],
  )
  if (ticket.rowCount === 0) throw new NotFoundError('Ticket not found')
  const row = ticket.rows[0]
  if (!allowed.includes(row.status)) {
    if (row.status === 'invoiced') {
      throw new ConflictError('This ticket has been invoiced and can no longer be changed')
    }
    throw new ConflictError(
      allowed.includes('work_order')
        ? 'Only open quotes and work orders can be changed'
        : allowed.length === 1 && allowed[0] === 'work_order'
          ? 'This is not a work order'
          : 'Only open quotes can be changed',
    )
  }

  const vehicle = await client.query(
    `SELECT ${vehicleColumns} FROM vehicles AS v WHERE v.id = $1`,
    [row.vehicleId],
  )
  return {
    ticketId,
    status: row.status as TicketStatus,
    acceptedAt: row.acceptedAt as Date | null,
    checkedInAt: row.checkedInAt as Date | null,
    expired: row.expired as boolean,
    vehicle: vehicle.rows[0] as Vehicle,
  }
}

type TicketContext = Awaited<ReturnType<typeof lockTicket>>

// On a work order, only things added after the customer accepted can change.
function addedOnWorkOrder(ticket: TicketContext, createdAt: Date) {
  return ticket.acceptedAt !== null && createdAt > ticket.acceptedAt
}

function assertChangeable(ticket: TicketContext, createdAt: Date, what: string) {
  if (ticket.status === 'work_order' && !addedOnWorkOrder(ticket, createdAt)) {
    throw new ConflictError(
      `This ${what} was on the accepted quote and can't be changed now. ` +
        'If it won’t be done, mark it not performed.',
    )
  }
}

// Lock the ticket a work item belongs to. Only pending work can be changed:
// once it's done or marked not performed its stock and orders are settled,
// so adding or editing lines would leave stock reserved or orders open for
// good. Pass itemStatuses = null to skip that check (done/not performed do
// their own).
export async function lockWorkItem(
  client: PoolClient,
  workItemId: string,
  allowed: TicketStatus[] = ['quote'],
  itemStatuses: WorkItemStatus[] | null = ['pending'],
) {
  const owner = await client.query(
    `SELECT ticket_id::text AS "ticketId" FROM work_items WHERE id = $1`,
    [workItemId],
  )
  if (owner.rowCount === 0) throw new NotFoundError('Work item not found')

  const ticket = await lockTicket(client, owner.rows[0].ticketId, allowed)
  const workItem = await client.query(
    `SELECT ${workItemColumns}, wi.status FROM work_items AS wi WHERE wi.id = $1`,
    [workItemId],
  )
  const row = workItem.rows[0] as WorkItem & { createdAt: Date; status: WorkItemStatus }
  if (itemStatuses && !itemStatuses.includes(row.status)) {
    throw new ConflictError(
      row.status === 'completed'
        ? 'This work is already done and can no longer be changed. Add a new work item instead.'
        : 'This work was marked not performed and can no longer be changed. Add a new work item instead.',
    )
  }
  return { ticket, ...ticket, workItem: row }
}

async function lockLine(
  client: PoolClient,
  lineId: string,
  allowed: TicketStatus[] = ['quote'],
) {
  const line = await client.query(
    `
      SELECT
        id::text AS id,
        work_item_id::text AS "workItemId",
        line_kind AS "lineKind",
        product_id::text AS "productId",
        service_code AS "serviceCode",
        generated,
        price_overridden AS "priceOverridden",
        created_at AS "createdAt",
        EXISTS (SELECT 1 FROM reservations r WHERE r.line_item_id = line_items.id)
          OR EXISTS (
            SELECT 1 FROM pending_orders po
            WHERE po.line_item_id = line_items.id AND po.status <> 'cancelled'
          ) AS "hasStockOrOrder"
      FROM line_items
      WHERE id = $1
    `,
    [lineId],
  )
  if (line.rowCount === 0) throw new NotFoundError('Line not found')
  const context = await lockWorkItem(client, line.rows[0].workItemId, allowed)
  return { ...context, line: line.rows[0] }
}

// Reserve or order a line's stocked products (work orders only).
async function allocateLines(client: PoolClient, ticketId: string, workItemId: string) {
  const lines = await client.query(
    `
      SELECT
        li.id::text AS id,
        li.product_id::text AS "productId",
        li.description,
        li.quantity::float8 AS quantity,
        li.unit_cost::float8 AS "unitCost"
      FROM line_items AS li
      WHERE li.work_item_id = $1
        AND li.product_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.line_item_id = li.id)
        AND NOT EXISTS (
          SELECT 1 FROM pending_orders po WHERE po.line_item_id = li.id AND po.status <> 'cancelled'
        )
      ORDER BY li.sort_order, li.id
    `,
    [workItemId],
  )
  for (const line of lines.rows) {
    await allocateProductLine(client, ticketId, line)
  }
}

async function releaseWorkItem(client: PoolClient, workItemId: string) {
  const lines = await client.query('SELECT id::text AS id FROM line_items WHERE work_item_id = $1', [
    workItemId,
  ])
  for (const line of lines.rows) await releaseLine(client, line.id)
}

// ---------------------------------------------------------------------------
// Products and tire details
// ---------------------------------------------------------------------------

async function loadProduct(
  db: Queryable,
  id: string,
  productType: Product['productType'],
): Promise<Product> {
  const result = await db.query(
    `SELECT ${productColumns} FROM products AS p WHERE p.id = $1 AND p.product_type = $2`,
    [id, productType],
  )
  if (result.rowCount === 0) {
    throw new ValidationError(
      productType === 'tire' ? 'That tire was not found' : 'That TPMS sensor was not found',
    )
  }
  return result.rows[0]
}

function productDescription(p: Product) {
  if (p.productType === 'tpms_sensor') return `${p.brand} ${p.model} TPMS sensor`
  return `${p.brand} ${p.model} ${p.tireSize}${p.condition === 'used' ? ' (used)' : ''}`
}

export async function tireInfoFor(
  db: Queryable,
  workItem: WorkItem,
  settings: Settings,
): Promise<TireSizeInfo> {
  if (workItem.customerSuppliedTires) {
    return parseTireSize(workItem.customerTireSize, settings)
  }
  // Options quoted, none picked yet: the size they're all for.
  if (!workItem.tireProductId) return parseTireSize(workItem.optionsSize ?? null, settings)
  const product = await loadProduct(db, workItem.tireProductId!, 'tire')
  return parseTireSize(product.tireSize, settings, product.tireClassOverride)
}

// ---------------------------------------------------------------------------
// Generated lines: rebuilt from the work item's settings. Prices are copied
// onto a ticket once: a rebuilt line keeps its existing price (and cost)
// unless what it's priced from changed — a different tire, or a service whose
// description changed (car -> truck, low-profile, lifted...). Catalog and
// settings changes never re-price a line on their own. Discounts and typed-in
// prices are always carried over. "Reset price" refreshes just that one line.
// ---------------------------------------------------------------------------

function lineKey(line: { serviceCode?: string | null; productId?: string | null }) {
  return line.serviceCode ? `service:${line.serviceCode}` : `product:${line.productId}`
}

async function generatedLinesFor(
  db: Queryable,
  workItem: WorkItem,
  vehicle: Vehicle,
  settings: Settings,
): Promise<NewLine[]> {
  if (workItem.itemType === 'alignment') {
    return [
      {
        lineKind: 'service',
        serviceCode: 'alignment',
        description: alignmentDescription(vehicle),
        quantity: 1,
        unitPrice: alignmentPrice(settings, vehicle),
        taxable: false,
      },
    ]
  }

  if (workItem.itemType !== 'tires') return []

  const quantity = workItem.tireQuantity!
  const lines: NewLine[] = []
  let tire: TireSizeInfo

  if (workItem.customerSuppliedTires) {
    tire = parseTireSize(workItem.customerTireSize, settings)
  } else if (!workItem.tireProductId) {
    // Options quoted, none picked: nothing is charged until the customer chooses.
    return []
  } else {
    const product = await loadProduct(db, workItem.tireProductId!, 'tire')
    tire = parseTireSize(product.tireSize, settings, product.tireClassOverride)
    lines.push({
      lineKind: 'product',
      productId: product.id,
      description: productDescription(product),
      quantity,
      // Checked in rebuildGeneratedLines: a quote may already hold a price for it.
      unitPrice: product.price as number,
      unitCost: product.cost,
      taxable: true,
    })
  }

  lines.push({
    lineKind: 'service',
    serviceCode: 'mount_balance',
    description: mountBalanceDescription(tire),
    quantity,
    unitPrice: mountBalancePrice(settings, tire),
    taxable: false,
  })

  if (workItem.oldTiresRemoved! > 0) {
    lines.push({
      lineKind: 'service',
      serviceCode: 'disposal',
      description: 'Tire disposal fee',
      quantity: workItem.oldTiresRemoved!,
      unitPrice: settings.disposalFee,
      taxable: false,
    })
  }

  // Valve stems are free when the tires are bought here.
  if (workItem.customerSuppliedTires) {
    lines.push({
      lineKind: 'service',
      serviceCode: 'valve_stem',
      description: 'Valve stem (customer-supplied tires)',
      quantity,
      unitPrice: settings.valveStemCustomerSuppliedPrice,
      // Valve stems are an add-on charge, not a taxed product.
      taxable: false,
    })
  }

  return lines
}

// The sensor prices for a new line: the ones already on this ticket if it has
// sensors, so a Settings change never splits one car's sensors across two
// price lists; otherwise today's Settings.
async function ticketTpmsPrices(client: PoolClient, ticketId: string, settings: Settings) {
  const existing = await client.query(
    `
      SELECT li.tpms_single_price::float8 AS single, li.tpms_multi_price::float8 AS multi
      FROM line_items li JOIN work_items wi ON wi.id = li.work_item_id
      WHERE wi.ticket_id = $1 AND li.service_code = 'tpms_sensor'
      ORDER BY li.id
      LIMIT 1
    `,
    [ticketId],
  )
  return (
    (existing.rows[0] as { single: number; multi: number } | undefined) ?? {
      single: settings.tpmsSensorSinglePrice,
      multi: settings.tpmsSensorMultiPrice,
    }
  )
}

// TPMS sensors get the lower 2+ price when the car gets 2 or more, counted across the
// whole ticket (two lines of 1 sensor each is 2 sensors). Re-prices every
// sensor line on pending work that the advisor hasn't priced by hand, from
// the prices copied onto each line when it was added (never today's
// Settings). On a quote the price follows the count both ways; once the
// customer has accepted it only goes down: fewer sensors (one not
// performed) keep the price they agreed to. Finished work keeps its price.
export async function repriceTpms(client: PoolClient, ticketId: string) {
  await client.query(
    `
      WITH total AS (
        SELECT COALESCE(SUM(li.quantity), 0) AS qty
        FROM line_items li JOIN work_items wi ON wi.id = li.work_item_id
        WHERE wi.ticket_id = $1 AND wi.status <> 'not_performed' AND li.service_code = 'tpms_sensor'
      ),
      standard AS (
        SELECT li.id,
               CASE WHEN (SELECT qty FROM total) >= 2 THEN li.tpms_multi_price ELSE li.tpms_single_price END AS price
        FROM line_items li JOIN work_items wi ON wi.id = li.work_item_id
        WHERE wi.ticket_id = $1 AND li.service_code = 'tpms_sensor'
      )
      UPDATE line_items li
      SET unit_price = CASE WHEN t.status = 'quote' THEN s.price ELSE LEAST(li.unit_price, s.price) END
      FROM standard s, work_items wi JOIN tickets t ON t.id = wi.ticket_id
      WHERE s.id = li.id
        AND wi.id = li.work_item_id
        AND wi.status = 'pending'
        AND NOT li.price_overridden
    `,
    [ticketId],
  )
}

async function insertLine(
  client: PoolClient,
  workItemId: string,
  line: NewLine,
  options: {
    sortOrder: number
    generated?: boolean
    priceOverridden?: boolean
    discountType?: string | null
    discountValue?: number
  },
): Promise<string> {
  const result = await client.query(
    `
      INSERT INTO line_items (
        work_item_id, line_kind, product_id, service_code, description,
        quantity, unit_price, unit_cost, taxable, discount_type,
        discount_value, sort_order, generated, price_overridden,
        tpms_single_price, tpms_multi_price
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING id::text AS id
    `,
    [
      workItemId,
      line.lineKind,
      line.productId ?? null,
      line.serviceCode ?? null,
      line.description,
      line.quantity,
      line.unitPrice,
      line.unitCost ?? null,
      line.taxable,
      options.discountType ?? null,
      options.discountValue ?? 0,
      options.sortOrder,
      options.generated ?? false,
      options.priceOverridden ?? false,
      line.tpmsPrices?.single ?? null,
      line.tpmsPrices?.multi ?? null,
    ],
  )
  return result.rows[0].id
}

export async function rebuildGeneratedLines(
  client: PoolClient,
  workItem: WorkItem,
  vehicle: Vehicle,
  settings: Settings,
  refreshKey: string | null = null,
) {
  const previous = await client.query(
    `
      SELECT
        service_code AS "serviceCode",
        product_id::text AS "productId",
        description,
        unit_price::float8 AS "unitPrice",
        unit_cost::float8 AS "unitCost",
        price_overridden AS "priceOverridden",
        discount_type AS "discountType",
        discount_value::float8 AS "discountValue"
      FROM line_items
      WHERE work_item_id = $1 AND generated
    `,
    [workItem.id],
  )
  const carried = new Map(previous.rows.map((row) => [lineKey(row), row]))

  await client.query(
    'DELETE FROM line_items WHERE work_item_id = $1 AND generated',
    [workItem.id],
  )

  const lines = await generatedLinesFor(client, workItem, vehicle, settings)
  for (const [index, line] of lines.entries()) {
    const key = lineKey(line)
    const prior = carried.get(key)
    const sameBasis = line.productId ? true : prior?.description === line.description
    const keepPrice =
      !!prior && key !== refreshKey && (prior.priceOverridden || sameBasis)
    const unitPrice = keepPrice ? prior.unitPrice : line.unitPrice
    if (unitPrice === null || unitPrice === undefined) {
      throw new ValidationError(
        `${line.description} has no price yet. Enter today's cost for it (Inventory, or the tire comparison) first.`,
      )
    }
    await insertLine(client, workItem.id, {
      ...line,
      unitPrice,
      unitCost: keepPrice && line.productId ? prior.unitCost : line.unitCost,
    }, {
      sortOrder: index,
      generated: true,
      priceOverridden: prior?.priceOverridden ?? false,
      discountType: prior?.discountType ?? null,
      discountValue: prior?.discountValue ?? 0,
    })
  }
}

// ---------------------------------------------------------------------------
// Reading request bodies
// ---------------------------------------------------------------------------

type TireConfig = {
  customerSuppliedTires: boolean
  tireProductId: string | null
  tireQuantity: number
  oldTiresRemoved: number
  customerTireSize: string | null
  difficultyMinutes: number | null
}

function readTireConfig(body: Body): TireConfig {
  const customerSuppliedTires = optionalBoolean(body, 'customerSuppliedTires', false)
  const tireQuantity = requiredNumber(body, 'tireQuantity', 'Number of tires', {
    min: 1,
    integer: true,
  })
  const oldTiresRemoved =
    optionalNumber(body, 'oldTiresRemoved', 'Old tires removed', {
      min: 0,
      integer: true,
    }) ?? tireQuantity

  const tireProductId = customerSuppliedTires ? null : optionalId(body, 'tireProductId')
  if (!customerSuppliedTires && tireProductId === null) {
    throw new ValidationError('Pick a tire, or check "customer-supplied tires"')
  }

  const customerTireSize = customerSuppliedTires
    ? optionalText(body, 'customerTireSize')?.toUpperCase() ?? null
    : null
  if (customerSuppliedTires && customerTireSize === null) {
    throw new ValidationError('Enter the size of the customer’s tires')
  }

  const difficultyMinutes = optionalNumber(body, 'difficultyMinutes', 'Difficulty', {
    integer: true,
  })
  if (difficultyMinutes !== null && ![0, 10, 20].includes(difficultyMinutes)) {
    throw new ValidationError('Difficulty must be 0, 10 or 20 minutes')
  }

  return {
    customerSuppliedTires,
    tireProductId,
    tireQuantity,
    oldTiresRemoved,
    customerTireSize,
    difficultyMinutes,
  }
}

function readDiscount(body: Body) {
  const type = body.discountType ?? null
  if (type !== null && type !== 'amount' && type !== 'percent') {
    throw new ValidationError('Discount must be "amount" or "percent"')
  }
  const value =
    type === null
      ? 0
      : requiredNumber(body, 'discountValue', 'Discount', { money: type === 'amount' })
  if (type === 'percent' && value > 100) {
    throw new ValidationError('A percent discount cannot be over 100')
  }
  return { discountType: type as 'amount' | 'percent' | null, discountValue: value }
}

// ---------------------------------------------------------------------------
// Ticket detail: everything the quote screen needs in one response.
// ---------------------------------------------------------------------------

export async function loadTicketDetail(db: Queryable, ticketId: string) {
  const ticketResult = await db.query(
    `
      SELECT
        t.id::text AS id,
        t.quote_number AS "quoteNumber",
        t.invoice_number AS "invoiceNumber",
        t.status,
        t.tax_rate::float8 AS "taxRate",
        t.valid_until::text AS "validUntil",
        (t.status = 'quote' AND t.valid_until < CURRENT_DATE) AS expired,
        t.notes,
        t.created_at AS "createdAt",
        t.accepted_at AS "acceptedAt",
        (SELECT display_name FROM users WHERE id = t.created_by) AS "createdByName",
        (SELECT display_name FROM users WHERE id = t.accepted_by) AS "acceptedByName",
        (SELECT display_name FROM users WHERE id = t.invoiced_by) AS "invoicedByName",
        t.checked_in_at AS "checkedInAt",
        t.planned_for::text AS "plannedFor",
        t.invoiced_at AS "invoicedAt",
        t.paid_at AS "paidAt",
        t.charged_to_account AS "chargedToAccount",
        t.deposit_override_reason AS "depositOverrideReason",
        json_build_object(
          'id', c.id::text,
          'firstName', c.first_name,
          'lastName', c.last_name,
          'phone', c.phone,
          'hasAccount', c.has_account
        ) AS customer,
        json_build_object(
          'id', v.id::text,
          'year', v.year,
          'make', v.make,
          'model', v.model,
          'vehicleClass', v.vehicle_class,
          'liftedLowered', v.lifted_lowered,
          'multiLinkSuspension', v.multi_link_suspension,
          'licensePlate', v.license_plate,
          'vin', v.vin,
          'tireSize', v.tire_size,
          'trim', v.trim,
          'driveType', v.drive_type,
          'rearTireSize', v.rear_tire_size,
          'isEv', v.is_ev,
          'heavyDuty', v.heavy_duty,
          'runFlat', v.run_flat,
          'requiredLoadIndex', v.required_load_index,
          'requiredLoadRange', v.required_load_range,
          'requiredSpeedRating', v.required_speed_rating
        ) AS vehicle,
        json_build_object(
          'gross', tt.gross::float8,
          'discount', tt.discount::float8,
          'subtotal', tt.subtotal::float8,
          'taxableSubtotal', tt.taxable_subtotal::float8,
          'tax', tt.tax::float8,
          'total', tt.total::float8
        ) AS totals
      FROM tickets AS t
      JOIN customers AS c ON c.id = t.customer_id
      JOIN vehicles AS v ON v.id = t.vehicle_id
      JOIN ticket_totals AS tt ON tt.ticket_id = t.id
      WHERE t.id = $1
    `,
    [ticketId],
  )
  if (ticketResult.rowCount === 0) throw new NotFoundError('Ticket not found')

  const settings = await loadSettings(db)

  const workItems = await db.query(
    `SELECT ${workItemColumns} FROM work_items AS wi WHERE wi.ticket_id = $1 ORDER BY wi.sort_order, wi.id`,
    [ticketId],
  )

  const lines = await db.query(
    `
      SELECT
        li.id::text AS id,
        li.work_item_id::text AS "workItemId",
        li.line_kind AS "lineKind",
        li.product_id::text AS "productId",
        li.service_code AS "serviceCode",
        li.description,
        li.quantity::float8 AS quantity,
        li.unit_price::float8 AS "unitPrice",
        li.unit_cost::float8 AS "unitCost",
        li.taxable,
        li.discount_type AS "discountType",
        li.discount_value::float8 AS "discountValue",
        li.generated,
        li.price_overridden AS "priceOverridden",
        a.gross::float8 AS gross,
        a.discount::float8 AS discount,
        a.net::float8 AS net,
        -- On a work order, lines from the accepted quote are locked.
        (t.status NOT IN ('quote', 'work_order')
          OR (t.status = 'work_order' AND li.created_at <= t.accepted_at)) AS locked,
        COALESCE(r.quantity, 0)::int AS "reservedQty",
        COALESCE(po.qty, 0)::int AS "onOrderQty",
        po.statuses AS "orderStatuses"
      FROM line_items AS li
      JOIN work_items AS wi ON wi.id = li.work_item_id
      JOIN tickets AS t ON t.id = wi.ticket_id
      JOIN line_item_amounts AS a ON a.line_item_id = li.id
      LEFT JOIN reservations AS r ON r.line_item_id = li.id
      LEFT JOIN LATERAL (
        SELECT
          SUM(qty_ordered - qty_arrived) FILTER (WHERE status IN ('needed', 'ordered')) AS qty,
          array_agg(DISTINCT status) AS statuses
        FROM pending_orders
        WHERE line_item_id = li.id AND status <> 'cancelled'
      ) AS po ON TRUE
      WHERE wi.ticket_id = $1
      ORDER BY li.sort_order, li.id
    `,
    [ticketId],
  )

  // Stock check: how many of each stocked product this ticket needs.
  const stock = await db.query(
    `
      SELECT
        p.id::text AS "productId",
        p.brand,
        p.model,
        p.tire_size AS "tireSize",
        p.product_type AS "productType",
        p.condition,
        p.stocked,
        p.min_qty AS "minQty",
        SUM(li.quantity)::int AS needed,
        (COALESCE(s.on_hand_qty, 0) - COALESCE(s.reserved_qty, 0))::int AS available
      FROM line_items AS li
      JOIN work_items AS wi
        ON wi.id = li.work_item_id AND wi.status <> 'not_performed'
      JOIN products AS p ON p.id = li.product_id
      LEFT JOIN inventory_stock AS s ON s.product_id = p.id
      WHERE wi.ticket_id = $1
      GROUP BY p.id, s.on_hand_qty, s.reserved_qty
      ORDER BY p.brand, p.model
    `,
    [ticketId],
  )

  // Matches what accepting will do: order the shortfall, and for stocked new
  // items also refill the shelf to its minimum, minus restock already on order.
  const stockCheck = []
  for (const row of stock.rows) {
    const shortfall = Math.max(0, row.needed - row.available)
    const refill = row.stocked && row.condition === 'new'
    const restockQty =
      shortfall > 0 && refill
        ? Math.max(0, row.minQty - (await openRestockQty(db, row.productId)))
        : 0
    stockCheck.push({ ...row, shortfall, restockQty, orderQty: shortfall + restockQty })
  }

  const ticket = ticketResult.rows[0]

  const options = await db.query(
    `
      SELECT o.id::text AS id, o.work_item_id::text AS "workItemId", o.position, o.tier,
             o.product_id::text AS "productId", o.description, o.tire_size AS "tireSize",
             o.quantity, o.unit_price::float8 AS "unitPrice", o.unit_cost::float8 AS "unitCost",
             o.total::float8 AS total, o.created_at AS "createdAt",
             p.tire_line_id::text AS "tireLineId", ph.updated_at AS "photoUpdatedAt",
             (ph.tire_line_id IS NOT NULL) AS "hasPhoto", COALESCE(p.warranty_miles, l.warranty_miles) AS "warrantyMiles",
             p.load_index AS "loadIndex", p.speed_rating AS "speedRating"
      FROM tire_options o
      JOIN work_items wi ON wi.id = o.work_item_id
      JOIN products p ON p.id = o.product_id
      LEFT JOIN tire_lines l ON l.id = p.tire_line_id
      LEFT JOIN tire_line_photos ph ON ph.tire_line_id = p.tire_line_id
      WHERE wi.ticket_id = $1
      ORDER BY o.position
    `,
    [ticketId],
  )

  const items = []
  for (const wi of workItems.rows as (WorkItem & { status: string; createdAt: Date })[]) {
    const itemLines = lines.rows.filter((line) => line.workItemId === wi.id)
    items.push({
      ...wi,
      addedOnWorkOrder:
        ticket.acceptedAt !== null && wi.createdAt > ticket.acceptedAt,
      tireInfo: wi.itemType === 'tires' ? await tireInfoFor(db, wi, settings) : null,
      lines: itemLines,
      subtotal: itemLines.reduce((sum, line) => sum + line.net, 0),
      tireOptions: options.rows.filter((o) => o.workItemId === wi.id),
    })
  }

  const pendingOrders = await db.query(
    `
      SELECT
        id::text AS id,
        line_item_id::text AS "lineItemId",
        item_kind AS "itemKind",
        description,
        vendor,
        qty_ordered AS "qtyOrdered",
        qty_arrived AS "qtyArrived",
        status,
        returnable,
        expected_at::text AS "expectedAt",
        customer_notified_at AS "customerNotifiedAt"
      FROM pending_orders
      WHERE ticket_id = $1 AND status <> 'cancelled'
      ORDER BY id
    `,
    [ticketId],
  )

  const callLogs = await db.query(
    `SELECT id::text AS id, note, called_at AS "calledAt" FROM call_logs WHERE ticket_id = $1 ORDER BY called_at`,
    [ticketId],
  )

  const payments = await db.query(
    `
      SELECT
        id::text AS id,
        payment_kind AS "paymentKind",
        method,
        amount::float8 AS amount,
        note,
        created_at AS "createdAt",
        (SELECT display_name FROM users WHERE id = payments.recorded_by) AS "recordedByName"
      FROM payments
      WHERE ticket_id = $1
      ORDER BY created_at
    `,
    [ticketId],
  )

  const depositsTotal = payments.rows
    .filter((p) => p.paymentKind === 'deposit')
    .reduce((sum, p) => sum + p.amount, 0)

  return {
    ...ticket,
    workItems: items,
    stockCheck,
    pendingOrders: pendingOrders.rows,
    callLogs: callLogs.rows,
    payments: payments.rows,
    depositsTotal,
    minDeposit: settings.minDeposit,
    balance: await loadBalance(db, ticketId),
    invoiceReadiness: ticket.status === 'work_order' ? await invoiceReadiness(db, ticketId) : null,
  }
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

const ticketStatuses = ['quote', 'declined', 'work_order', 'invoiced'] as const

ticketsRouter.get('/', async (req, res) => {
  const status =
    typeof req.query.status === 'string' ? req.query.status : 'quote'
  if (!(ticketStatuses as readonly string[]).includes(status)) {
    throw new ValidationError('Unknown status')
  }
  const customerId =
    typeof req.query.customerId === 'string' && /^\d+$/.test(req.query.customerId)
      ? req.query.customerId
      : null

  const result = await pool.query(
    `
      SELECT
        t.id::text AS id,
        t.quote_number AS "quoteNumber",
        t.status,
        t.valid_until::text AS "validUntil",
        (t.status = 'quote' AND t.valid_until < CURRENT_DATE) AS expired,
        t.created_at AS "createdAt",
        t.accepted_at AS "acceptedAt",
        t.checked_in_at AS "checkedInAt",
        (
          SELECT COUNT(*)::int FROM pending_orders po
          WHERE po.ticket_id = t.id AND po.status IN ('needed', 'ordered')
        ) AS "openOrders",
        c.id::text AS "customerId",
        c.first_name AS "firstName",
        c.last_name AS "lastName",
        c.phone,
        v.year,
        v.make,
        v.model,
        tt.total::float8 AS total,
        t.invoice_number AS "invoiceNumber",
        t.invoiced_at AS "invoicedAt",
        t.paid_at AS "paidAt",
        t.charged_to_account AS "chargedToAccount",
        b.balance::float8 AS balance
      FROM tickets AS t
      JOIN customers AS c ON c.id = t.customer_id
      JOIN vehicles AS v ON v.id = t.vehicle_id
      JOIN ticket_totals AS tt ON tt.ticket_id = t.id
      JOIN ticket_balances AS b ON b.ticket_id = t.id
      WHERE t.status = $1
        AND ($2::bigint IS NULL OR t.customer_id = $2::bigint)
      ORDER BY COALESCE(t.invoiced_at, t.created_at) DESC
      LIMIT 100
    `,
    [status, customerId],
  )

  res.json({ tickets: result.rows })
})

ticketsRouter.post('/', async (req, res) => {
  const body = asBody(req.body)
  const customerId = optionalId(body, 'customerId')
  const vehicleId = optionalId(body, 'vehicleId')
  if (!customerId || !vehicleId) {
    throw new ValidationError('Pick a customer and a vehicle')
  }

  const settings = await loadSettings()

  try {
    // In a transaction so the ticket records who created it.
    const id = await withTransaction(async (client) => {
      const result = await client.query(
        `
          INSERT INTO tickets (customer_id, vehicle_id, tax_rate, valid_until)
          VALUES ($1, $2, $3, CURRENT_DATE + $4::int)
          RETURNING id::text AS id
        `,
        [customerId, vehicleId, settings.productsTaxRate, settings.quoteValidDays],
      )
      return result.rows[0].id as string
    })
    res.status(201).json({ ticket: await loadTicketDetail(pool, id) })
  } catch (error) {
    if ((error as { code?: string }).code === '23503') {
      throw new ValidationError('That vehicle does not belong to this customer')
    }
    throw error
  }
})

ticketsRouter.get('/:id', async (req, res) => {
  res.json({ ticket: await loadTicketDetail(pool, idParam(req.params.id)) })
})

ticketsRouter.post('/:id/decline', async (req, res) => {
  const id = idParam(req.params.id)
  await withTransaction(async (client) => {
    await lockTicket(client, id)
    await client.query(
      `UPDATE tickets SET status = 'declined', declined_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [id],
    )
  })
  res.json({ ticket: await loadTicketDetail(pool, id) })
})

const paymentMethods = ['cash', 'card', 'other'] as const
const orderKinds: OrderKind[] = ['part', 'rim', 'other']

// Accept a quote: reserve stock, order what's missing, take the deposit,
// and (for walk-ins) check the car in. All or nothing.
ticketsRouter.post('/:id/accept', async (req, res) => {
  const id = idParam(req.params.id)
  const body = asBody(req.body)

  const orderLines = Array.isArray(body.orderLines) ? body.orderLines : []
  const deposit =
    body.deposit && typeof body.deposit === 'object' ? asBody(body.deposit) : null
  const overrideReason = optionalText(body, 'depositOverrideReason')
  const checkIn = optionalBoolean(body, 'checkIn', false)
  const acknowledgeExpired = optionalBoolean(body, 'acknowledgeExpired', false)
  const plannedFor = optionalDate(body, 'plannedFor', 'Planned date')

  await withTransaction(async (client) => {
    const ticket = await lockTicket(client, id)
    const settings = await loadSettings(client)

    if (ticket.expired && !acknowledgeExpired) {
      throw new ConflictError('This quote has expired. Confirm the prices are still right.')
    }

    const items = await client.query(
      `SELECT id::text AS id FROM work_items WHERE ticket_id = $1 AND status <> 'not_performed'`,
      [id],
    )
    const lineCount = await client.query(
      `SELECT COUNT(*)::int AS n FROM line_items li JOIN work_items wi ON wi.id = li.work_item_id WHERE wi.ticket_id = $1`,
      [id],
    )
    // Quoted tire options need the customer's choice first.
    const undecided = await client.query(
      `SELECT 1 FROM work_items WHERE ticket_id = $1 AND item_type = 'tires' AND status = 'pending'
         AND tire_product_id IS NULL AND NOT customer_supplied_tires`,
      [id],
    )
    if (undecided.rowCount! > 0) {
      throw new ConflictError('Pick one of the quoted tire options before accepting')
    }
    if (lineCount.rows[0].n === 0) {
      throw new ValidationError('Add something to the quote before accepting it')
    }

    // 1. Reserve or order every tire and sensor.
    for (const item of items.rows) await allocateLines(client, id, item.id)

    // 2. Order the parts, rims and other items the advisor ticked.
    const seen = new Set<string>()
    for (const raw of orderLines) {
      const entry = asBody(raw)
      const lineId = optionalId(entry, 'lineItemId')
      const kind = entry.itemKind as OrderKind
      if (!lineId || !orderKinds.includes(kind)) {
        throw new ValidationError('Each ordered line needs a line and a kind (part, rim or other)')
      }
      // The same line twice would order it twice.
      if (seen.has(lineId)) throw new ValidationError('The same line was picked to order twice')
      seen.add(lineId)
      const line = await client.query(
        `
          SELECT li.id::text AS id, li.description, li.quantity::float8 AS quantity,
                 li.unit_cost::float8 AS "unitCost"
          FROM line_items li JOIN work_items wi ON wi.id = li.work_item_id
          WHERE li.id = $1 AND wi.ticket_id = $2 AND li.line_kind IN ('part', 'custom')
        `,
        [lineId, id],
      )
      if (line.rowCount === 0) {
        throw new ValidationError('Only parts and other items on this quote can be ordered')
      }
      await orderNonInventoryLine(client, id, line.rows[0], kind)
    }

    // 3. Special orders need a deposit (or a recorded reason): tires we don't
    // stock, and rims. A stocked tire that's just out right now doesn't: if
    // the customer walks, it simply becomes shelf stock.
    const special = await client.query(
      `
        SELECT 1 FROM pending_orders po
        LEFT JOIN products p ON p.id = po.product_id
        WHERE po.ticket_id = $1 AND po.status <> 'cancelled'
          AND (po.item_kind = 'rim' OR (po.item_kind = 'tire' AND NOT p.stocked))
        LIMIT 1
      `,
      [id],
    )
    const amount = deposit ? requiredNumber(deposit, 'amount', 'Deposit', { min: 0.01, money: true }) : 0
    if (special.rowCount! > 0 && amount < settings.minDeposit && !overrideReason) {
      throw new ValidationError(
        `Special orders need a deposit of at least $${settings.minDeposit.toFixed(2)}, ` +
          'or a reason for skipping it',
      )
    }

    if (deposit) {
      const method = deposit.method as (typeof paymentMethods)[number]
      if (!paymentMethods.includes(method)) {
        throw new ValidationError('Deposit method must be cash, card or other')
      }
      await client.query(
        `INSERT INTO payments (ticket_id, payment_kind, method, amount) VALUES ($1, 'deposit', $2, $3)`,
        [id, method, amount],
      )
    }

    await client.query(
      `
        UPDATE tickets
        SET status = 'work_order',
            accepted_at = NOW(),
            accepted_by = current_app_user(),
            deposit_override_reason = $2,
            planned_for = $3,
            updated_at = NOW()
        WHERE id = $1
      `,
      [id, special.rowCount! > 0 && amount < settings.minDeposit ? overrideReason : null, plannedFor],
    )

    if (checkIn) {
      await client.query(`UPDATE tickets SET checked_in_at = NOW() WHERE id = $1`, [id])
      await syncQueue(client, id)
    }
  })

  res.json({ ticket: await loadTicketDetail(pool, id) })
})

// The vehicle is at the shop: its work joins the lift queues.
ticketsRouter.post('/:id/check-in', async (req, res) => {
  const id = idParam(req.params.id)
  await withTransaction(async (client) => {
    const ticket = await lockTicket(client, id, ['work_order'])
    if (ticket.checkedInAt) throw new ConflictError('This vehicle is already checked in')
    await client.query(`UPDATE tickets SET checked_in_at = NOW(), updated_at = NOW() WHERE id = $1`, [id])
    await syncQueue(client, id)
  })
  res.json({ ticket: await loadTicketDetail(pool, id) })
})

// When the advisor expects to do the work (e.g. the day the tires arrive).
ticketsRouter.put('/:id/planned-for', async (req, res) => {
  const id = idParam(req.params.id)
  const plannedFor = optionalDate(asBody(req.body), 'plannedFor', 'Planned date')
  await withTransaction(async (client) => {
    await lockTicket(client, id, ['work_order'])
    await client.query(`UPDATE tickets SET planned_for = $2, updated_at = NOW() WHERE id = $1`, [
      id,
      plannedFor,
    ])
  })
  res.json({ ticket: await loadTicketDetail(pool, id) })
})

// Undo an acceptance, only while nothing has actually happened yet.
ticketsRouter.post('/:id/revert-to-quote', async (req, res) => {
  const id = idParam(req.params.id)
  await withTransaction(async (client) => {
    await lockTicket(client, id, ['work_order'])

    const blockers = await client.query(
      `
        SELECT
          (SELECT paid > 0 FROM ticket_balances WHERE ticket_id = $1) AS paid,
          EXISTS (
            SELECT 1 FROM work_items
            WHERE ticket_id = $1 AND (status <> 'pending' OR started_at IS NOT NULL)
          ) AS started,
          EXISTS (
            SELECT 1 FROM queue_entries q JOIN work_items wi ON wi.id = q.work_item_id
            WHERE wi.ticket_id = $1 AND q.status <> 'waiting'
          ) AS on_lift,
          EXISTS (
            SELECT 1 FROM pending_orders
            WHERE ticket_id = $1 AND status NOT IN ('needed', 'cancelled')
          ) AS ordered
      `,
      [id],
    )
    const b = blockers.rows[0]
    if (b.paid) throw new ConflictError('A deposit was taken. Refund it before going back to a quote.')
    if (b.started || b.on_lift) throw new ConflictError('Work has already started on this vehicle.')
    if (b.ordered) throw new ConflictError('Items have already been ordered. Cancel those orders first.')

    const lines = await client.query(
      `SELECT li.id::text AS id FROM line_items li JOIN work_items wi ON wi.id = li.work_item_id WHERE wi.ticket_id = $1`,
      [id],
    )
    for (const line of lines.rows) await releaseLine(client, line.id)

    await client.query(
      `DELETE FROM queue_entries WHERE work_item_id IN (SELECT id FROM work_items WHERE ticket_id = $1)`,
      [id],
    )
    await client.query(
      `
        UPDATE tickets
        SET status = 'quote', accepted_at = NULL, checked_in_at = NULL,
            deposit_override_reason = NULL, planned_for = NULL, updated_at = NOW()
        WHERE id = $1
      `,
      [id],
    )
  })
  res.json({ ticket: await loadTicketDetail(pool, id) })
})

ticketsRouter.post('/:id/work-items', async (req, res) => {
  const ticketId = idParam(req.params.id)
  const body = asBody(req.body)
  const itemType = body.itemType as WorkItemType
  if (!workItemTypes.includes(itemType)) {
    throw new ValidationError('Work item type must be tires, alignment, mechanic or other')
  }
  const title = optionalText(body, 'title')

  await withTransaction(async (client) => {
    const ticket = await lockTicket(client, ticketId, editable)
    const { vehicle } = ticket
    const settings = await loadSettings(client)

    if (itemType === 'alignment') {
      const existing = await client.query(
        `SELECT 1 FROM work_items WHERE ticket_id = $1 AND item_type = 'alignment'`,
        [ticketId],
      )
      if (existing.rowCount! > 0) {
        throw new ConflictError('This quote already has an alignment')
      }
    }

    const tire = itemType === 'tires' ? readTireConfig(body) : null
    if (tire?.tireProductId) await loadProduct(client, tire.tireProductId, 'tire')

    const created = await client.query(
      `
        INSERT INTO work_items (
          ticket_id, item_type, title, sort_order, customer_supplied_tires,
          tire_product_id, tire_quantity, old_tires_removed, customer_tire_size
        )
        SELECT $1, $2, $3, COALESCE(MAX(sort_order) + 1, 0), $4, $5, $6, $7, $8
        FROM work_items WHERE ticket_id = $1
        RETURNING id::text AS id
      `,
      [
        ticketId,
        itemType,
        title,
        tire?.customerSuppliedTires ?? false,
        tire?.tireProductId ?? null,
        tire?.tireQuantity ?? null,
        tire?.oldTiresRemoved ?? null,
        tire?.customerTireSize ?? null,
      ],
    )

    const workItem = (
      await client.query(`SELECT ${workItemColumns} FROM work_items AS wi WHERE wi.id = $1`, [
        created.rows[0].id,
      ])
    ).rows[0] as WorkItem

    if (tire) {
      const difficulty =
        tire.difficultyMinutes ??
        defaultDifficultyMinutes(await tireInfoFor(client, workItem, settings))
      await client.query('UPDATE work_items SET difficulty_minutes = $2 WHERE id = $1', [
        workItem.id,
        difficulty,
      ])
    }

    await rebuildGeneratedLines(client, workItem, vehicle, settings)

    // Added to a work order: reserve its tires now and join the queue.
    if (ticket.status === 'work_order') {
      await allocateLines(client, ticketId, workItem.id)
      await syncQueue(client, ticketId)
    }
  })

  res.status(201).json({ ticket: await loadTicketDetail(pool, ticketId) })
})

// ---------------------------------------------------------------------------
// Work items
// ---------------------------------------------------------------------------

// Update a work item's settings and rebuild its generated lines. For an
// alignment this recalculates the price from the vehicle as it is now.
workItemsRouter.put('/:id', async (req, res) => {
  const id = idParam(req.params.id)
  const body = asBody(req.body)

  const ticketId = await withTransaction(async (client) => {
    const { ticket, ticketId, vehicle, workItem } = await lockWorkItem(client, id, editable)
    const settings = await loadSettings(client)
    const title = optionalText(body, 'title')
    const onWorkOrder = ticket.status === 'work_order'

    // Renaming is always fine. Repricing only for work added on the work order.
    if (workItem.itemType === 'tires' || workItem.itemType === 'alignment') {
      assertChangeable(ticket, workItem.createdAt, 'work item')
      if (onWorkOrder) await releaseWorkItem(client, id)
    }

    let updated: WorkItem = { ...workItem, title }

    if (workItem.itemType === 'tires') {
      const tire = readTireConfig(body)
      if (tire.tireProductId) await loadProduct(client, tire.tireProductId, 'tire')
      updated = { ...updated, ...tire, difficultyMinutes: tire.difficultyMinutes ?? 0 }
      if (tire.difficultyMinutes === null) {
        updated.difficultyMinutes = defaultDifficultyMinutes(
          await tireInfoFor(client, updated, settings),
        )
      }
    }

    await client.query(
      `
        UPDATE work_items
        SET title = $2,
            customer_supplied_tires = $3,
            tire_product_id = $4,
            tire_quantity = $5,
            old_tires_removed = $6,
            customer_tire_size = $7,
            difficulty_minutes = $8,
            -- A tire (or the customer's own) is now set, so any quoted
            -- options for this item are settled.
            options_size = NULL
        WHERE id = $1
      `,
      [
        id,
        updated.title,
        updated.customerSuppliedTires,
        updated.tireProductId,
        updated.tireQuantity,
        updated.oldTiresRemoved,
        updated.customerTireSize,
        updated.difficultyMinutes,
      ],
    )
    await client.query('DELETE FROM tire_options WHERE work_item_id = $1', [id])

    await rebuildGeneratedLines(client, updated, vehicle, settings)
    if (onWorkOrder) {
      await allocateLines(client, ticketId, id)
      await syncQueue(client, ticketId)
    }
    return ticketId
  })

  res.json({ ticket: await loadTicketDetail(pool, ticketId) })
})

workItemsRouter.delete('/:id', async (req, res) => {
  const id = idParam(req.params.id)
  const ticketId = await withTransaction(async (client) => {
    const { ticket, ticketId, workItem } = await lockWorkItem(client, id, editable)
    assertChangeable(ticket, workItem.createdAt, 'work item')
    if (ticket.status === 'work_order') await releaseWorkItem(client, id)
    await client.query('DELETE FROM work_items WHERE id = $1', [id])
    await syncQueue(client, ticketId)
    await repriceTpms(client, ticketId)
    return ticketId
  })
  res.json({ ticket: await loadTicketDetail(pool, ticketId) })
})

// Add a line the advisor picks: TPMS, trailer stems, labor, parts, custom.
workItemsRouter.post('/:id/lines', async (req, res) => {
  const id = idParam(req.params.id)
  const body = asBody(req.body)
  const kind = body.kind

  const ticketId = await withTransaction(async (client) => {
    const { ticket, ticketId, workItem } = await lockWorkItem(client, id, editable)
    const settings = await loadSettings(client)
    const type = workItem.itemType

    const quantity = (label = 'Quantity', integer = true) =>
      requiredNumber(body, 'quantity', label, { min: integer ? 1 : 0.1, integer })

    let line: NewLine

    switch (kind) {
      case 'tpms_sensor': {
        if (type !== 'tires' && type !== 'other') {
          throw new ValidationError('TPMS sensors go on a Tires or Other work item')
        }
        let productId = optionalId(body, 'productId')
        if (!productId) {
          const sensor = await client.query(
            `SELECT id::text AS id FROM products WHERE product_type = 'tpms_sensor' ORDER BY id LIMIT 1`,
          )
          if (sensor.rowCount === 0) {
            throw new ValidationError('Add a TPMS sensor product to inventory first')
          }
          productId = sensor.rows[0].id as string
        }
        const product = await loadProduct(client, productId, 'tpms_sensor')
        const qty = quantity()
        const prices = await ticketTpmsPrices(client, ticketId, settings)
        line = {
          lineKind: 'product',
          productId: product.id,
          serviceCode: 'tpms_sensor',
          description: productDescription(product),
          quantity: qty,
          unitPrice: qty >= 2 ? prices.multi : prices.single,
          unitCost: product.cost,
          taxable: true,
          tpmsPrices: prices,
        }
        break
      }

      case 'tpms_reset':
        line = {
          lineKind: 'service',
          serviceCode: 'tpms_reset',
          description: 'TPMS reset (customer sensors)',
          quantity: optionalNumber(body, 'quantity', 'Quantity', { min: 1, integer: true }) ?? 1,
          unitPrice: settings.tpmsResetPrice,
          taxable: false,
        }
        break

      case 'trailer_valve_stem':
        line = {
          lineKind: 'service',
          serviceCode: 'trailer_valve_stem',
          description: 'Trailer valve stem',
          quantity: quantity(),
          unitPrice: settings.trailerValveStemPrice,
          taxable: false,
        }
        break

      case 'labor':
        if (type !== 'mechanic') throw new ValidationError('Labor goes on a Mechanic work item')
        line = {
          lineKind: 'labor',
          description: optionalText(body, 'description') ?? 'Labor',
          quantity: quantity('Hours', false),
          unitPrice: settings.shopRatePerHour,
          taxable: false,
        }
        break

      case 'part':
        // Alignment takes parts too: a camber kit to bring it into spec.
        if (type !== 'mechanic' && type !== 'alignment') {
          throw new ValidationError('Parts go on a Mechanic or Alignment work item')
        }
        line = {
          lineKind: 'part',
          description: requiredText(body, 'description', 'Part description'),
          quantity: quantity(),
          unitPrice: requiredNumber(body, 'unitPrice', 'List price', { money: true }),
          unitCost: optionalNumber(body, 'unitCost', 'Cost', { money: true }),
          taxable: true,
        }
        break

      case 'custom':
        line = {
          lineKind: 'custom',
          description: requiredText(body, 'description', 'Description'),
          quantity: quantity(),
          unitPrice: requiredNumber(body, 'unitPrice', 'Price', { money: true }),
          unitCost: optionalNumber(body, 'unitCost', 'Cost', { money: true }),
          taxable: optionalBoolean(body, 'taxable', true),
        }
        break

      default:
        throw new ValidationError('Unknown line kind')
    }

    const next = await client.query(
      'SELECT COALESCE(MAX(sort_order), 99) + 1 AS n FROM line_items WHERE work_item_id = $1',
      [id],
    )
    const lineId = await insertLine(client, id, line, {
      sortOrder: Math.max(100, next.rows[0].n),
    })
    if (line.serviceCode === 'tpms_sensor') await repriceTpms(client, ticketId)

    // On a work order, new items are reserved or ordered right away.
    if (ticket.status === 'work_order') {
      if (line.productId) {
        await allocateLines(client, ticketId, id)
      } else if ((line.lineKind === 'part' || line.lineKind === 'custom') && body.order === true) {
        const kind = (body.orderKind ?? (line.lineKind === 'part' ? 'part' : 'other')) as OrderKind
        if (!orderKinds.includes(kind)) throw new ValidationError('Order kind must be part, rim or other')
        await orderNonInventoryLine(
          client,
          ticketId,
          { id: lineId, description: line.description, quantity: line.quantity, unitCost: line.unitCost ?? null },
          kind,
        )
      }
      await syncQueue(client, ticketId)
    }
    return ticketId
  })

  res.status(201).json({ ticket: await loadTicketDetail(pool, ticketId) })
})

// ---------------------------------------------------------------------------
// Line items
// ---------------------------------------------------------------------------

lineItemsRouter.put('/:id', async (req, res) => {
  const id = idParam(req.params.id)
  const body = asBody(req.body)

  const ticketId = await withTransaction(async (client) => {
    const { ticket, ticketId, vehicle, workItem, line } = await lockLine(client, id, editable)
    assertChangeable(ticket, line.createdAt, 'line')
    const settings = await loadSettings(client)

    if (ticket.status === 'work_order' && 'quantity' in body && line.hasStockOrOrder) {
      throw new ConflictError(
        'This line already has stock reserved or on order. Remove it and add it again with the new quantity.',
      )
    }

    const sets: string[] = []
    const params: unknown[] = [id]
    const set = (column: string, value: unknown) => {
      params.push(value)
      sets.push(`${column} = $${params.length}`)
    }

    if ('discountType' in body || 'discountValue' in body) {
      const { discountType, discountValue } = readDiscount(body)
      set('discount_type', discountType)
      set('discount_value', discountValue)
    }

    if ('quantity' in body) {
      if (line.generated) {
        throw new ConflictError('Change the work item settings to change this quantity')
      }
      const integer = line.lineKind !== 'labor'
      const quantity = requiredNumber(body, 'quantity', integer ? 'Quantity' : 'Hours', {
        min: integer ? 1 : 0.1,
        integer,
      })
      set('quantity', quantity)
    }

    if ('unitPrice' in body) {
      set('unit_price', requiredNumber(body, 'unitPrice', 'Price', { money: true }))
      set('price_overridden', true)
    }

    if (!line.generated) {
      if ('description' in body) set('description', requiredText(body, 'description', 'Description'))
      if ('unitCost' in body) set('unit_cost', optionalNumber(body, 'unitCost', 'Cost', { money: true }))
      if ('taxable' in body && line.lineKind === 'custom') {
        set('taxable', optionalBoolean(body, 'taxable', true))
      }
    }

    if (sets.length > 0) {
      await client.query(`UPDATE line_items SET ${sets.join(', ')} WHERE id = $1`, params)
    }

    // Go back to the standard price for this line.
    if (body.resetPrice === true) {
      // A sensor starts again from its own single price; repriceTpms below
      // brings it to the 1 or 2+ price for the ticket.
      await client.query(
        `UPDATE line_items SET price_overridden = FALSE,
                unit_price = CASE WHEN service_code = 'tpms_sensor' THEN tpms_single_price ELSE unit_price END
         WHERE id = $1`,
        [id],
      )
      if (line.generated) {
        // Rebuilding replaces the lines, so free their stock first and re-reserve.
        const onWorkOrder = ticket.status === 'work_order'
        if (onWorkOrder) await releaseWorkItem(client, workItem.id)
        await rebuildGeneratedLines(client, workItem, vehicle, settings, lineKey(line))
        if (onWorkOrder) {
          await allocateLines(client, ticketId, workItem.id)
          await syncQueue(client, ticketId)
        }
      }
    }

    // Quantity changes and price resets both move the per-car sensor price.
    if (line.serviceCode === 'tpms_sensor') await repriceTpms(client, ticketId)

    return ticketId
  })

  res.json({ ticket: await loadTicketDetail(pool, ticketId) })
})

lineItemsRouter.delete('/:id', async (req, res) => {
  const id = idParam(req.params.id)
  const ticketId = await withTransaction(async (client) => {
    const { ticket, ticketId, line } = await lockLine(client, id, editable)
    assertChangeable(ticket, line.createdAt, 'line')
    if (line.generated) {
      throw new ConflictError(
        'This line comes from the work item settings. Change those, or discount it 100%.',
      )
    }
    if (ticket.status === 'work_order') await releaseLine(client, id)
    await client.query('DELETE FROM line_items WHERE id = $1', [id])
    await syncQueue(client, ticketId)
    if (line.serviceCode === 'tpms_sensor') await repriceTpms(client, ticketId)
    return ticketId
  })
  res.json({ ticket: await loadTicketDetail(pool, ticketId) })
})
