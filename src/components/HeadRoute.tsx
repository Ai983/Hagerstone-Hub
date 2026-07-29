import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

/** Allows access to department heads (is_head=true), founders, and admins. */
export function HeadRoute({ children }: { children: React.ReactNode }) {
  const { employee, loading, status } = useAuth()

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-amber-50">
      <div className="text-amber-800 text-sm animate-pulse">Loading...</div>
    </div>
  )

  if (status === 'anon') return <Navigate to="/login" replace />
  if (!employee) return <Navigate to="/dashboard" replace />

  const canAccess =
    employee.is_head ||
    employee.role === 'founder' ||
    employee.role === 'admin'

  if (!canAccess) return <Navigate to="/dashboard" replace />

  return <>{children}</>
}
