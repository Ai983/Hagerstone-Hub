import { useState } from 'react'
import { useGamification } from '../../lib/gamification'
import { useAuth } from '../../hooks/useAuth'
import { PointsCard } from './PointsCard'
import { Leaderboard } from './Leaderboard'
import { TeamSummaryHero } from './TeamSummaryHero'
import { DelegationPointsCard } from './DelegationPointsCard'
import { DelegationLeaderboard } from './DelegationLeaderboard'
import type { DelegationPeriod } from '../../lib/delegation-scores'
import {
  useMyRecentPoints,
  useDelegationScores,
  usePointsSeenNotification,
} from '../../lib/delegation-scores'

// All active employees participate in delegation — role gates are task-type level, not UI level
const DELEGATION_LAUNCH_ROLES = [
  'site_engineer', 'procurement', 'finance', 'mis',
  'marketing', 'facade', 'ai', 'hr', 'management', 'project_manager',
  'lcs', 'admin', 'founder',
]

export function GamificationSection() {
  const { employee } = useAuth()
  const { data: payload, isLoading, isError, isFetching } = useGamification()
  const [delPeriod, setDelPeriod] = useState<DelegationPeriod>('week')

  const authUserId = employee?.auth_user_id ?? ''
  const roleGroup  = employee?.role ?? ''
  const hasDelegation = DELEGATION_LAUNCH_ROLES.includes(roleGroup)

  // For since-last-visit notifications
  const { data: scores = [] } = useDelegationScores('all')
  const { data: recentPts = [] } = useMyRecentPoints(authUserId, 1)
  const myDelTotal = scores.find((s) => s.user_id === authUserId)?.total ?? null
  const myCpsTotal = payload?.me?.total ?? null

  // Finance total from gamification payload (imprest + finance process)
  const myFinanceTotal = payload?.me
    ? ((payload.me.imprestPoints ?? 0) + (payload.me.financeProcessPoints ?? 0))
    : null

  usePointsSeenNotification(
    authUserId || undefined,
    myDelTotal,
    myCpsTotal,
    myFinanceTotal,
    recentPts[0]?.reason ?? null,
  )

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div
          className="h-44 bg-white/60 rounded-2xl animate-pulse border border-amber-100"
          style={{ boxShadow: '0 4px 20px rgba(146,64,14,0.06)' }}
        />
      </div>
    )
  }

  // Silently render nothing on error for CPS/Finance — gamification is non-critical.
  // Delegation card still shows independently.
  const hasCpsFinance = !isError && payload && payload.group && (payload.me || payload.leaderboards.length > 0)

  if (!hasCpsFinance && !hasDelegation) return null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end -mb-1">
        <LiveBadge fetching={isFetching} />
      </div>

      {/* CPS / Finance section (existing) */}
      {hasCpsFinance && (
        <>
          {payload!.group === 'management' ? (
            <TeamSummaryHero leaderboards={payload!.leaderboards} />
          ) : (
            payload!.me && <PointsCard me={payload!.me} group={payload!.group!} />
          )}
          {payload!.leaderboards.map((board) => (
            <Leaderboard key={board.key} data={board} currentUserId={payload!.me?.userId ?? null} />
          ))}
        </>
      )}

      {/* Delegation section */}
      {hasDelegation && authUserId && (
        <>
          <DelegationPointsCard
            authUserId={authUserId}
            roleGroup={roleGroup}
            period={delPeriod}
            onPeriodChange={setDelPeriod}
          />
          <DelegationLeaderboard
            roleGroup={roleGroup}
            authUserId={authUserId}
            period={delPeriod}
          />
        </>
      )}
    </div>
  )
}

/** Subtle "live" indicator — pulses while a refetch (e.g. from a realtime pulse) is in flight. */
function LiveBadge({ fetching }: { fetching: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-stone-400">
      <span className="relative flex h-2 w-2">
        {fetching && (
          <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 animate-ping" />
        )}
        <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
      </span>
      Live
    </span>
  )
}
