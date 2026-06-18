import { useState } from 'react'
import { motion } from 'framer-motion'
import { Trophy } from 'lucide-react'
import { useIndividualLeaderboard, type DelegationPeriod } from '../../lib/delegation-scores'
import { ROLE_SHORT_LABELS } from '../../config/roles'
import type { RoleId } from '../../types'

const MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }

/** Company-wide individual delegation ranking — admins/founders only. */
export function IndividualLeaderboard({ limit = 25 }: { limit?: number }) {
  const [period, setPeriod] = useState<DelegationPeriod>('all')
  const { data: rows = [], isLoading } = useIndividualLeaderboard(period)

  // Hide the long tail of 0-pt people unless 'all' is small; always show those with points.
  const shown = rows.filter((r) => r.total > 0).slice(0, limit)

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="bg-white/70 backdrop-blur-sm rounded-2xl border border-amber-100 overflow-hidden"
      style={{ boxShadow: '0 4px 20px rgba(146,64,14,0.08)' }}
    >
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-amber-100/80">
        <div className="flex items-center gap-2">
          <Trophy size={14} className="text-amber-600" />
          <h3 className="font-semibold text-stone-800 text-sm">Top Performers · Delegation</h3>
        </div>
        <div className="flex gap-1">
          {(['week', 'month', 'all'] as DelegationPeriod[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                period === p ? 'bg-amber-700 text-white' : 'text-stone-400 hover:text-stone-600 border border-stone-200'
              }`}
            >
              {p === 'week' ? 'This Week' : p === 'month' ? 'This Month' : 'All Time'}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="px-5 py-6 space-y-2">
          <div className="h-4 bg-stone-100 rounded animate-pulse w-3/4" />
          <div className="h-4 bg-stone-100 rounded animate-pulse w-1/2" />
        </div>
      ) : shown.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-stone-400">Abhi koi points nahi 📊</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-stone-400 text-xs">
                <th className="text-left font-medium px-5 py-2 w-10">#</th>
                <th className="text-left font-medium px-2 py-2">Name</th>
                <th className="text-left font-medium px-2 py-2 hidden sm:table-cell">Dept</th>
                <th className="text-right font-medium px-5 py-2 w-16">Pts</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <motion.tr
                  key={row.user_id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="border-l-2 border-transparent hover:bg-amber-50/40"
                >
                  <td className="px-5 py-2.5 text-stone-500 tabular-nums">
                    <span className={row.rank <= 3 ? 'text-base' : 'text-sm'}>{MEDALS[row.rank] ?? row.rank}</span>
                  </td>
                  <td className="px-2 py-2.5 text-stone-700">{row.user_name}</td>
                  <td className="px-2 py-2.5 text-stone-400 text-xs hidden sm:table-cell">
                    {ROLE_SHORT_LABELS[row.role_group as RoleId] ?? row.role_group}
                  </td>
                  <td className="px-5 py-2.5 text-right font-semibold text-stone-800 tabular-nums">{row.total}</td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </motion.div>
  )
}
