// ── Urgency model ─────────────────────────────────────────────────────────────
// Replaces the old S/M/L/XL effort tiers on the assignment surface. Ma'am fills a
// delegation "sheet" and picks an urgency per row; urgency maps to a fixed point
// value that rides in del_tasks.custom_points (immutable after creation, so the
// badge derived from it never drifts — even after a head adjusts the awarded
// del_points). Change the numbers here and the whole sheet + badges follow.

export type Urgency = 'very_urgent' | 'urgent' | 'normal'

export interface UrgencyMeta {
  value: Urgency
  label: string        // English label shown to Ma'am
  points: number       // → custom_points ceiling; head still verifies
  badge: string        // tailwind classes for the pill
  dot: string          // tailwind bg for the leading dot
  rank: number         // sort weight (higher = more urgent, floats to top)
}

export const URGENCIES: UrgencyMeta[] = [
  { value: 'very_urgent', label: 'Very Urgent', points: 20, badge: 'bg-rose-100 text-rose-700 border-rose-200',       dot: 'bg-rose-500',    rank: 3 },
  { value: 'urgent',      label: 'Urgent',      points: 10, badge: 'bg-amber-100 text-amber-700 border-amber-200',    dot: 'bg-amber-500',   rank: 2 },
  { value: 'normal',      label: 'Normal',      points: 5,  badge: 'bg-emerald-100 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500', rank: 1 },
]

export const URGENCY_BY_VALUE = Object.fromEntries(
  URGENCIES.map((u) => [u.value, u]),
) as Record<Urgency, UrgencyMeta>
/**
 * Reverse-map an immutable custom_points value back to its urgency.
 * The grid encodes urgency as custom_points, so a task's original urgency is
 * always recoverable from del_tasks.custom_points (never mutated by verify).
 * Returns null for tasks that weren't created via the sheet (arbitrary points).
 */
export function urgencyFromPoints(pts: number | null | undefined): UrgencyMeta | null {
  if (pts == null) return null
  return URGENCIES.find((u) => u.points === pts) ?? null
}
