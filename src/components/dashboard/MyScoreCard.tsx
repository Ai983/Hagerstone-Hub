import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Trophy, ChevronRight, ClipboardCheck, Activity, ShieldCheck } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useEmployeeScorecard } from '../../lib/work-scores'

/**
 * The ONE personal scoreboard shown inline on the dashboard for every employee.
 * Replaces the old GamificationSection / DelegationPointsCard split — shows the
 * unified Work Score (Task + Operational + Coordinator) with a one-tap link to
 * the full /employee/:id scorecard. All point values come from points_config via
 * get_employee_scorecard, so there is no second source of truth here.
 */
export function MyScoreCard() {
  const { employee } = useAuth()
  const navigate = useNavigate()
  const uid = employee?.auth_user_id ?? undefined
  const { data, isLoading } = useEmployeeScorecard(uid, 'month')

  if (!uid) return null

  const u = data?.user
  const showCoord = !!data?.coordinator || (u?.coord_points ?? 0) > 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      onClick={() => navigate(`/employee/${uid}`)}
      className="cursor-pointer bg-white/80 backdrop-blur-sm rounded-2xl border border-amber-100 p-5 hover:border-amber-300 transition-colors"
      style={{ boxShadow: '0 4px 20px rgba(146,64,14,0.08)' }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-amber-800">
          <Trophy size={16} />
          <span className="text-sm font-semibold">My Work Score</span>
          <span className="text-[11px] text-stone-400 font-normal">· this month</span>
        </div>
        <div className="flex items-center gap-1 text-xs text-amber-700">
          View details <ChevronRight size={14} />
        </div>
      </div>

      {isLoading || !u ? (
        <div className="h-16 bg-stone-100 rounded-xl animate-pulse" />
      ) : (
        <div className="flex items-stretch gap-3">
          {/* Total */}
          <div className="flex flex-col justify-center items-center px-5 rounded-xl bg-gradient-to-br from-amber-300 to-amber-500 text-amber-900 shrink-0">
            <div className="text-3xl font-bold leading-none">{u.total}</div>
            <div className="text-[10px] mt-1 opacity-80">total pts</div>
            {u.rank_in_dept != null && (
              <div className="text-[10px] opacity-80">rank #{u.rank_in_dept} in team</div>
            )}
          </div>
          {/* Breakdown */}
          <div className={`grid ${showCoord ? 'grid-cols-3' : 'grid-cols-2'} gap-2 flex-1`}>
            <Tile icon={<ClipboardCheck size={13} />} label="Tasks" value={u.task_points} cls="text-amber-700 bg-amber-50" />
            <Tile icon={<Activity size={13} />} label="Operations" value={u.ops_points} cls="text-emerald-700 bg-emerald-50" />
            {showCoord && (
              <Tile icon={<ShieldCheck size={13} />} label="Coordinator" value={u.coord_points} cls="text-violet-700 bg-violet-50" />
            )}
          </div>
        </div>
      )}
    </motion.div>
  )
}

function Tile({ icon, label, value, cls }: { icon: React.ReactNode; label: string; value: number; cls: string }) {
  return (
    <div className={`rounded-xl px-3 py-2 ${cls}`}>
      <div className="flex items-center gap-1 text-[11px] font-medium opacity-80">{icon}{label}</div>
      <div className="text-xl font-bold leading-tight">{value}</div>
    </div>
  )
}
