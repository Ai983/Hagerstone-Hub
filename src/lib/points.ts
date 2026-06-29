// Command Center v2 · Points-as-currency ladder (the founder's reward model).
// Points are a reward "energy/boost" drawn from a FIXED ladder. Each task carries
// one tier value; on completion the assignee is credited those points through the
// EXISTING scoring system (del-submit-task proposes custom_points → del-verify-task
// credits a verified del_points row). The 4th reminder debits 500 from the same
// currency. The ladder is enforced in the UI (dropdown) and in draft extraction —
// NOT via a CHECK on del_tasks.custom_points (that could break existing inserts).

export const POINTS_LADDER = [50, 100, 150, 200, 300, 500, 1000, 2000] as const
export type LadderValue = (typeof POINTS_LADDER)[number]

/** The −500 penalty applied at the 4th reminder on an incomplete task. */
export const PENALTY_POINTS = 500

/** Snap any number to the nearest allowed ladder value (used to constrain AI/legacy values). */
export function snapToLadder(n: number | null | undefined): LadderValue {
  if (n == null || Number.isNaN(n)) return 100
  let best: LadderValue = POINTS_LADDER[0]
  let bestDist = Infinity
  for (const v of POINTS_LADDER) {
    const d = Math.abs(v - n)
    if (d < bestDist) { bestDist = d; best = v }
  }
  return best
}

/** True only for exact ladder members — gate before any dispatch/award. */
export function isLadderValue(n: number | null | undefined): n is LadderValue {
  return n != null && (POINTS_LADDER as readonly number[]).includes(n)
}
