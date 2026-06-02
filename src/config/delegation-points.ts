// Single source of truth for delegation point values.
// The Edge Function equivalent lives in supabase/functions/_shared/delegation-points.ts.
export const DELEGATION_POINTS = {
  tier:      { S: 5,  M: 10, L: 20, XL: 40 },
  tierHalf:  { S: 2,  M: 5,  L: 10, XL: 20 },
  graceDays: 1,
  streak:    { perFullOnTimeWeek: 5, weeklyCap: 15 },
} as const
