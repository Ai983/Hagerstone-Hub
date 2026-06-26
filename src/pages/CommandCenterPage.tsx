import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { ArrowLeft, LogOut, Radar, LineChart, FileClock, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { Button } from '../components/ui/button'
import { fetchAllActiveEmployees, fetchAllTaskTypes } from '../lib/delegation'
import { useGieGroups, useGiePulse, triggerSummarise, approveDraft, type GieDraftTask } from '../lib/gie'
import { CreateTaskForm } from './delegation/MyDayPage'
import { GroupMemoViewer } from '../components/dashboard/gie/GroupMemoViewer'
import { FlagQueue } from '../components/dashboard/gie/FlagQueue'
import { DraftTaskQueue } from '../components/dashboard/gie/DraftTaskQueue'
import { HeadlineKpis } from '../components/dashboard/founder/HeadlineKpis'
import type { HeadlineKpi } from '../components/dashboard/founder/types'
import { ChatbotWidget } from '../components/dashboard/founder/chatbot/ChatbotWidget'

/** Only renders children once scrolled near the viewport (mirrors FounderDashboard). */
function DeferUntilVisible({ children, rootMargin = '200px' }: { children: React.ReactNode; rootMargin?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || visible) return
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setVisible(true); io.disconnect() }
    }, { rootMargin })
    io.observe(el)
    return () => io.disconnect()
  }, [visible, rootMargin])
  return <div ref={ref}>{visible ? children : null}</div>
}

/** Company snapshot — same RPC + query key as FounderDashboard (cache shared). */
function useHeadlineKpis(enabled: boolean) {
  return useQuery({
    queryKey: ['founder_headline_kpis', 'month', null],
    enabled,
    staleTime: 60_000,
    refetchInterval: 90_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('founder_headline_kpis', { p_period: 'month', p_site: null })
      if (error) throw error
      return (data?.[0] ?? null) as HeadlineKpi | null
    },
  })
}

export function CommandCenterPage() {
  const { employee, loading, isAdmin, signOut } = useAuth()
  const navigate = useNavigate()
  useGiePulse() // single realtime subscription for all GIE queries on this page

  const role = employee?.role ?? ''
  const isFounderAdmin = role === 'founder' || isAdmin
  const allowed = isFounderAdmin || !!employee?.del_super

  const { data: groups = [] } = useGieGroups()
  const qc = useQueryClient()
  const [groupId, setGroupId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  useEffect(() => {
    if (!groupId && groups.length > 0) setGroupId(groups[0].id)
  }, [groups, groupId])

  // Shared lookups — same query keys/fns as MyDayPage so the cache + form stay in sync.
  const { data: employees = [] } = useQuery({ queryKey: ['del_all_active'], queryFn: fetchAllActiveEmployees, enabled: allowed })
  const { data: taskTypes = [] } = useQuery({ queryKey: ['del_task_types', 'all'], queryFn: fetchAllTaskTypes, enabled: allowed })

  const headlineQ = useHeadlineKpis(isFounderAdmin)

  // employees.id → name (preview) and employees.id → auth_user_id (seed the assignee picker).
  const { empNameById, empAuthById } = useMemo(() => {
    const names: Record<string, string> = {}
    const auths: Record<string, string> = {}
    for (const e of employees) {
      names[e.id] = e.name
      if (e.auth_user_id) auths[e.id] = e.auth_user_id
    }
    return { empNameById: names, empAuthById: auths }
  }, [employees])
  const [activeDraft, setActiveDraft] = useState<GieDraftTask | null>(null)

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-stone-400 text-sm">Loading…</div>
  }
  if (!employee) return <Navigate to="/login" replace />
  if (!allowed) return <Navigate to="/dashboard" replace />

  const handleSignOut = async () => { await signOut(); navigate('/login') }

  async function handleRefresh() {
    if (!groupId || refreshing) return
    setRefreshing(true)
    try {
      await triggerSummarise(groupId)
      qc.invalidateQueries({ queryKey: ['gie_summaries'] })
      qc.invalidateQueries({ queryKey: ['gie_flags'] })
      qc.invalidateQueries({ queryKey: ['gie_drafts'] })
      toast.success('Brief updated')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not refresh')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="min-h-screen"
      style={{ background: 'radial-gradient(ellipse at 20% 0%, #fef9ec 0%, #fffbf0 40%, #fef3c7 100%)' }}>
      <div className="fixed inset-0 pointer-events-none"
        style={{ backgroundImage: 'radial-gradient(circle, rgba(180,120,30,0.06) 1px, transparent 1px)', backgroundSize: '28px 28px' }} />

      {/* Header */}
      <motion.header
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 bg-white/70 backdrop-blur-md border-b border-amber-100/80 px-6 py-3.5"
        style={{ boxShadow: '0 2px 24px rgba(146,64,14,0.08)' }}
      >
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')} className="text-xs text-stone-500 hover:text-stone-700">
              <ArrowLeft size={14} className="mr-1" /> Modules
            </Button>
            <span className="text-stone-300">|</span>
            <div className="flex items-center gap-2">
              <Radar size={16} className="text-amber-700" />
              <h1 className="font-semibold text-stone-800 text-sm">Command Center</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing || !groupId}
              className="text-xs border-amber-300 text-amber-800 hover:bg-amber-50">
              <RefreshCw size={13} className={`mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleSignOut} className="text-xs text-stone-400 hover:text-stone-600">
              <LogOut size={13} className="mr-1.5" /> Sign out
            </Button>
          </div>
        </div>
      </motion.header>

      {/* Main */}
      <main className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 pt-8 pb-28 sm:pb-12 space-y-6">
        <GroupMemoViewer groups={groups} groupId={groupId} onGroupChange={setGroupId} />

        <FlagQueue groupId={groupId} actionedByEmployeeId={employee.id} />
        <DraftTaskQueue groupId={groupId} empNameById={empNameById} onReview={setActiveDraft} />

        {/* Company snapshot — founder/admin only (del_super coordinators don't see finance) */}
        {isFounderAdmin && (
          <DeferUntilVisible>
            <div className="rounded-2xl bg-white/60 backdrop-blur-sm border border-amber-100 p-4 sm:p-5"
              style={{ boxShadow: '0 4px 20px rgba(146,64,14,0.07)' }}>
              <HeadlineKpis data={headlineQ.data ?? null} loading={headlineQ.isLoading} />
            </div>
          </DeferUntilVisible>
        )}

        {/* Links into the deeper analytics surfaces */}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate('/founder')}
            className="text-xs border-amber-200 text-amber-800 hover:bg-amber-50">
            <LineChart size={13} className="mr-1.5" /> Full Founder Overview
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/founder')}
            className="text-xs border-amber-200 text-amber-800 hover:bg-amber-50">
            <FileClock size={13} className="mr-1.5" /> Imprest Ageing
          </Button>
        </div>
      </main>

      {/* Natural-language analytics chatbot — founders & admins only */}
      {isFounderAdmin && <ChatbotWidget />}

      {/* Dispatch a draft through the SHARED delegation form — same criteria, incl. Kaam ka type */}
      {activeDraft && (
        <CreateTaskForm
          employee={employee}
          taskTypes={taskTypes}
          teamMembers={employees}
          initial={{
            title: activeDraft.title,
            assignedTo: activeDraft.suggested_assignee_employee_id ? empAuthById[activeDraft.suggested_assignee_employee_id] : undefined,
            projectId: activeDraft.project_id ?? undefined,
            onBehalfOf: activeDraft.on_behalf_of ?? undefined,
            taskDate: activeDraft.task_date ?? undefined,
            dueTime: activeDraft.due_time ?? undefined,
          }}
          onClose={() => setActiveDraft(null)}
          onCreated={() => { void approveDraft(activeDraft.id).then(() => qc.invalidateQueries({ queryKey: ['gie_drafts'] })) }}
        />
      )}
    </div>
  )
}
