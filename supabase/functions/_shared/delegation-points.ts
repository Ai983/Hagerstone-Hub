// Single source of truth for delegation point values.
// Mirrors src/config/delegation-points.ts — keep them in sync.
export const TIER: Record<string, number> = {
  S: 5,
  M: 10,
  L: 20,
  XL: 40,
}

export const TIER_HALF: Record<string, number> = {
  S: 2,
  M: 5,
  L: 10,
  XL: 20,
}

export const GRACE_DAYS = 1
