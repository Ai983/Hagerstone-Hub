import { Navigate } from 'react-router-dom'

/**
 * Legacy org-analytics route. The delegation + gamification boards have been
 * consolidated into the single company-wide Work Score leaderboard, so this
 * route now redirects there. del_super users are leadership, so /leaderboard
 * (LeadershipRoute) is accessible to them.
 */
export function DelegationOrgPage() {
  return <Navigate to="/leaderboard" replace />
}
