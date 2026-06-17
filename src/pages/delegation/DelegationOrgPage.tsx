import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, TrendingUp } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useDelegationPulse } from '../../lib/delegation-scores'
import { DelegationFounderSection } from '../../components/dashboard/DelegationFounderSection'

/**
 * Org-wide delegation & gamification analytics — per-department points,
 * leaderboards across all teams, live points feed and latest winners.
 * Reachable by delegation super-users / founders / admins (see DelSuperRoute).
 * Deliberately scoped to delegation only — no finance/CPS founder analytics.
 */
export function DelegationOrgPage() {
  const { employee } = useAuth()
  const navigate = useNavigate()
  useDelegationPulse() // realtime refresh as points/verdicts land

  if (!employee) return null

  return (
    <div
      className="min-h-screen"
      style={{ background: 'radial-gradient(ellipse at 20% 0%, #fef9ec 0%, #fffbf0 40%, #fef3c7 100%)' }}
    >
      <header
        className="bg-white/70 backdrop-blur-md border-b border-amber-100/80 px-6 py-3.5"
        style={{ boxShadow: '0 2px 24px rgba(146,64,14,0.08)' }}
      >
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <button
            onClick={() => navigate('/dashboard')}
            className="text-stone-400 hover:text-stone-600 transition-colors p-1 -ml-1"
            aria-label="Back to dashboard"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-2 font-semibold text-stone-800 text-sm">
            <TrendingUp size={15} className="text-amber-700" />
            Delegation &amp; Gamification — Org Analytics
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 lg:px-6 py-8">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
        >
          <DelegationFounderSection />
        </motion.div>
      </main>
    </div>
  )
}
