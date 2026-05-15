import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export function AdminRoute({ children }: { children: React.ReactNode }) {
  const { employee, loading, isAdmin } = useAuth()

  if (loading) return null
  if (!employee) return <Navigate to="/login" replace />
  if (!isAdmin) return <Navigate to="/dashboard" replace />

  return <>{children}</>
}
