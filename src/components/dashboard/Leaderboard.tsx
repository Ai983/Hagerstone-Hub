import { motion } from 'framer-motion'
import type { Leaderboard as LeaderboardData, LeaderboardRow } from '../../lib/gamification'

const MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }

function breakdown(row: LeaderboardRow, key: LeaderboardData['key']): string {
  switch (key) {
    case 'site_engineer':
      return `S:${row.stockPoints}  Q:${row.quotePoints}  F:${row.imprestPoints}`
    case 'procurement':
      return `P:${row.procurementPoints}  (${row.procOnTime}/${row.procLate}/${row.procMissed})`
    case 'finance':
      return `F:${row.financeProcessPoints}  (${row.financeOnTime} on-time)`
  }
}

export function Leaderboard({
  data,
  currentUserId,
}: {
  data: LeaderboardData
  currentUserId: string | null
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="bg-white/70 backdrop-blur-sm rounded-2xl border border-amber-100 overflow-hidden"
      style={{ boxShadow: '0 4px 20px rgba(146,64,14,0.08)' }}
    >
      <div className="flex items-center gap-2 px-5 py-3.5 border-b border-amber-100/80">
        <span className="text-base">🏆</span>
        <h3 className="font-semibold text-stone-800 text-sm">{data.title} Leaderboard</h3>
      </div>

      {data.rows.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-stone-400">
          Abhi koi score nahi — pehla kaam karo!
        </div>
      ) : (
        <div className="overflow-x-auto">
          {/* Top 3 medal rows — prominent, no WebGL */}
          {data.rows.slice(0, 3).length > 0 && (
            <div className="border-b border-amber-50">
              {data.rows.slice(0, 3).map((row) => {
                const isYou = row.userId === currentUserId
                const medal = MEDALS[row.rank]
                return (
                  <div
                    key={row.userId}
                    className={`flex items-center gap-3 px-5 py-3 ${
                      isYou ? 'bg-amber-100/60 border-l-4 border-amber-500' : 'border-l-4 border-transparent'
                    }`}
                  >
                    <span className="text-2xl w-8 text-center shrink-0">{medal}</span>
                    <div className="flex-1 min-w-0">
                      <span className={`text-sm font-semibold ${isYou ? 'text-amber-900' : 'text-stone-800'}`}>
                        {row.userName}
                      </span>
                      {isYou && (
                        <span className="ml-1.5 text-[10px] font-bold text-amber-700">◀ Aap</span>
                      )}
                    </div>
                    <span className="text-lg font-bold text-stone-800 tabular-nums shrink-0">
                      {row.total}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {/* Remaining rows */}
          {data.rows.slice(3).length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-stone-400 text-xs">
                  <th className="text-left font-medium px-5 py-2 w-12">#</th>
                  <th className="text-left font-medium px-2 py-2">Name</th>
                  <th className="text-right font-medium px-2 py-2 w-20">Points</th>
                  <th className="text-left font-medium px-5 py-2">Breakdown</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.slice(3).map((row, i) => {
                  const isYou = row.userId === currentUserId
                  return (
                    <motion.tr
                      key={row.userId}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.3, delay: Math.min(i * 0.025, 0.4) }}
                      className={
                        isYou
                          ? 'bg-amber-100/70 border-l-2 border-amber-500'
                          : 'border-l-2 border-transparent hover:bg-amber-50/40'
                      }
                    >
                      <td className="px-5 py-2.5 text-stone-500 tabular-nums text-sm">{row.rank}</td>
                      <td className="px-2 py-2.5">
                        <span className={isYou ? 'font-semibold text-amber-900' : 'text-stone-700'}>
                          {row.userName}
                        </span>
                        {isYou && (
                          <span className="ml-2 text-[10px] font-semibold text-amber-700">◀ Aap</span>
                        )}
                      </td>
                      <td className="px-2 py-2.5 text-right font-semibold text-stone-800 tabular-nums">
                        {row.total}
                      </td>
                      <td className="px-5 py-2.5 text-xs text-stone-400 font-mono whitespace-nowrap">
                        {breakdown(row, data.key)}
                      </td>
                    </motion.tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </motion.div>
  )
}
