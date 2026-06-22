import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useModules } from '../hooks/useModules'
import { MODULE_REGISTRY } from '../config/modules'
import { ModuleCard } from '../components/ModuleCard'
import { Button } from '../components/ui/button'
import { Settings, LogOut, LineChart, Sun, ClipboardList, BarChart2, FolderKanban, ClipboardCheck, Trophy } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { GamificationSection } from '../components/dashboard/GamificationSection'
import { EmployeeDelegationBoard } from '../components/dashboard/EmployeeDelegationBoard'
import { DelegationPointsCard } from '../components/dashboard/DelegationPointsCard'
import type { DelegationPeriod } from '../lib/delegation-scores'
import { getPlacement } from '../lib/gamification'
import { useDelegationPulse } from '../lib/delegation-scores'
import { FounderAvatar } from '../components/FounderAvatar'
import { DELEGATION_ROLES } from '../config/roles'

export function DashboardPage() {
  const { employee, isAdmin, signOut } = useAuth()
  useDelegationPulse() // single realtime subscription for all delegation hooks on this page
  const { accessibleModules, loading } = useModules(employee?.id ?? null)
  const navigate = useNavigate()

  const placement = getPlacement(employee?.role)

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const firstName = employee?.name?.split(' ')[0] ?? ''

  // Single source for the header (desktop) + bottom bar (mobile) nav actions.
  const role = employee?.role ?? ''
  const isDelegationRole = DELEGATION_ROLES.includes(role)
  // Delegation super-users (Ritu) get the org employee board first instead of
  // gamification; their team standings live on the Gamification page.
  const isEmpBoard = !!employee?.del_super
  const [delPeriod, setDelPeriod] = useState<DelegationPeriod>('all')
  const navActions = [
    { key: 'points',    label: 'My Points',    Icon: BarChart2,      show: isDelegationRole || role === 'founder' || isAdmin, onClick: () => navigate('/delegation/my-points') },
    { key: 'myday',     label: 'Mera Din',     Icon: Sun,            show: isDelegationRole || role === 'founder' || isAdmin, onClick: () => navigate('/delegation/my-day') },
    { key: 'verify',    label: 'Verify',       Icon: ClipboardList,  show: !!employee?.is_head || role === 'founder' || isAdmin, onClick: () => navigate('/delegation/verify') },
    { key: 'leaderboard', label: 'Leaderboard', Icon: Trophy,        show: true, onClick: () => navigate('/leaderboard') },
    { key: 'gam',       label: 'Gamification', Icon: BarChart2,      show: !!employee?.del_super, onClick: () => navigate('/delegation/org') },
    { key: 'approvals', label: 'Approvals',    Icon: ClipboardCheck, show: role === 'founder' || isAdmin, onClick: () => navigate('/approvals') },
    { key: 'founder',   label: 'Overview',     Icon: LineChart,      show: role === 'founder' || isAdmin, onClick: () => navigate('/founder') },
    { key: 'admin',     label: 'Admin',        Icon: Settings,       show: isAdmin, onClick: () => navigate('/admin/employees') },
    { key: 'projects',  label: 'Projects',     Icon: FolderKanban,   show: isAdmin, onClick: () => navigate('/admin/projects') },
  ].filter((a) => a.show)

  return (
    <div
      className="min-h-screen"
      style={{
        background: 'radial-gradient(ellipse at 20% 0%, #fef9ec 0%, #fffbf0 40%, #fef3c7 100%)',
      }}
    >
      {/* Subtle warm dot pattern */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(180,120,30,0.06) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      />

      {/* Header */}
      <motion.header
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 bg-white/70 backdrop-blur-md border-b border-amber-100/80 px-6 py-3.5"
        style={{ boxShadow: '0 2px 24px rgba(146,64,14,0.08)' }}
      >
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <motion.div
              whileHover={{ rotate: [0, -8, 8, 0], scale: 1.08 }}
              transition={{ duration: 0.4 }}
              className="w-9 h-9 bg-gradient-to-br from-amber-700 to-amber-900 rounded-xl flex items-center justify-center shadow-md"
              style={{ boxShadow: '0 4px 12px rgba(146,64,14,0.35)' }}
            >
              <span className="text-white text-sm font-bold tracking-tight">H</span>
            </motion.div>
            <div>
              <div className="font-semibold text-stone-800 text-sm leading-tight">Hagerstone Hub</div>
              <div className="text-xs text-stone-400 leading-tight">
                {employee?.name} · {employee?.designation ?? employee?.role}
              </div>
            </div>
          </div>

          {/* Desktop actions (hidden on mobile — see bottom nav) */}
          <div className="hidden sm:flex items-center gap-2">
            {navActions.map((a) => (
              <motion.div key={a.key} whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={a.onClick}
                  className="text-xs border-amber-200 text-amber-800 hover:bg-amber-50 hover:border-amber-300"
                  style={{ boxShadow: '0 2px 8px rgba(146,64,14,0.10)' }}
                >
                  <a.Icon size={13} className="mr-1.5" />
                  {a.label}
                </Button>
              </motion.div>
            ))}
            <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSignOut}
                className="text-xs text-stone-400 hover:text-stone-600"
              >
                <LogOut size={13} className="mr-1.5" />
                Sign out
              </Button>
            </motion.div>
          </div>

          {/* Mobile: just a quick sign-out; the rest live in the bottom nav */}
          <button
            onClick={handleSignOut}
            className="sm:hidden text-xs text-stone-400 flex items-center gap-1"
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </motion.header>

      {/* Main */}
      <main className="relative z-10 max-w-5xl mx-auto px-6 pt-10 pb-28 sm:pb-10">
        {/* Greeting */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          className="mb-8"
        >
          <h2 className="text-2xl font-semibold text-stone-800 tracking-tight">
            Namaste, {firstName} 👋
          </h2>
          <p className="text-sm text-stone-400 mt-1">
            Niche apna module chunein 👇 (Locked = aapke role ke liye nahi 🔒)
          </p>
        </motion.div>

        {/* Ritu / del_super: org employee board first (assign + nudge from here) */}
        {isEmpBoard && (
          <div className="mb-8">
            <EmployeeDelegationBoard />
          </div>
        )}

        {/* Gamification — top slot (procurement / finance / management) */}
        {placement === 'top' && !isEmpBoard && (
          <div className="mb-8">
            <GamificationSection />
          </div>
        )}

        {/* Module Grid */}
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-36 bg-white/60 rounded-2xl animate-pulse border border-stone-100"
                style={{ animationDelay: `${i * 80}ms` }}
              />
            ))}
          </div>
        ) : (
          <div
            className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 auto-rows-fr"
            style={{ perspective: '1200px' }}
          >
            {MODULE_REGISTRY.map((mod, idx) => (
              <ModuleCard
                key={mod.id}
                module={mod}
                isAccessible={accessibleModules.includes(mod.id)}
                index={idx}
              />
            ))}
          </div>
        )}

        {/* Info card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="mt-10 bg-white/60 backdrop-blur-sm rounded-2xl border border-amber-100 p-4"
          style={{ boxShadow: '0 4px 20px rgba(146,64,14,0.07)' }}
        >
          <p className="text-xs text-stone-400 leading-relaxed">
            <strong className="text-stone-600">Note:</strong> Each module opens in a new tab.
            Use your existing module credentials to log in — they are separate from your Hub password.
            Contact{' '}
            <a href="mailto:admin@hagerstone.com" className="text-amber-700 underline hover:text-amber-800">
              admin@hagerstone.com
            </a>{' '}
            if you need access to additional modules.
          </p>
        </motion.div>

        {/* Gamification — bottom slot (site engineers) */}
        {placement === 'bottom' && !isEmpBoard && (
          <div className="mt-8">
            <GamificationSection />
          </div>
        )}

        {/* Ritu / del_super: own delegation points — below the board + modules */}
        {isEmpBoard && employee?.auth_user_id && (
          <div className="mt-8 max-w-md">
            <DelegationPointsCard
              authUserId={employee.auth_user_id}
              roleGroup={employee.role}
              period={delPeriod}
              onPeriodChange={setDelPeriod}
            />
          </div>
        )}
      </main>

      {/* Mobile bottom nav — other pages live here (CPS-style footer) */}
      {navActions.length > 0 && (
        <nav
          className="sm:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur-md border-t border-amber-100"
          style={{ boxShadow: '0 -2px 16px rgba(146,64,14,0.10)' }}
        >
          <div className="flex items-stretch gap-1 overflow-x-auto px-2 py-1.5">
            {navActions.map((a) => (
              <button
                key={a.key}
                onClick={a.onClick}
                className="flex flex-col items-center justify-center gap-0.5 px-3 py-1 min-w-[68px] rounded-lg text-stone-600 hover:bg-amber-50 active:bg-amber-100 shrink-0"
              >
                <a.Icon size={18} className="text-amber-700" />
                <span className="text-[10px] leading-none whitespace-nowrap">{a.label}</span>
              </button>
            ))}
          </div>
        </nav>
      )}

      {/* Founder floating avatar — top-left corner, founder only */}
      {employee?.role === 'founder' && <FounderAvatar />}
    </div>
  )
}
