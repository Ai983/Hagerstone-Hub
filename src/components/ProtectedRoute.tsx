import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { employee, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-amber-50">
        <div className="text-amber-800 text-sm animate-pulse">Loading...</div>
      </div>
    )
  }

  if (!employee) return <Navigate to="/login" replace />

  return <>{children}</>
}
