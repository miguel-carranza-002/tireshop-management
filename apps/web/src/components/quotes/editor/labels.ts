import type { Payment, PendingOrder, Queue, Ticket, WorkItemType } from '../../../api'
import type { Tone } from '../../../ui'

export const typeLabels: Record<WorkItemType, string> = {
  tires: 'Tires',
  alignment: 'Alignment',
  mechanic: 'Mechanic work',
  other: 'Other',
}

export const queueOf: Partial<Record<WorkItemType, Queue>> = {
  tires: 'tires',
  mechanic: 'mechanic',
  alignment: 'alignment',
}

export const statusBadges: Record<Ticket['status'], { label: string; tone: Tone }> = {
  quote: { label: 'Open quote', tone: 'accent' },
  declined: { label: 'Declined', tone: 'danger' },
  work_order: { label: 'Work order', tone: 'success' },
  invoiced: { label: 'Invoiced', tone: 'internal' },
}

export const orderStatus: Record<PendingOrder['status'], { label: string; tone: Tone }> = {
  needed: { label: 'Needs ordering', tone: 'warning' },
  ordered: { label: 'Ordered', tone: 'accent' },
  arrived: { label: 'Arrived', tone: 'success' },
  installed: { label: 'Installed', tone: 'neutral' },
  returned: { label: 'Returned', tone: 'neutral' },
  unclaimed: { label: 'Unclaimed', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

export const paymentLabels: Record<Payment['paymentKind'], string> = {
  deposit: 'Deposit',
  payment: 'Payment',
  refund: 'Refund',
  return_fee: 'Return fee',
}

export function ticketNumber(ticket: Pick<Ticket, 'status' | 'quoteNumber' | 'invoiceNumber'>) {
  if (ticket.status === 'invoiced') return `INV-${ticket.invoiceNumber}`
  if (ticket.status === 'work_order') return `WO-${ticket.quoteNumber}`
  return `Q-${ticket.quoteNumber}`
}

// Every action that changes the ticket returns the updated ticket.
export type Run = (action: () => Promise<{ ticket: Ticket }>) => Promise<boolean>
