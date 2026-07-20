import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { isLeadership } from '../components/LeadershipRoute'
import { ArrowLeft, ClipboardCheck, Activity, Wallet, ShieldCheck, CheckCircle2, Clock } from 'lucide-react'
import { Button } from '../components/ui/button'
import {
  useEmployeeScorecard, deptLabel, initials, fmtINR, type WorkPeriod,
} from '../lib/work-scores'

const PERIODS: { key: WorkPeriod; label: string }[] = [
  { key: 'week', label: 'Week' }, { key: 'month', label: 'Month' }, { key: 'all', label: 'All Time' },
]

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="bg-stone-50 rounded-xl px-3 py-2.5">
      <div className="text-[11px] text-stone-400">{label}</div>
      <div className="text-lg font-bold text-stone-800 leading-tight">{value}</div>
      {sub && <div className="text-[10px] text-stone-400">{sub}</div>}
    </div>
  )
}

function Card({ title, icon, accent, children }: { title: string; icon: React.ReactNode; accent: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-stone-100 p-4">
      <div className={`flex items-center gap-2 mb-3 ${accent}`}>{icon}<span className="text-sm font-semibold">{title}</span></div>
      {children}
    </div>
  )
}

export function EmployeePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { employee } = useAuth()
  const [period, setPeriod] = useState<WorkPeriod>('month')

  // Staff may only view their own scorecard; send them to it if they try another.
  useEffect(() => {
    if (employee && !isLeadership(employee) && id && id !== employee.auth_user_id) {
      navigate(`/employee/${employee.auth_user_id}`, { replace: true })
    }
  }, [employee, id, navigate])

  const { data, isLoading, error } = useEmployeeScorecard(id, period)

  if (isLoading) return <Centered>Loading scorecard…</Centered>
  if (error || !data || data.error) return <Centered>Could not load this employee.</Centered>

  const u = data.user
  const dept = u.department
  const showOps = ['site_engineer', 'procurement', 'finance'].includes(dept)

  return (
    <div className="min-h-screen bg-amber-50">
      <header className="bg-white border-b border-gray-100 px-6 py-4">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}><ArrowLeft size={14} className="mr-1" /> Back</Button>
          <span className="text-stone-300">|</span>
          <h1 className="font-semibold text-stone-800 truncate">Employee Scorecard</h1>
          <div className="flex-1" />
          <div className="flex bg-stone-100 rounded-lg p-0.5">
            {PERIODS.map((p) => (
              <button key={p.key} onClick={() => setPeriod(p.key)}
                className={`px-3 py-1 text-xs font-medium rounded-md ${period === p.key ? 'bg-white text-amber-800 shadow-sm' : 'text-stone-500'}`}>{p.label}</button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-6 space-y-4">
        {/* Hero */}
        <div className="bg-white rounded-2xl border border-stone-100 p-5 flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-300 to-amber-500 text-amber-900 flex items-center justify-center text-xl font-bold shrink-0">{initials(u.name)}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold text-stone-800 truncate">{u.name}</h2>
              {u.is_del_super && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 font-medium">Coordinator</span>}
            </div>
            <div className="text-sm text-stone-500">{deptLabel(dept)}{u.designation ? ` · ${u.designation}` : ''}</div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-3xl font-bold text-amber-800 leading-none">{u.total}</div>
            <div className="text-[11px] text-stone-400 mt-1">total pts · rank #{u.rank_in_dept ?? '—'} in team</div>
          </div>
        </div>

        {/* Points breakdown */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <BreakTile label="Task points" value={u.task_points} cls="from-amber-50 text-amber-800 border-amber-200" hint="assigned & verified" />
          <BreakTile label="Operational" value={u.ops_points} cls="from-emerald-50 text-emerald-800 border-emerald-200" hint="auto CPS/Finance" />
          <BreakTile label="Coordinator" value={u.coord_points} cls="from-violet-50 text-violet-800 border-violet-200" hint="assign & verify" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Tasks */}
          <Card title="Delegation Tasks" icon={<ClipboardCheck size={15} />} accent="text-amber-700">
            <div className="grid grid-cols-2 gap-2 mb-3">
              <Stat label="Completed" value={data.tasks.completed} />
              <Stat label="In progress" value={data.tasks.in_progress} />
            </div>
            <div className="space-y-1">
              {data.tasks.recent.length === 0 && <div className="text-xs text-stone-400 py-2">No recent tasks.</div>}
              {data.tasks.recent.map((t, i) => (
                <div key={i} className="flex items-center gap-2 text-xs py-1 border-b border-stone-50 last:border-0">
                  {t.point_status === 'verified' ? <CheckCircle2 size={13} className="text-emerald-500 shrink-0" /> : <Clock size={13} className="text-stone-300 shrink-0" />}
                  <span className="flex-1 truncate text-stone-600">{t.title}</span>
                  <span className="text-stone-400">{t.task_date ?? ''}</span>
                  {t.points != null && <span className="font-semibold text-amber-700 w-8 text-right">+{t.points}</span>}
                </div>
              ))}
            </div>
          </Card>

          {/* Imprest */}
          <Card title="Imprest (raised & collected)" icon={<Wallet size={15} />} accent="text-emerald-700">
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Raised" value={data.imprest.raised_count} sub={fmtINR(data.imprest.raised_amount)} />
              <Stat label="Collected" value={fmtINR(data.imprest.collected_amount)} sub={`${data.imprest.paid_count} paid`} />
              <Stat label="Pending" value={data.imprest.pending_count} />
              <Stat label="Approved" value={fmtINR(data.imprest.approved_amount)} />
            </div>
          </Card>

          {/* Operations (role-relevant) */}
          {showOps && (
            <Card title="Operational Activity" icon={<Activity size={15} />} accent="text-emerald-700">
              <div className="grid grid-cols-2 gap-2">
                {dept === 'site_engineer' && <>
                  <Stat label="Stock days logged" value={data.operations.stock_days} sub="×10 pts" />
                  <Stat label="Quote→PO wins" value={data.operations.quote_wins} sub="×10 pts" />
                  <Stat label="Imprest on-time" value={data.operations.imprest_ontime} sub="×5 pts" />
                </>}
                {dept === 'procurement' && <>
                  <Stat label="PR dispatched on-time" value={data.operations.proc_on_time} sub="×10 pts" />
                  <Stat label="PR dispatched late" value={data.operations.proc_late} sub="×5 pts" />
                </>}
                {dept === 'finance' && <Stat label="Imprests processed on-time" value={data.operations.fin_processed_ontime} sub="×5 pts" />}
              </div>
            </Card>
          )}

          {/* Coordinator */}
          {data.coordinator && (
            <Card title="Coordinator Performance" icon={<ShieldCheck size={15} />} accent="text-violet-700">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Stat label="Tasks assigned → done" value={data.coordinator.assigned_completed} sub="×2 pts" />
                <Stat label="Verified <24h" value={data.coordinator.verify_fast} sub="×3 pts" />
                <Stat label="Verified 24–48h" value={data.coordinator.verify_ok} sub="×1 pt" />
              </div>
            </Card>
          )}
        </div>
      </main>
    </div>
  )
}

function BreakTile({ label, value, cls, hint }: { label: string; value: number; cls: string; hint: string }) {
  return (
    <div className={`bg-gradient-to-br ${cls} border rounded-2xl p-3`}>
      <div className="text-xs font-medium opacity-80">{label}</div>
      <div className="text-2xl font-bold leading-tight">{value}</div>
      <div className="text-[10px] opacity-60">{hint}</div>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen bg-amber-50 flex flex-col items-center justify-center gap-3 text-stone-400 text-sm">
      {children}
      <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')}>Back to dashboard</Button>
    </div>
  )
}
