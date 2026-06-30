import { Check } from 'lucide-react'

/**
 * R1→R3 dot tracker + the 4th (penalty) marker.
 *   ○○○ none · ●○○ R1 · ●●○ R2 · ●●● R3 · ●●●⚠ −500 4th+penalty · ✓ done
 */
export function ReminderTracker({
  count, penaltyApplied, completed, lastReminderAt,
}: {
  count: number
  penaltyApplied: boolean
  completed: boolean
  lastReminderAt?: string | null
}) {
  if (completed) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
        <Check size={13} /> done
      </span>
    )
  }

  const title = lastReminderAt ? `Last reminder: ${new Date(lastReminderAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST` : 'No reminders sent yet'

  return (
    <div className="flex items-center gap-1.5" title={title}>
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={`h-2 w-2 rounded-full ${count >= i ? 'bg-amber-600' : 'bg-stone-200'}`}
        />
      ))}
      {(count >= 4 || penaltyApplied) && (
        <span className="ml-1 text-[11px] font-semibold text-red-600">⚠ −500</span>
      )}
    </div>
  )
}
