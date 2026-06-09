import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { employee, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-amber-50">
        <div className="text-amber-800 text-sm animate-pulse">Loading...</div>
      </div>
    )
  }

  if (!employee) return <Navigate to="/login" replace />

  // If the employee must change their password, redirect to the change-password page
  // (unless they're already there — avoid a redirect loop)
  if (employee.must_change_password && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />
  }

  return <>{children}</>
}
