import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { canViewSnags } from '../lib/snags'

// Snags = post-handover client defect reports. Access is granted per-employee via
// the snag_viewer / snag_owner flags (admins and founders pass by role), so the
// people involved can change from the admin panel without a deploy.
// Mirrors public.can_view_snags() in the DB — that's what actually enforces it.
export function SnagRoute({ children }: { children: React.ReactNode }) {
  const { employee, loading, status } = useAuth()
  if (loading) return null
  if (status === 'anon') return <Navigate to="/login" replace />
  if (!employee) return <Navigate to="/dashboard" replace />
  if (!canViewSnags(employee)) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}
