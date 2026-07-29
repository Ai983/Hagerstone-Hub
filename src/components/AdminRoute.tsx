import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export function AdminRoute({ children }: { children: React.ReactNode }) {
  const { employee, loading, status, isAdmin } = useAuth()

  if (loading) return null
  // Only a missing session means "signed out". A failed/absent profile lookup
  // goes to /dashboard, where ProtectedRoute explains it instead of silently
  // dumping the user on the login screen.
  if (status === 'anon') return <Navigate to="/login" replace />
  if (!employee) return <Navigate to="/dashboard" replace />
  if (!isAdmin) return <Navigate to="/dashboard" replace />

  return <>{children}</>
}
