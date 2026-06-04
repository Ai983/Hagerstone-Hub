// Shared Hinglish + emoji glossary for the delegation UI.
// Use these EXACT labels everywhere so every screen reads consistently.

// ── Stage / column labels ──────────────────────────────────────────────────
export const STAGE_LABEL = {
  assigned:    '🆕 Naya Kaam',
  in_progress: '⏳ Chal Raha Hai',
  review:      '👀 Review Mein',
  done:        '✅ Ho Gaya',
  rejected:    '↩️ Wapas Aaya',
} as const

export const STAGE_EMPTY = {
  assigned:    'Koi naya kaam nahi 🆕',
  in_progress: 'Abhi kuch chal raha nahi hai ⏳',
  review:      'Koi kaam review mein nahi 👀',
  done:        'Abhi kuch poora nahi hua ✅',
} as const

// ── Status pills (collapsed-view status) ───────────────────────────────────
export type PillStatus = 'pending' | 'verified' | 'rejected' | 'reversed' | 'scoring'

export const STATUS_PILL: Record<PillStatus, { label: string; cls: string }> = {
  scoring:  { label: '🤖 Points lag rahe hain…', cls: 'bg-violet-50 text-violet-600 border-violet-200' },
  pending:  { label: '🕐 Head check baaki',       cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  verified: { label: '✅ Approve',                 cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  rejected: { label: '↩️ Wapas aaya',              cls: 'bg-red-50 text-red-600 border-red-200' },
  reversed: { label: '↩️ Wapas aaya',              cls: 'bg-stone-100 text-stone-400 border-stone-200' },
}

// ── Source badges (with emoji) ─────────────────────────────────────────────
export const SOURCE_LABEL: Record<'delegation' | 'cps' | 'finance', string> = {
  delegation: '🏷️ Delegation',
  cps:        '🛒 CPS',
  finance:    '💰 Finance',
}

// ── Button / link labels ────────────────────────────────────────────────────
export const LABELS = {
  startTask:   '▶️ Shuru Karen',
  submitWork:  '📤 Submit karein',
  speak:       '🎤 Bol kar batayein',
  attach:      '📎 File lagayein',
  headReview:  '🔍 Head review karein',
  viewAllPts:  'Saare points dekhein →',
  newTask:     '➕ Naya Kaam',
  pointsHelp:  '💡 Points kaise milte hain?',
} as const

export function shortDate(s: string): string {
  return new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}
