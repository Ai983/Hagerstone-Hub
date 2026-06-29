import { POINTS_LADDER } from '../../lib/points'

/** Ladder-only points dropdown (the reward currency). Values outside 50…2000
 *  are never selectable — enforcement lives here and in draft extraction. */
export function PointsSelect({
  value, onChange, disabled,
}: {
  value: number | null
  onChange: (v: number) => void
  disabled?: boolean
}) {
  return (
    <select
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      className={`h-9 rounded-lg border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
        value == null ? 'border-amber-300 text-amber-700' : 'border-input text-stone-800'
      }`}
      aria-label="Points tier"
    >
      {value == null && <option value="" disabled>— pts</option>}
      {POINTS_LADDER.map((p) => (
        <option key={p} value={p}>{p} pts</option>
      ))}
    </select>
  )
}
