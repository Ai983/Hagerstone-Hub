import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, Star, Flame, Clock } from 'lucide-react'
import { useMyRecentPoints, useDelegationScores, type DelegationPeriod } from '../../lib/delegation-scores'
import { DELEGATION_POINTS } from '../../config/delegation-points'
import { PointEntryCard } from '../delegation/PointEntryCard'
import { SOURCE_LABEL, LABELS, type PillStatus } from '../../lib/delegation-ui'
import { useCountUp } from './useCountUp'

// Rules explainer (mirrors PointsCard pattern)
const RULES = [
  `On time: S=+${DELEGATION_POINTS.tier.S} · M=+${DELEGATION_POINTS.tier.M} · L=+${DELEGATION_POINTS.tier.L} · XL=+${DELEGATION_POINTS.tier.XL}`,
  `Late (≤${DELEGATION_POINTS.graceDays}d grace): S=+${DELEGATION_POINTS.tierHalf.S} · M=+${DELEGATION_POINTS.tierHalf.M} · L=+${DELEGATION_POINTS.tierHalf.L} · XL=+${DELEGATION_POINTS.tierHalf.XL}`,
  `Beyond grace: +0`,
  `On-time streak (all tasks): +${DELEGATION_POINTS.streak.perFullOnTimeWeek}/week, cap ${DELEGATION_POINTS.streak.weeklyCap}/week`,
  `Points count only after Head verification`,
]

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  authUserId: string
  roleGroup:  string
  period:     DelegationPeriod
  onPeriodChange: (p: DelegationPeriod) => void
}

export function DelegationPointsCard({ authUserId, roleGroup, period, onPeriodChange }: Props) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  const { data: scores = [] } = useDelegationScores(period)
  const { data: recent = [] } = useMyRecentPoints(authUserId, 2)

  const me = scores.find((s) => s.user_id === authUserId)
  const verified  = me?.verified_points ?? 0
  const pending   = me?.pending_points  ?? 0
  const streak    = me?.streak_points   ?? 0
  const total     = me?.total           ?? 0
  const rank      = me?.rank            ?? null
  const groupSize = scores.filter((s) => s.role_group === roleGroup).length

  const animatedTotal = useCountUp(total)

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="bg-white/70 backdrop-blur-sm rounded-2xl border border-amber-100 p-5"
      style={{ boxShadow: '0 4px 20px rgba(146,64,14,0.08)' }}
    >
      {/* Header + period toggle */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Star size={15} className="text-amber-600" />
          <h3 className="font-semibold text-stone-800 text-sm">Mere Points · Delegation</h3>
        </div>
        <div className="flex gap-1">
          {(['week', 'month', 'all'] as DelegationPeriod[]).map((p) => (
            <button
              key={p}
              onClick={() => onPeriodChange(p)}
              className={`text-xs px-2 py-0.5 rounded-full font-medium transition-colors ${
                period === p
                  ? 'bg-amber-700 text-white'
                  : 'text-stone-400 hover:text-stone-600'
              }`}
            >
              {p === 'week' ? 'Wk' : p === 'month' ? 'Mo' : 'All'}
            </button>
          ))}
        </div>
      </div>

      {/* Score hero */}
      <div className="flex items-end justify-between mb-4">
        <div>
          <div className="text-4xl font-bold text-amber-900 tabular-nums leading-none">
            {animatedTotal}
          </div>
          <div className="text-xs text-stone-400 mt-1">verified + streak</div>
        </div>
        {rank !== null && (
          <div className="text-right">
            <div className="text-xl font-bold text-stone-700">#{rank}</div>
            <div className="text-xs text-stone-400">of {groupSize}</div>
          </div>
        )}
      </div>

      {/* Breakdown */}
      <div className="space-y-2 mb-4">
        <div className="flex justify-between text-sm">
          <span className="text-stone-600">Verified</span>
          <span className="font-semibold text-stone-800 tabular-nums">{verified} pts</span>
        </div>
        {pending > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-stone-400 flex items-center gap-1">
              <Clock size={12} /> Pending
            </span>
            <span className="text-stone-400 tabular-nums">{pending} pts</span>
          </div>
        )}
        {streak > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-stone-600 flex items-center gap-1">
              <Flame size={12} className="text-orange-500" /> Streak
            </span>
            <span className="font-semibold text-stone-800 tabular-nums">+{streak} pts</span>
          </div>
        )}
      </div>

      {/* Recent — at most 2 compact cards; full history lives on My Points */}
      {recent.length > 0 && (
        <div className="border-t border-stone-100 pt-3 space-y-2 mb-3">
          {recent.slice(0, 2).map((pt) => (
            <PointEntryCard
              key={pt.id}
              points={pt.points}
              sourceLabel={SOURCE_LABEL.delegation}
              taskTitle={pt.task_title ?? 'Delegation task'}
              status={pt.status as PillStatus}
              date={pt.awarded_at}
              summary={pt.reason}
            />
          ))}
        </div>
      )}

      {/* View-all link → My Points (full history lives there, not duplicated here) */}
      <button
        onClick={() => navigate('/delegation/my-points')}
        className="w-full text-center text-xs font-medium text-amber-700 hover:text-amber-800 transition-colors mb-3 py-1"
      >
        {LABELS.viewAllPts}
      </button>

      {/* Rules explainer */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs text-amber-700 hover:text-amber-800 transition-colors"
      >
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown size={14} />
        </motion.span>
        {LABELS.pointsHelp}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden mt-2 space-y-1"
          >
            {RULES.map((r) => (
              <li key={r} className="text-xs text-stone-500 flex items-start gap-1.5">
                <span className="text-amber-600 mt-0.5">•</span>
                <span>{r}</span>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
