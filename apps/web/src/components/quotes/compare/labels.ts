import type { Tier } from '../../../api'

// Advisor words, and friendlier ones for when the screen faces the customer.
export function tierLabel(tier: Tier, customerView: boolean) {
  const advisor: Record<Tier, string> = { cheap: 'Cheap', medium: 'Medium', premium: 'Premium', option: 'Option' }
  const customer: Record<Tier, string> = { cheap: 'Good', medium: 'Better', premium: 'Best', option: 'Option' }
  return (customerView ? customer : advisor)[tier]
}

// "today", "3 days old" — so an old cost is visibly old.
export function costAge(iso: string | null) {
  if (!iso) return null
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'from today'
  if (days === 1) return 'from yesterday'
  return `${days} days old`
}

// A supplier cost is only trusted the day it was entered.
export function costIsToday(iso: string | null) {
  return !!iso && new Date(iso).toDateString() === new Date().toDateString()
}

// A tire can go on a card as it is: a shelf tire (its own price), or an
// ordered-in tire whose cost was entered today.
export const readyToCompare = (o: { stocked: boolean; price: number | null; costUpdatedAt: string | null }) =>
  o.price !== null && (o.stocked || costIsToday(o.costUpdatedAt))

export const slotTiers: Tier[] = ['cheap', 'medium', 'premium']
