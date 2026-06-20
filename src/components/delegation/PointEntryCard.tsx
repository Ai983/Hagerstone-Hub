import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { STATUS_PILL, shortDate, type PillStatus } from '../../lib/delegation-ui'

// ── Status pill ─────────────────────────────────────────────────────────────

export function StatusPill({ status }: { status: PillStatus }) {
  const cfg = STATUS_PILL[status] ?? { label: String(status ?? '—'), cls: 'bg-stone-100 text-stone-500 border-stone-200' }
  return (
    <span className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full border ${cfg.cls}`}>
      {cfg.label}
    </span>
  )
}

// ── PointEntryCard ───────────────────────────────────────────────────────────
// Compact by default, details on tap. Reused on My Points, the dashboard
// preview, Mera Din review/done cards, and the Verify Queue.

export interface PointEntryCardProps {
  /** Signed points. 0 renders muted. Pass null to hide the number entirely. */
  points: number | null
  /** Department badge with emoji, e.g. "🏷️ Delegation". */
  sourceLabel: string
  /** Short task title (one line, from the real field — never parsed). */
  taskTitle: string
  /** Collapsed-view status pill. */
  status: PillStatus
  /** ISO date string; rendered short ("4 Jun"). */
  date: string
  /** Full AI summary / reasoning — revealed on expand. Omit to hide the chevron. */
  summary?: string | null
  /** Extra expanded content, e.g. head review actions. */
  children?: ReactNode
  /** Start expanded (e.g. the single item under review). */
  defaultOpen?: boolean
}

export function PointEntryCard({
  points,
  sourceLabel,
  taskTitle,
  status,
  date,
  summary,
  children,
  defaultOpen = false,
}: PointEntryCardProps) {
  const [open, setOpen] = useState(defaultOpen)
  const muted = points === 0
  const expandable = !!summary || !!children

  const pointsNode =
    points === null ? null : (
      <span
        className={`text-lg font-bold tabular-nums w-9 text-right shrink-0 ${
          muted ? 'text-stone-300' : 'text-amber-800'
        }`}
      >
        +{points}
      </span>
    )

  return (
    <div className="rounded-xl border border-stone-200 bg-card p-3">
      <button
        type="button"
        onClick={() => expandable && setOpen((o) => !o)}
        aria-expanded={expandable ? open : undefined}
        className={`flex w-full items-center gap-3 text-left ${expandable ? '' : 'cursor-default'}`}
      >
        {pointsNode}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className="text-[11px] font-medium text-stone-500 bg-stone-50 border border-stone-100 px-1.5 py-0.5 rounded-full">
              {sourceLabel}
            </span>
            <span className="text-[11px] text-stone-400">{shortDate(date)}</span>
          </div>
          <p className="truncate text-sm font-medium text-stone-800">{taskTitle}</p>
          <div className="mt-1">
            <StatusPill status={status} />
          </div>
        </div>

        {expandable && (
          <ChevronDown
            size={18}
            aria-label={open ? 'Chhupayein' : 'Details dekhein'}
            className={`shrink-0 text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        )}
      </button>

      {open && expandable && (
        <div className="mt-3 border-t border-stone-100 pt-3 space-y-3">
          {summary && (
            <p className="text-sm text-stone-500 leading-relaxed">{summary}</p>
          )}
          {children}
        </div>
      )}
    </div>
  )
}
