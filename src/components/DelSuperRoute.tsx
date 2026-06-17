import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

/**
 * Guards org-wide delegation/gamification views. Allows delegation super-users
 * (del_super), founders, and admins. Unlike HeadRoute this is NOT open to every
 * department head — only company-wide delegation authorities.
 */
export function DelSuperRoute({ children }: { children: React.ReactNode }) {
  const { employee, loading } = useAuth()

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-amber-50">
      <div className="text-amber-800 text-sm animate-pulse">Loading...</div>
    </div>
  )

  if (!employee) return <Navigate to="/login" replace />

  const canAccess =
    employee.del_super === true ||
    employee.role === 'founder' ||
    employee.role === 'admin'

  if (!canAccess) return <Navigate to="/dashboard" replace />

  return <>{children}</>
}
