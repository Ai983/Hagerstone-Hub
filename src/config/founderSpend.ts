import type { Employee } from '../types'

/**
 * Founder-only allowlist for the Project Spend & Budget dashboard.
 *
 * This page exposes company-wide spend + names, so it is gated to a fixed set of
 * identities by EMAIL — deliberately NOT by role. The role columns differ across
 * identity systems and don't isolate the founders cleanly:
 *   - public.employees.role  → Dhruv='founder', Bhaskar='management', Aniket='ai'
 *   - cps.cps_users.role     → Dhruv & Bhaskar='procurement_head' (shared with the
 *                              whole procurement team), Aniket='management'
 * Email is the one stable key across both layers. The same list is enforced
 * server-side inside public.get_founder_project_spend() / public.set_project_budget().
 * Keep the two in sync.
 */
export const FOUNDER_SPEND_EMAILS = [
  'world@hagerstone.com',          // Dhruv Agarwal (founder)
  'projects@hagerstone.com',       // Bhaskar Tyagi (director)
  'aniketawasthi.work@gmail.com',  // Aniket (cutover owner / admin)
] as const

export function canViewFounderSpend(employee: Employee | null | undefined): boolean {
  if (!employee?.email) return false
  return FOUNDER_SPEND_EMAILS.includes(employee.email.trim().toLowerCase() as never)
}
