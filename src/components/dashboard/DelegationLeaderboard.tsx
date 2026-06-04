import { motion } from 'framer-motion'
import { Trophy } from 'lucide-react'
import { useDelegationScores, useLatestWinners, type DelegationPeriod } from '../../lib/delegation-scores'

const MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }
const ROLE_LABELS: Record<string, string> = {
  site_engineer: 'Site Engineers',
  procurement:   'Procurement',
  finance:       'Finance',
  mis:           'MIS',
}

interface Props {
  roleGroup:     string
  authUserId:    string
  period:        DelegationPeriod
  /** Compact mode for founder view — shows all groups stacked */
  compact?:      boolean
}

export function DelegationLeaderboard({ roleGroup, authUserId, period, compact = false }: Props) {
  const { data: allScores = [], isLoading } = useDelegationScores(period)
  const { data: snapshots = [] } = useLatestWinners()

  const rows = allScores.filter((s) => s.role_group === roleGroup)

  // Find the latest finalized winner for this role_group + period
  const winner = snapshots.find(
    (w) => w.role_group === roleGroup && w.period_type === (period === 'week' ? 'week' : 'month'),
  )

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
          <h3 className="font-semibold text-stone-800 text-sm">
            {ROLE_LABELS[roleGroup] ?? roleGroup} · Delegation
          </h3>
        </div>
        {winner && winner.winners?.[0] && (
          <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
            🏆 {winner.winners[0].name.split(' ')[0]}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="px-5 py-6">
          <div className="h-4 bg-stone-100 rounded animate-pulse w-3/4 mb-2" />
          <div className="h-4 bg-stone-100 rounded animate-pulse w-1/2" />
        </div>
      ) : rows.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-stone-400">Abhi koi score nahi 📊 — kaam complete karke points kamayein!</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-stone-400 text-xs">
                <th className="text-left font-medium px-5 py-2 w-10">#</th>
                <th className="text-left font-medium px-2 py-2">Name</th>
                <th className="text-right font-medium px-2 py-2 w-16">Pts</th>
                {!compact && (
                  <th className="text-left font-medium px-5 py-2 text-xs">V / S</th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const isYou = row.user_id === authUserId
                return (
                  <motion.tr
                    key={row.user_id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: Math.min(i * 0.025, 0.4) }}
                    className={
                      isYou
                        ? 'bg-amber-100/70 border-l-2 border-amber-500'
                        : 'border-l-2 border-transparent hover:bg-amber-50/40'
                    }
                  >
                    <td className="px-5 py-2.5 text-stone-500 tabular-nums">
                      <span className={row.rank <= 3 ? 'text-base' : 'text-sm'}>
                        {MEDALS[row.rank] ?? row.rank}
                      </span>
                    </td>
                    <td className="px-2 py-2.5">
                      <span className={isYou ? 'font-semibold text-amber-900' : 'text-stone-700'}>
                        {row.user_name.split(' ')[0]}
                      </span>
                      {isYou && (
                        <span className="ml-1.5 text-[10px] font-semibold text-amber-700">◀ Aap</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-right font-semibold text-stone-800 tabular-nums">
                      {row.total}
                    </td>
                    {!compact && (
                      <td className="px-5 py-2.5 text-xs text-stone-400 font-mono">
                        V:{row.verified_points} S:{row.streak_points}
                        {row.pending_points > 0 && (
                          <span className="text-stone-300"> P:{row.pending_points}</span>
                        )}
                      </td>
                    )}
                  </motion.tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </motion.div>
  )
}
