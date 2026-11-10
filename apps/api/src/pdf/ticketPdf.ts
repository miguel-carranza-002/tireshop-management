// Printable quote / work order / invoice, drawn with pdfkit.
// Costs and internal notes are never printed.
import PDFDocument from 'pdfkit'
import type { Balance } from '../balances.js'

export type ShopDetails = {
  shopName: string
  shopAddress: string | null
  shopPhone: string | null
  invoiceFooter: string | null
}

type PdfLine = {
  description: string
  quantity: number
  unitPrice: number
  discount: number
  net: number
}

type PdfWorkItem = {
  itemType: 'tires' | 'alignment' | 'mechanic' | 'other'
  title: string | null
  status: 'pending' | 'completed' | 'not_performed'
  lines: PdfLine[]
  // Quoted tire options the customer hasn't chosen between yet.
  tireOptions?: { tier: string; description: string; quantity: number; unitPrice: number; total: number }[]
}

const tierLabels: Record<string, string> = { cheap: 'Good', medium: 'Better', premium: 'Best', option: 'Option' }

export type PdfTicket = {
  quoteNumber: number
  invoiceNumber: number | null
  status: 'quote' | 'declined' | 'work_order' | 'invoiced'
  taxRate: number
  validUntil: string
  createdAt: string | Date
  acceptedAt: string | Date | null
  invoicedAt: string | Date | null
  paidAt: string | Date | null
  customer: { firstName: string; lastName: string | null; phone: string | null }
  vehicle: {
    year: number
    make: string
    model: string
    licensePlate: string | null
    vin: string | null
  }
  totals: { gross: number; discount: number; subtotal: number; taxableSubtotal: number; tax: number; total: number }
  workItems: PdfWorkItem[]
  payments: { paymentKind: string; method: string; amount: number; note: string | null; createdAt: string | Date }[]
  balance: Balance
}

const typeLabels: Record<PdfWorkItem['itemType'], string> = {
  tires: 'Tires',
  alignment: 'Alignment',
  mechanic: 'Mechanic work',
  other: 'Other',
}

const paymentLabels: Record<string, string> = {
  deposit: 'Deposit',
  payment: 'Payment',
  refund: 'Refund',
  return_fee: 'Return fee',
}

// The built-in PDF fonts only cover basic Latin, so stick to ASCII signs.
const money = (n: number) =>
  `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const date = (value: string | Date) => {
  // Plain YYYY-MM-DD dates are read as local dates.
  const d =
    typeof value === 'string' && value.length === 10
      ? (([y, m, day]) => new Date(y, m - 1, day))(value.split('-').map(Number))
      : new Date(value)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, ''))

export function documentNumber(ticket: Pick<PdfTicket, 'status' | 'quoteNumber' | 'invoiceNumber'>) {
  if (ticket.status === 'invoiced') return `INV-${ticket.invoiceNumber}`
  if (ticket.status === 'work_order') return `WO-${ticket.quoteNumber}`
  return `Q-${ticket.quoteNumber}`
}

// Page geometry (US Letter, 0.6" margins).
const LEFT = 44
const RIGHT = 612 - 44
const WIDTH = RIGHT - LEFT
const BOTTOM = 792 - 60

const cols = {
  description: { x: LEFT + 6, w: 270 },
  qty: { x: LEFT + 280, w: 40 },
  each: { x: LEFT + 324, w: 70 },
  discount: { x: LEFT + 398, w: 60 },
  total: { x: LEFT + 462, w: WIDTH - 468 },
}

const INK = '#0f172a'
const MUTED = '#64748b'
const RULE = '#cbd5e1'
const BAND = '#f1f5f9'

export function renderTicketPdf(ticket: PdfTicket, shop: ShopDetails): PDFKit.PDFDocument {
  const number = documentNumber(ticket)
  const isQuote = ticket.status === 'quote' || ticket.status === 'declined'
  const isInvoice = ticket.status === 'invoiced'
  const title = isInvoice ? 'INVOICE' : ticket.status === 'work_order' ? 'WORK ORDER' : 'QUOTE'

  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: 44, bottom: 40, left: LEFT, right: 612 - RIGHT },
    bufferPages: true,
    info: { Title: `${shop.shopName} ${number}`, Author: shop.shopName },
  })
  doc.fillColor(INK)

  // --- Header: shop on the left, document title on the right -------------
  doc.font('Helvetica-Bold').fontSize(18).text(shop.shopName, LEFT, 44, { width: 300 })
  doc.font('Helvetica').fontSize(9.5).fillColor(MUTED)
  for (const line of (shop.shopAddress ?? '').split('\n').filter(Boolean)) doc.text(line, { width: 300 })
  if (shop.shopPhone) doc.text(shop.shopPhone, { width: 300 })
  const shopBottom = doc.y

  doc.fillColor(INK).font('Helvetica-Bold').fontSize(20).text(title, LEFT, 44, { width: WIDTH, align: 'right' })
  doc.fontSize(11).text(number, { width: WIDTH, align: 'right' })
  doc.font('Helvetica').fontSize(9.5).fillColor(MUTED)
  const metaLines: string[] = []
  if (isInvoice && ticket.invoicedAt) {
    metaLines.push(`Date: ${date(ticket.invoicedAt)}`, `Work order: WO-${ticket.quoteNumber}`)
  } else if (ticket.status === 'work_order') {
    metaLines.push(`Accepted: ${date(ticket.acceptedAt ?? ticket.createdAt)}`)
  } else {
    metaLines.push(`Date: ${date(ticket.createdAt)}`, `Valid until: ${date(ticket.validUntil)}`)
  }
  for (const line of metaLines) doc.text(line, { width: WIDTH, align: 'right' })

  let y = Math.max(shopBottom, doc.y) + 14
  doc.moveTo(LEFT, y).lineTo(RIGHT, y).lineWidth(1).strokeColor(RULE).stroke()
  y += 12

  // --- Customer and vehicle ----------------------------------------------
  const half = WIDTH / 2
  const block = (x: number, heading: string, lines: string[]) => {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text(heading.toUpperCase(), x, y, { width: half - 10, characterSpacing: 0.5 })
    doc.font('Helvetica').fontSize(10.5).fillColor(INK)
    for (const line of lines) doc.text(line, x, doc.y + 1, { width: half - 10 })
    return doc.y
  }
  const c = ticket.customer
  const v = ticket.vehicle
  const leftEnd = block(LEFT, isInvoice ? 'Bill to' : 'Customer', [
    [c.firstName, c.lastName].filter(Boolean).join(' '),
    ...(c.phone ? [formatPhone(c.phone)] : []),
  ])
  const rightEnd = block(LEFT + half, 'Vehicle', [
    `${v.year} ${v.make} ${v.model}`,
    ...(v.licensePlate ? [`Plate: ${v.licensePlate}`] : []),
    ...(v.vin ? [`VIN: ${v.vin}`] : []),
  ])
  y = Math.max(leftEnd, rightEnd) + 18

  // --- Line items, grouped by work item -----------------------------------
  const tableHeader = () => {
    doc.rect(LEFT, y, WIDTH, 18).fill(INK)
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff')
    const ty = y + 5
    doc.text('DESCRIPTION', cols.description.x, ty, { width: cols.description.w })
    doc.text('QTY', cols.qty.x, ty, { width: cols.qty.w, align: 'right' })
    doc.text('EACH', cols.each.x, ty, { width: cols.each.w, align: 'right' })
    doc.text('DISCOUNT', cols.discount.x, ty, { width: cols.discount.w, align: 'right' })
    doc.text('AMOUNT', cols.total.x, ty, { width: cols.total.w, align: 'right' })
    doc.fillColor(INK)
    y += 22
  }
  const ensureRoom = (needed: number) => {
    if (y + needed > BOTTOM) {
      doc.addPage()
      y = 44
      tableHeader()
    }
  }

  tableHeader()
  const items = ticket.workItems.filter((w) => w.status !== 'not_performed' && w.lines.length > 0)
  for (const item of items) {
    ensureRoom(40)
    doc.rect(LEFT, y, WIDTH, 17).fill(BAND)
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(9.5)
    doc.text(item.title ? `${typeLabels[item.itemType]} - ${item.title}` : typeLabels[item.itemType], cols.description.x, y + 4, {
      width: WIDTH - 12,
    })
    y += 21

    for (const line of item.lines) {
      doc.font('Helvetica').fontSize(9.5)
      const height = doc.heightOfString(line.description, { width: cols.description.w })
      ensureRoom(height + 6)
      // A page break redraws the header in bold white, so set the style after it.
      doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(line.description, cols.description.x, y, { width: cols.description.w })
      doc.text(qty(line.quantity), cols.qty.x, y, { width: cols.qty.w, align: 'right' })
      doc.text(money(line.unitPrice), cols.each.x, y, { width: cols.each.w, align: 'right' })
      if (line.discount > 0) {
        doc.text(`-${money(line.discount)}`, cols.discount.x, y, { width: cols.discount.w, align: 'right' })
      }
      doc.text(money(line.net), cols.total.x, y, { width: cols.total.w, align: 'right' })
      y += height + 6
    }
    y += 2
  }
  // Tire options: each priced out the door (tires, mount & balance, disposal, tax).
  const choices = ticket.workItems.filter((w) => w.status === 'pending' && (w.tireOptions?.length ?? 0) > 0)
  for (const item of choices) {
    const opts = item.tireOptions!
    ensureRoom(40 + opts.length * 18)
    doc.rect(LEFT, y, WIDTH, 17).fill(BAND)
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(9.5)
    doc.text(
      `Tire options${item.title ? ` - ${item.title}` : ''}: choose one (${opts[0].quantity} tires)`,
      cols.description.x,
      y + 4,
      { width: cols.discount.x - cols.description.x },
    )
    doc.text('OUT THE DOOR', cols.discount.x, y + 4, { width: cols.discount.w + cols.total.w + 4, align: 'right' })
    y += 21
    for (const o of opts) {
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(tierLabels[o.tier] ?? 'Option', cols.description.x, y, { width: 50 })
      doc.font('Helvetica').text(o.description, cols.description.x + 52, y, { width: cols.description.w - 52 })
      doc.text(qty(o.quantity), cols.qty.x, y, { width: cols.qty.w, align: 'right' })
      doc.text(money(o.unitPrice), cols.each.x, y, { width: cols.each.w, align: 'right' })
      doc.font('Helvetica-Bold').text(money(o.total), cols.total.x, y, { width: cols.total.w, align: 'right' })
      y += 18
    }
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
    doc.text('Totals include mount & balance, disposal of the old tires and tax. Not included in the totals below until chosen.', cols.description.x, y, {
      width: WIDTH - 12,
    })
    y = doc.y + 8
  }

  if (items.length === 0 && choices.length === 0) {
    doc.font('Helvetica-Oblique').fontSize(9.5).fillColor(MUTED).text('No charges.', cols.description.x, y)
    y += 18
  }

  // --- Totals ---------------------------------------------------------------
  const b = ticket.balance
  const rows: { label: string; value: string; bold?: boolean; big?: boolean; rule?: boolean }[] = []
  if (ticket.totals.discount > 0) {
    rows.push({ label: 'Before discounts', value: money(ticket.totals.gross) })
    rows.push({ label: 'Discounts', value: `-${money(ticket.totals.discount)}` })
  }
  rows.push({ label: 'Subtotal', value: money(ticket.totals.subtotal) })
  const pct = (ticket.taxRate * 100).toFixed(3).replace(/\.?0+$/, '')
  rows.push({ label: `Tax ${pct}% on ${money(ticket.totals.taxableSubtotal)}`, value: money(ticket.totals.tax) })
  rows.push({ label: 'Total', value: money(ticket.totals.total), bold: true, big: true, rule: true })

  if (!isQuote) {
    if (b.returnFees > 0) rows.push({ label: 'Return fee (special order)', value: money(b.returnFees) })
    if (b.depositKept > 0) rows.push({ label: 'Deposit kept (unclaimed order)', value: money(b.depositKept) })
    for (const p of ticket.payments) {
      if (!(p.paymentKind in paymentLabels) || p.paymentKind === 'return_fee') continue
      rows.push({
        label: `${paymentLabels[p.paymentKind]} - ${p.method} ${date(p.createdAt)}`,
        value: p.paymentKind === 'refund' ? money(p.amount) : `-${money(p.amount)}`,
      })
    }
    if (ticket.payments.length > 0 || b.returnFees > 0 || b.depositKept > 0 || isInvoice) {
      rows.push({
        label: b.balance < 0 ? 'Credit due to customer' : 'Balance due',
        value: money(Math.abs(b.balance)),
        bold: true,
        big: true,
        rule: true,
      })
    }
  }

  const labelX = LEFT + WIDTH - 300
  const labelW = 210
  const valueX = labelX + labelW
  const valueW = RIGHT - valueX - 6
  ensureRoom(rows.length * 18 + 40)
  y += 6
  doc.moveTo(LEFT, y).lineTo(RIGHT, y).lineWidth(0.75).strokeColor(RULE).stroke()
  y += 10
  for (const row of rows) {
    if (row.rule) {
      doc.moveTo(labelX, y - 3).lineTo(RIGHT, y - 3).lineWidth(0.75).strokeColor(RULE).stroke()
      y += 3
    }
    const size = row.big ? 12 : 9.5
    doc.font(row.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(row.bold ? INK : MUTED)
    doc.text(row.label, labelX, y, { width: labelW, align: 'right' })
    doc.fillColor(INK).text(row.value, valueX, y, { width: valueW, align: 'right' })
    y += size + 7
  }

  // Paid stamp, or a note on what's owed.
  if (isInvoice) {
    const owed = !ticket.paidAt
    doc.font('Helvetica-Bold').fontSize(16).fillColor(owed ? '#b45309' : '#15803d')
    doc.text(owed ? 'CHARGED TO ACCOUNT' : 'PAID', LEFT, y - 30, { width: 220 })
    if (!owed && ticket.paidAt) {
      doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(date(ticket.paidAt), LEFT, doc.y, { width: 220 })
    }
  }

  y += 14
  if (isQuote) {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
    doc.text(
      `Prices are guaranteed until ${date(ticket.validUntil)}. Special-order tires and rims need a deposit when you accept.`,
      LEFT,
      y,
      { width: WIDTH },
    )
    y = doc.y + 8
  }
  if (shop.invoiceFooter) {
    ensureRoom(30)
    doc.font('Helvetica-Oblique').fontSize(10).fillColor(INK).text(shop.invoiceFooter, LEFT, y + 6, { width: WIDTH, align: 'center' })
  }

  // --- Page numbers -----------------------------------------------------------
  const range = doc.bufferedPageRange()
  if (range.count > 1) {
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i)
      // Writing below the bottom margin would otherwise start a new page.
      doc.page.margins.bottom = 0
      doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      doc.text(`${number} - page ${i + 1} of ${range.count}`, LEFT, 792 - 34, { width: WIDTH, align: 'right', lineBreak: false })
    }
  }

  return doc
}

function formatPhone(phone: string) {
  const d = phone.replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return phone
}
