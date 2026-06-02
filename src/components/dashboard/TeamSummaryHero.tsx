import { Suspense, lazy } from 'react'
import { motion } from 'framer-motion'
import { Crown, Users } from 'lucide-react'
import { deriveTeamSummary, type Leaderboard } from '../../lib/gamification'

const TeamBackdrop = lazy(() => import('./three/TeamBackdrop'))

/**
 * Personal panel for view-only roles (management / admin / founder / mis), who earn no
 * points themselves. Summarises each team's standings so the logged-in user always has a
 * contextual hero, with a decorative 3D backdrop.
 */
export function TeamSummaryHero({ leaderboards }: { leaderboards: Leaderboard[] }) {
  const summary = deriveTeamSummary(leaderboards)

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="relative bg-white/70 backdrop-blur-sm rounded-2xl border border-amber-100 overflow-hidden"
      style={{ boxShadow: '0 4px 20px rgba(146,64,14,0.08)' }}
    >
      {/* decorative 3D backdrop */}
      <div className="absolute inset-x-0 top-0 pointer-events-none opacity-90">
        <Suspense fallback={null}>
          <TeamBackdrop height={150} />
        </Suspense>
      </div>

      <div className="relative p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="text-lg">📊</span>
            <h3 className="font-semibold text-stone-800 text-sm">Team Standings</h3>
          </div>
          <span className="px-2.5 py-1 rounded-full bg-amber-100 border border-amber-200 text-[11px] font-medium text-amber-800">
            Viewing as Management
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {summary.map((s) => (
            <div
              key={s.key}
              className="bg-white/80 backdrop-blur-sm rounded-xl border border-amber-100 p-4"
            >
              <div className="text-xs font-medium text-stone-400 uppercase tracking-wide">
                {s.title}
              </div>
              <div className="mt-1.5 flex items-baseline gap-1.5">
                <span className="text-2xl font-bold text-amber-800 tabular-nums">
                  {s.totalPoints}
                </span>
                <span className="text-xs text-stone-400">team points</span>
              </div>
              <div className="mt-2 flex items-center gap-1.5 text-sm text-stone-600">
                <Crown size={14} className="text-amber-500" />
                <span className="font-medium text-stone-700">{s.topName ?? '—'}</span>
                {s.topName && (
                  <span className="text-stone-400">· {s.topPoints} pts</span>
                )}
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-stone-400">
                <Users size={12} />
                {s.memberCount} {s.memberCount === 1 ? 'member' : 'members'}
              </div>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  )
}
