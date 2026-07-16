import { useState, useCallback, lazy, Suspense, useEffect, useRef } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate, useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/button'
import { ArrowLeft, LogOut, AlertCircle, ExternalLink } from 'lucide-react'
import { motion } from 'framer-motion'
import { useDelegationPulse } from '../lib/delegation-scores'
import { DashboardFilters } from '../components/dashboard/founder/DashboardFilters'
import { ChatbotWidget } from '../components/dashboard/founder/chatbot/ChatbotWidget'
import { HeadlineKpis } from '../components/dashboard/founder/HeadlineKpis'
import type { FilterState, HeadlineKpi, FinanceSummary, CpsSummary, ProjectCostRow, DelegationSummary, ImprestAgeing } from '../components/dashboard/founder/types'
import { useFounderRealtime } from '../components/dashboard/founder/useFounderRealtime'

// Heavy sections — lazy-loaded so initial paint is fast
const FinanceSection           = lazy(() => import('../components/dashboard/founder/FinanceSection').then(m => ({ default: m.FinanceSection })))
const CpsSection               = lazy(() => import('../components/dashboard/founder/CpsSection').then(m => ({ default: m.CpsSection })))
const ProjectCostsSection      = lazy(() => import('../components/dashboard/founder/ProjectCostsSection').then(m => ({ default: m.ProjectCostsSection })))
const DelegationAnalyticsSection = lazy(() => import('../components/dashboard/founder/DelegationAnalyticsSection').then(m => ({ default: m.DelegationAnalyticsSection })))
const ImprestAgeingSection     = lazy(() => import('../components/dashboard/founder/ImprestAgeingSection').then(m => ({ default: m.ImprestAgeingSection })))
// Below-fold unified Work Score board (single company-wide leaderboard)
const RecognitionStrip = lazy(() => import('../components/dashboard/RecognitionStrip').then(m => ({ default: m.RecognitionStrip })))
const WorkLeaderboard  = lazy(() => import('../components/dashboard/WorkLeaderboard').then(m => ({ default: m.WorkLeaderboard })))

/** Skeleton fallback for Suspense boundaries */
function SectionSkeleton() {
  return (
    <div className="rounded-2xl bg-white/60 border border-stone-100 p-6 space-y-3 animate-pulse">
      <div className="h-4 w-32 bg-stone-200 rounded-full" />
      <div className="grid grid-cols-3 gap-3">
        {[1,2,3].map(i => <div key={i} className="h-16 bg-stone-100 rounded-xl" />)}
      </div>
      <div className="h-40 bg-stone-100 rounded-xl" />
    </div>
  )
}

/** Only renders children once the element has been scrolled near the viewport. */
function DeferUntilVisible({ children, rootMargin = '200px' }: { children: React.ReactNode; rootMargin?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect() } },
      { rootMargin }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [rootMargin])
  return <div ref={ref}>{visible ? children : <SectionSkeleton />}</div>
}

// ─── existing types (kept for legacy approval-queue sections) ───────────────
type PendingImprest = {
  ref_id: string; employee_name: string | null; site: string | null
  amount: number; status: string; submitted_at: string | null
}
// PO approval queue rows come enriched with a per-founder /approve-po deep link
// (see public.founder_pending_po_approvals). `can_act` is true only for the two
// founders who own an approval token (Dhruv / Bhaskar); others view read-only.
type PendingPoLink = {
  po_number: string; project_code: string | null; supplier: string | null
  grand_total: number; approval_status: string; created_at: string | null
  approve_url: string | null; can_act: boolean
}

const inr = (n: unknown) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
    .format(Number(n ?? 0))

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'

// ─── hooks ──────────────────────────────────────────────────────────────────
function useRpcLegacy<T>(fn: string, enabled: boolean) {
  return useQuery({
    queryKey: [fn],
    enabled,
    refetchInterval: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(fn)
      if (error) throw error
      return (data ?? []) as T[]
    },
  })
}

function useHeadlineKpis(filters: FilterState, enabled: boolean) {
  return useQuery({
    queryKey: ['founder_headline_kpis', filters.period, filters.site],
    enabled,
    staleTime: 60_000,
    refetchInterval: 90_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('founder_headline_kpis', {
        p_period: filters.period,
        p_site: filters.site,
      })
      if (error) throw error
      return (data?.[0] ?? null) as HeadlineKpi | null
    },
  })
}

function useFinanceSummary(filters: FilterState, enabled: boolean) {
  return useQuery({
    queryKey: ['founder_finance_summary', filters.period, filters.site, filters.employeeId],
    enabled,
    staleTime: 60_000,
    refetchInterval: 90_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('founder_finance_summary', {
        p_period: filters.period,
        p_site: filters.site,
        p_employee_id: filters.employeeId,
      })
      if (error) throw error
      return (data ?? null) as FinanceSummary | null
    },
  })
}

function useCpsSummary(filters: FilterState, enabled: boolean) {
  return useQuery({
    queryKey: ['founder_cps_summary', filters.period, filters.site],
    enabled,
    staleTime: 60_000,
    refetchInterval: 90_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('founder_cps_summary', {
        p_period: filters.period,
        p_project: filters.site,
      })
      if (error) throw error
      return (data ?? null) as CpsSummary | null
    },
  })
}

function useProjectCosts(filters: FilterState, enabled: boolean) {
  return useQuery({
    queryKey: ['founder_project_costs', filters.period],
    enabled,
    staleTime: 90_000,
    refetchInterval: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('founder_project_costs', {
        p_period: filters.period,
      })
      if (error) throw error
      return (data ?? []) as ProjectCostRow[]
    },
  })
}

function useDelegationSummary(filters: FilterState, enabled: boolean) {
  return useQuery({
    queryKey: ['founder_delegation_summary', filters.period, filters.employeeId, filters.roleGroup],
    enabled,
    staleTime: 60_000,
    refetchInterval: 90_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('founder_delegation_summary', {
        p_period: filters.period,
        p_person_id: filters.employeeId,
        p_role_group: filters.roleGroup,
      })
      if (error) throw error
      return (data ?? null) as DelegationSummary | null
    },
  })
}

function useImprestAgeing(filters: FilterState, enabled: boolean) {
  return useQuery({
    queryKey: ['founder_imprest_ageing', filters.site],
    enabled,
    staleTime: 60_000,
    refetchInterval: 90_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('founder_imprest_ageing', {
        p_site: filters.site,
      })
      if (error) throw error
      return (data ?? null) as ImprestAgeing | null
    },
  })
}

function useEmployees(enabled: boolean) {
  return useQuery({
    queryKey: ['employees_list'],
    enabled,
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employees')
        .select('id, name, role')
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      return (data ?? []) as { id: string; name: string; role: string }[]
    },
  })
}

function useSites(enabled: boolean) {
  return useQuery({
    queryKey: ['finance_sites'],
    enabled,
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('founder_site_finance')
      if (error) throw error
      return ((data ?? []) as { site: string }[]).map(r => r.site).filter(Boolean)
    },
  })
}

// ─── component ──────────────────────────────────────────────────────────────
export function FounderDashboard() {
  const { employee, loading: authLoading, signOut } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const role = employee?.role
  const allowed = role === 'founder' || role === 'admin' || role === 'management'

  const [filters, setFilters] = useState<FilterState>({
    period: 'month',
    site: null,
    employeeId: null,
    roleGroup: null,
  })
  const [lastUpdated, setLastUpdated] = useState<Date | null>(new Date())
  const patchFilters = useCallback((next: Partial<FilterState>) => {
    setFilters(prev => ({ ...prev, ...next }))
    setLastUpdated(new Date())
  }, [])

  const refreshAll = useCallback(() => {
    qc.invalidateQueries()
    setLastUpdated(new Date())
  }, [qc])

  useDelegationPulse()
  useFounderRealtime(allowed)

  const headlineQ  = useHeadlineKpis(filters, allowed)
  const financeQ   = useFinanceSummary(filters, allowed)
  const cpsQ       = useCpsSummary(filters, allowed)
  const projectsQ  = useProjectCosts(filters, allowed)
  const delQ       = useDelegationSummary(filters, allowed)
  const ageingQ    = useImprestAgeing(filters, allowed)
  const employeesQ = useEmployees(allowed)
  const sitesQ     = useSites(allowed)

  // Legacy pending queues
  const pImprestQ = useRpcLegacy<PendingImprest>('founder_pending_imprest', allowed)
  const pPosQ     = useRpcLegacy<PendingPoLink>('founder_pending_po_approvals', allowed)

  const anyLoading = headlineQ.isLoading || financeQ.isLoading || cpsQ.isLoading

  const handleSignOut = async () => { await signOut(); navigate('/login') }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-amber-50">
        <div className="text-amber-800 text-sm animate-pulse">Loading…</div>
      </div>
    )
  }
  if (!employee) return <Navigate to="/login" replace />
  if (!allowed)  return <Navigate to="/dashboard" replace />

  const firstName = employee.name?.split(' ')[0] ?? ''

  return (
    <div className="min-h-screen" style={{ background: 'radial-gradient(ellipse at 20% 0%, #fef9ec 0%, #fffbf0 40%, #fef3c7 100%)' }}>
      {/* ── Header ── */}
      <header
        className="bg-white/70 backdrop-blur-md border-b border-amber-100/80 px-3 sm:px-6 py-3.5"
        style={{ boxShadow: '0 2px 24px rgba(146,64,14,0.08)' }}
      >
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')} className="text-xs text-stone-500 hover:text-stone-700 shrink-0 px-2">
              <ArrowLeft size={14} className="sm:mr-1.5" /> <span className="hidden sm:inline">Modules</span>
            </Button>
            <span className="text-stone-300 shrink-0">|</span>
            <div className="font-semibold text-stone-800 text-sm truncate">Founder Overview</div>
          </div>
          <Button variant="ghost" size="sm" onClick={handleSignOut} className="text-xs text-stone-400 hover:text-stone-600 shrink-0 px-2">
            <LogOut size={13} className="sm:mr-1.5" /> <span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
      </header>

      {/* ── Sticky Filters ── */}
      <DashboardFilters
        filters={filters}
        onChange={patchFilters}
        sites={sitesQ.data ?? []}
        employees={employeesQ.data ?? []}
        lastUpdated={lastUpdated}
        onRefresh={refreshAll}
        isLoading={anyLoading}
      />

      <main className="max-w-6xl mx-auto px-4 lg:px-6 py-8 space-y-10">
        {/* Greeting */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
          <h1 className="text-2xl font-semibold text-stone-800 tracking-tight">Welcome, {firstName} 👋</h1>
          <p className="text-sm text-stone-400 mt-1">Live overview across procurement, finance and operations.</p>
        </motion.div>

        {/* ── Headline KPIs ── */}
        <HeadlineKpis data={headlineQ.data ?? null} loading={headlineQ.isLoading} />

        {/* ── Pending Approvals — surfaced right under the KPIs so founders can act
             without hunting; rendered eagerly (no lazy defer) for findability. ── */}
        <section id="approvals-queue" className="scroll-mt-24 space-y-4">
          <h2 className="text-sm font-semibold text-stone-700 flex items-center gap-2">
            ✅ Pending Approvals — action required
          </h2>
          <div className="grid lg:grid-cols-2 gap-6">
            <PoApprovalPanel query={pPosQ} />
            <Panel title="Imprest awaiting your approval">
              {pImprestQ.error ? <ErrorBox label="Pending imprest" error={pImprestQ.error} /> : (
                <SimpleTable
                  head={['Ref', 'Employee', 'Site', 'Amount', 'Status', 'Submitted']}
                  empty="Nothing pending 🎉"
                  rows={(pImprestQ.data ?? []).map(r => [
                    r.ref_id, r.employee_name ?? '—', r.site ?? '—', inr(r.amount), r.status, fmtDate(r.submitted_at),
                  ])}
                  rightAlign={[3]}
                />
              )}
            </Panel>
          </div>
        </section>

        {/* ── Finance Section ── */}
        <Suspense fallback={<SectionSkeleton />}>
          <FinanceSection data={financeQ.data ?? null} loading={financeQ.isLoading} period={filters.period} site={filters.site} employeeId={filters.employeeId} />
        </Suspense>

        {/* ── Imprest & Finance Ageing — live version of the static ageing report ── */}
        <DeferUntilVisible>
          <Suspense fallback={<SectionSkeleton />}>
            <ImprestAgeingSection data={ageingQ.data ?? null} loading={ageingQ.isLoading} site={filters.site} />
          </Suspense>
        </DeferUntilVisible>

        {/* ── CPS / Procurement Section ── */}
        <Suspense fallback={<SectionSkeleton />}>
          <CpsSection data={cpsQ.data ?? null} loading={cpsQ.isLoading} period={filters.period} project={filters.site} />
        </Suspense>

        {/* ── Per-Project Cost Rollup — deferred until near viewport ── */}
        <DeferUntilVisible>
          <Suspense fallback={<SectionSkeleton />}>
            <ProjectCostsSection data={projectsQ.data ?? []} loading={projectsQ.isLoading} period={filters.period} />
          </Suspense>
        </DeferUntilVisible>

        {/* ── Delegation Analytics — deferred ── */}
        <DeferUntilVisible>
          <Suspense fallback={<SectionSkeleton />}>
            <DelegationAnalyticsSection data={delQ.data ?? null} loading={delQ.isLoading} period={filters.period} />
          </Suspense>
        </DeferUntilVisible>

        {/* ── Unified Work Score — the single company-wide leaderboard ── */}
        <DeferUntilVisible>
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-stone-700">Work Score — company-wide recognition</h2>
            <Suspense fallback={<SectionSkeleton />}>
              <RecognitionStrip />
              <WorkLeaderboard />
            </Suspense>
          </div>
        </DeferUntilVisible>
      </main>

      {/* Natural-language analytics chatbot — founders & admins only */}
      {(role === 'founder' || role === 'admin') && <ChatbotWidget />}
    </div>
  )
}

// ─── shared sub-components (Panel, SimpleTable, ErrorBox) ──────────────────
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-stone-100" style={{ boxShadow: '0 4px 16px rgba(146,64,14,0.07)' }}>
      <h2 className="px-4 py-3 font-medium text-stone-700 text-sm border-b border-stone-100">{title}</h2>
      <div className="overflow-x-auto">{children}</div>
    </div>
  )
}

function SimpleTable({
  head, rows, empty, rightAlign = [],
}: { head: string[]; rows: (string | number)[][]; empty: string; rightAlign?: number[] }) {
  if (rows.length === 0) {
    return <div className="px-4 py-6 text-sm text-stone-400">{empty}</div>
  }
  const ra = new Set(rightAlign)
  return (
    <table className="w-full text-sm">
      <thead className="bg-stone-50 text-stone-500 text-left">
        <tr>{head.map((h, i) => <th key={h} className={`px-4 py-2.5 font-medium ${ra.has(i) ? 'text-right' : ''}`}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} className="border-t border-stone-100">
            {r.map((c, ci) => (
              <td key={ci} className={`px-4 py-2.5 text-stone-700 ${ra.has(ci) ? 'text-right tabular-nums' : ''}`}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// Actionable PO approval queue. Each row deep-links to the existing CPS
// /approve-po page (opened in a new tab) using the founder's own token, so a
// founder can approve/reject without the WhatsApp message ever arriving.
// Non-founder viewers (admins/management) see the list read-only.
function PoApprovalPanel({
  query,
}: {
  query: { data?: PendingPoLink[]; error: unknown; isLoading: boolean }
}) {
  const pos = query.data ?? []
  return (
    <Panel title={`Purchase orders awaiting your approval${pos.length ? ` (${pos.length})` : ''}`}>
      {query.error ? (
        <ErrorBox label="Pending POs" error={query.error} />
      ) : query.isLoading ? (
        <div className="px-4 py-6 text-sm text-stone-400 animate-pulse">Loading…</div>
      ) : pos.length === 0 ? (
        <div className="px-4 py-6 text-sm text-stone-400">Nothing pending 🎉</div>
      ) : (
        <div className="max-h-96 overflow-y-auto divide-y divide-stone-100">
          {pos.map(po => (
            <div key={po.po_number} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-stone-800 truncate">{po.po_number}</div>
                <div className="text-xs text-stone-400 truncate">
                  {(po.supplier ?? '—')} · {(po.project_code ?? '—')} · {fmtDate(po.created_at)}
                </div>
              </div>
              <div className="text-sm font-medium text-stone-800 tabular-nums shrink-0">{inr(po.grand_total)}</div>
              {po.can_act && po.approve_url ? (
                <a
                  href={po.approve_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg px-3 py-1.5 transition active:scale-95"
                >
                  Review <ExternalLink size={12} />
                </a>
              ) : (
                <span className="shrink-0 text-[11px] text-stone-400 italic">Founder sign-in to act</span>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

function ErrorBox({ label, error }: { label: string; error: unknown }) {
  const msg = error instanceof Error ? error.message : JSON.stringify(error)
  return (
    <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <div><strong>{label} failed:</strong> {msg}</div>
    </div>
  )
}
