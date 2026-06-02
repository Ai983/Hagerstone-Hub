import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { useQuery } from '@tanstack/react-query'
import { Navigate, useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/button'
import { ArrowLeft, LogOut, AlertCircle } from 'lucide-react'
import { motion } from 'framer-motion'
import { GamificationSection } from '../components/dashboard/GamificationSection'
import { DelegationFounderSection } from '../components/dashboard/DelegationFounderSection'
import { useDelegationPulse } from '../lib/delegation-scores'

type Kpis = {
  active_projects: number
  total_employees: number
  expense_approved_total: number
  imprest_paid_total: number
  po_total_value: number
  po_paid_total: number
  pending_founder_imprest: number
  pending_founder_po: number
}
type ProjectRow = {
  project_code: string; project_name: string; active: boolean
  assignments: number; po_count: number; po_value: number; po_paid: number
}
type StaffRow = { employee_name: string; expense_total: number; imprest_total: number }
type SiteRow = { site: string; expense_total: number; imprest_total: number }
type PendingImprest = {
  ref_id: string; employee_name: string | null; site: string | null
  amount: number; status: string; submitted_at: string | null
}
type PendingPo = {
  po_number: string; project_code: string | null; supplier: string | null
  grand_total: number; approval_status: string; created_at: string | null
}

const inr = (n: unknown) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
    .format(Number(n ?? 0))

const num = (n: unknown) => Number(n ?? 0).toLocaleString('en-IN')

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'

function useRpc<T>(fn: string, enabled: boolean) {
  return useQuery({
    queryKey: [fn],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(fn)
      if (error) throw error
      return (data ?? []) as T[]
    },
  })
}

export function FounderDashboard() {
  const { employee, loading: authLoading, signOut } = useAuth()
  const navigate = useNavigate()
  const role = employee?.role
  const allowed = role === 'founder' || role === 'admin'

  useDelegationPulse() // single realtime subscription for all delegation hooks on this page

  const kpisQ = useRpc<Kpis>('founder_kpis', allowed)
  const projectsQ = useRpc<ProjectRow>('founder_project_summary', allowed)
  const staffQ = useRpc<StaffRow>('founder_employee_finance', allowed)
  const sitesQ = useRpc<SiteRow>('founder_site_finance', allowed)
  const pImprestQ = useRpc<PendingImprest>('founder_pending_imprest', allowed)
  const pPosQ = useRpc<PendingPo>('founder_pending_pos', allowed)

  const handleSignOut = async () => { await signOut(); navigate('/login') }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-amber-50">
        <div className="text-amber-800 text-sm animate-pulse">Loading…</div>
      </div>
    )
  }
  if (!employee) return <Navigate to="/login" replace />
  if (!allowed) return <Navigate to="/dashboard" replace />

  const kpis = kpisQ.data?.[0] ?? null
  const firstName = employee.name?.split(' ')[0] ?? ''

  return (
    <div
      className="min-h-screen"
      style={{ background: 'radial-gradient(ellipse at 20% 0%, #fef9ec 0%, #fffbf0 40%, #fef3c7 100%)' }}
    >
      <header
        className="bg-white/70 backdrop-blur-md border-b border-amber-100/80 px-6 py-3.5"
        style={{ boxShadow: '0 2px 24px rgba(146,64,14,0.08)' }}
      >
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost" size="sm"
              onClick={() => navigate('/dashboard')}
              className="text-xs text-stone-500 hover:text-stone-700"
            >
              <ArrowLeft size={14} className="mr-1.5" /> Modules
            </Button>
            <span className="text-stone-300">|</span>
            <div className="font-semibold text-stone-800 text-sm">Founder Overview</div>
          </div>
          <Button variant="ghost" size="sm" onClick={handleSignOut} className="text-xs text-stone-400 hover:text-stone-600">
            <LogOut size={13} className="mr-1.5" /> Sign out
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
          <h1 className="text-2xl font-semibold text-stone-800 tracking-tight">Welcome, {firstName} 👋</h1>
          <p className="text-sm text-stone-400 mt-1">Live overview across procurement and finance.</p>
        </motion.div>

        {kpisQ.error && <ErrorBox label="KPIs" error={kpisQ.error} />}

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard label="Active Projects" value={num(kpis?.active_projects)} loading={kpisQ.isLoading} />
          <KpiCard label="Employees" value={num(kpis?.total_employees)} loading={kpisQ.isLoading} />
          <KpiCard label="PO Value (total)" value={inr(kpis?.po_total_value)} loading={kpisQ.isLoading} />
          <KpiCard label="PO Paid" value={inr(kpis?.po_paid_total)} loading={kpisQ.isLoading} />
          <KpiCard label="Approved Expense" value={inr(kpis?.expense_approved_total)} loading={kpisQ.isLoading} />
          <KpiCard label="Imprest Paid" value={inr(kpis?.imprest_paid_total)} loading={kpisQ.isLoading} />
          <KpiCard label="Imprest awaiting you" value={num(kpis?.pending_founder_imprest)} loading={kpisQ.isLoading} highlight />
          <KpiCard label="POs awaiting you" value={num(kpis?.pending_founder_po)} loading={kpisQ.isLoading} highlight />
        </div>

        {/* Approval queues */}
        <div className="grid lg:grid-cols-2 gap-6">
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
          <Panel title="Purchase orders awaiting your approval">
            {pPosQ.error ? <ErrorBox label="Pending POs" error={pPosQ.error} /> : (
              <SimpleTable
                head={['PO #', 'Project', 'Supplier', 'Amount', 'Status', 'Created']}
                empty="Nothing pending 🎉"
                rows={(pPosQ.data ?? []).map(r => [
                  r.po_number, r.project_code ?? '—', r.supplier ?? '—', inr(r.grand_total), r.approval_status, fmtDate(r.created_at),
                ])}
                rightAlign={[3]}
              />
            )}
          </Panel>
        </div>

        {/* Projects */}
        <Panel title="Projects — committed PO spend">
          {projectsQ.error ? <ErrorBox label="Projects" error={projectsQ.error} /> : (
            <SimpleTable
              head={['Project', 'Code', 'Status', 'Staff', 'POs', 'PO Value', 'PO Paid']}
              empty="No projects."
              rows={(projectsQ.data ?? []).map(r => [
                r.project_name, r.project_code, r.active ? 'Active' : 'Inactive',
                num(r.assignments), num(r.po_count), inr(r.po_value), inr(r.po_paid),
              ])}
              rightAlign={[3, 4, 5, 6]}
            />
          )}
        </Panel>

        {/* Site + employee finance */}
        <div className="grid lg:grid-cols-2 gap-6">
          <Panel title="Spend by site">
            {sitesQ.error ? <ErrorBox label="Site finance" error={sitesQ.error} /> : (
              <SimpleTable
                head={['Site', 'Expense', 'Imprest']}
                empty="No data."
                rows={(sitesQ.data ?? []).map(r => [r.site, inr(r.expense_total), inr(r.imprest_total)])}
                rightAlign={[1, 2]}
              />
            )}
          </Panel>
          <Panel title="Spend by employee">
            {staffQ.error ? <ErrorBox label="Employee finance" error={staffQ.error} /> : (
              <SimpleTable
                head={['Employee', 'Expense', 'Imprest']}
                empty="No data."
                rows={(staffQ.data ?? []).map(r => [r.employee_name, inr(r.expense_total), inr(r.imprest_total)])}
                rightAlign={[1, 2]}
              />
            )}
          </Panel>
        </div>

        {/* Delegation — org overview */}
        <DelegationFounderSection />

        {/* CPS/Finance Rewards — team leaderboards (Procurement + Finance) */}
        <div>
          <h2 className="text-sm font-medium text-stone-700 mb-3">CPS/Finance Rewards — team leaderboards</h2>
          <GamificationSection />
        </div>
      </main>
    </div>
  )
}

function KpiCard({ label, value, loading, highlight }: { label: string; value: string; loading: boolean; highlight?: boolean }) {
  return (
    <div
      className={`rounded-2xl p-4 border ${highlight ? 'bg-amber-800 border-amber-800' : 'bg-white border-stone-100'}`}
      style={{ boxShadow: '0 4px 16px rgba(146,64,14,0.08)' }}
    >
      <div className={`text-xs uppercase tracking-wide ${highlight ? 'text-amber-100' : 'text-stone-400'}`}>{label}</div>
      <div className={`text-xl font-semibold mt-1 ${highlight ? 'text-white' : 'text-stone-800'}`}>
        {loading ? '…' : value}
      </div>
    </div>
  )
}

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
        <tr>
          {head.map((h, i) => (
            <th key={h} className={`px-4 py-2.5 font-medium ${ra.has(i) ? 'text-right' : ''}`}>{h}</th>
          ))}
        </tr>
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

function ErrorBox({ label, error }: { label: string; error: unknown }) {
  const msg = error instanceof Error ? error.message : JSON.stringify(error)
  return (
    <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <div><strong>{label} failed:</strong> {msg}</div>
    </div>
  )
}
