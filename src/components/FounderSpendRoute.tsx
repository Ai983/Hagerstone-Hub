import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { canViewFounderSpend } from '../config/founderSpend'

/**
 * Gates the Project Spend & Budget dashboard to the founder email allowlist
 * (see config/founderSpend.ts). Mirrors the server-side guard on the RPC.
 */
export function FounderSpendRoute({ children }: { children: React.ReactNode }) {
  const { employee, loading, status } = useAuth()

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-amber-50">
      <div className="text-amber-800 text-sm animate-pulse">Loading...</div>
    </div>
  )

  if (status === 'anon') return <Navigate to="/login" replace />
  if (!employee) return <Navigate to="/dashboard" replace />
  if (!canViewFounderSpend(employee)) return <Navigate to="/dashboard" replace />

  return <>{children}</>
}
