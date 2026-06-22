import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

// Leadership = founder / admin / management, any department head, or a delegation
// coordinator (del_super). Mirrors public.is_hub_leadership() in the DB.
export function isLeadership(employee: { role?: string; is_head?: boolean; del_super?: boolean } | null | undefined) {
  if (!employee) return false
  return (
    ['founder', 'admin', 'management'].includes(employee.role ?? '') ||
    employee.is_head === true ||
    employee.del_super === true
  )
}

export function LeadershipRoute({ children }: { children: React.ReactNode }) {
  const { employee, loading } = useAuth()
  if (loading) return null
  if (!employee) return <Navigate to="/login" replace />
  if (!isLeadership(employee)) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}
