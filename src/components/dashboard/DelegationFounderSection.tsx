import { useState } from 'react'
import { motion } from 'framer-motion'
import { ClipboardList, TrendingUp } from 'lucide-react'
import {
  useOrgDelegationFeed,
  usePendingCounts,
  useDelegationScores,
  useLatestWinners,
  type DelegationPeriod,
  type OrgFeedRow,
} from '../../lib/delegation-scores'
import { DelegationLeaderboard } from './DelegationLeaderboard'
import { DELEGATION_DEPARTMENTS, ROLE_LABELS, ROLE_SHORT_LABELS } from '../../config/roles'
import type { RoleId } from '../../types'

function fmtDateTime(s: string) {
  return new Date(s).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

function statusBadge(status: OrgFeedRow['status']) {
  switch (status) {
    case 'verified': return 'bg-emerald-100 text-emerald-700 border-emerald-200'
    case 'pending':  return 'bg-amber-100 text-amber-700 border-amber-200'
    case 'rejected': return 'bg-red-100 text-red-600 border-red-200'
    default:         return 'bg-stone-100 text-stone-500 border-stone-200'
  }
}

export function DelegationFounderSection() {
  const [period, setPeriod] = useState<DelegationPeriod>('week')

  const { data: feed    = [] } = useOrgDelegationFeed()
  const { data: pending = {} } = usePendingCounts()
  const { data: scores  = [] } = useDelegationScores(period)
  const { data: winners = [] } = useLatestWinners()

  // Org totals per role_group
  const orgTotals: Record<string, number> = {}
  for (const s of scores) {
    orgTotals[s.role_group] = (orgTotals[s.role_group] ?? 0) + s.verified_points
  }

  return (
    <div className="space-y-6">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-stone-700 flex items-center gap-2">
          <TrendingUp size={15} className="text-amber-700" />
          Delegation — Org Overview
        </h2>
        <div className="flex gap-1">
          {(['week', 'month', 'all'] as DelegationPeriod[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                period === p
                  ? 'bg-amber-700 text-white'
                  : 'text-stone-400 hover:text-stone-600 border border-stone-200'
              }`}
            >
              {p === 'week' ? 'This Week' : p === 'month' ? 'This Month' : 'All Time'}
            </button>
          ))}
        </div>
      </div>

      {/* Role-group KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {DELEGATION_DEPARTMENTS.map((role) => {
          const pendingCount = pending[role] ?? 0
          return (
            <div
              key={role}
              className="bg-white rounded-xl border border-stone-100 p-3"
              style={{ boxShadow: '0 2px 10px rgba(146,64,14,0.06)' }}
            >
              <div className="text-xs text-stone-400 font-medium">{ROLE_SHORT_LABELS[role]}</div>
              <div className="text-2xl font-bold text-stone-800 mt-1 tabular-nums">
                {orgTotals[role] ?? 0}
                <span className="text-xs font-normal text-stone-400 ml-1">pts</span>
              </div>
              {pendingCount > 0 && (
                <div className="flex items-center gap-1 mt-1 text-xs text-amber-700">
                  <ClipboardList size={11} />
                  {pendingCount} awaiting verify
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Per-role leaderboards + live feed in a grid */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Leaderboards */}
        <div className="space-y-3">
          <h3 className="text-xs font-medium text-stone-500 uppercase tracking-wide">Per-Role Rankings</h3>
          {DELEGATION_DEPARTMENTS.map((role) => (
            <DelegationLeaderboard
              key={role}
              roleGroup={role}
              authUserId=""   // founder view: no "you" highlight
              period={period}
              compact
            />
          ))}
        </div>

        {/* Live feed */}
        <div>
          <h3 className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-3">Live Points Feed</h3>
          <div
            className="bg-white/70 backdrop-blur-sm rounded-2xl border border-amber-100 overflow-hidden"
            style={{ boxShadow: '0 4px 20px rgba(146,64,14,0.08)' }}
          >
            {feed.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-stone-400">No points logged yet.</div>
            ) : (
              <div className="divide-y divide-stone-100 max-h-[480px] overflow-y-auto">
                {feed.map((row) => (
                  <motion.div
                    key={row.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-semibold text-stone-700">
                            {row.user_name ?? '—'}
                          </span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${statusBadge(row.status)}`}>
                            {row.status}
                          </span>
                          <span className="text-xs text-stone-400">{ROLE_LABELS[row.role_group as RoleId] ?? row.role_group}</span>
                        </div>
                        <p className="text-xs text-stone-500 leading-relaxed line-clamp-2">{row.reason}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`text-sm font-bold ${row.points > 0 ? 'text-stone-800' : 'text-stone-300'}`}>
                          +{row.points}
                        </div>
                        <div className="text-[10px] text-stone-400">{fmtDateTime(row.awarded_at)}</div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>

          {/* Winner snapshots */}
          {winners.filter((w) => w.finalized).length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-2">Latest Winners</h3>
              <div className="space-y-2">
                {winners.filter((w) => w.finalized).slice(0, 8).map((w) => (
                  <div
                    key={w.id}
                    className="flex items-center justify-between bg-white rounded-xl border border-amber-100 px-3 py-2 text-xs"
                  >
                    <span className="text-stone-600 font-medium">
                      🏆 {ROLE_LABELS[w.role_group as RoleId] ?? w.role_group} · {w.period_type === 'week' ? 'Week' : 'Month'}
                    </span>
                    <span className="text-stone-500">
                      {w.winners?.[0]?.name?.split(' ')[0] ?? '—'} · {w.winners?.[0]?.points ?? 0} pts
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
