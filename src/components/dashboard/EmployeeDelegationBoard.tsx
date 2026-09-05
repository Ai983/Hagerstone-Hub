import { useState, useMemo } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { AnimatePresence } from 'framer-motion'
import { Search, Plus, Send, Loader2, Check, Paperclip, FileText, ListTodo, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../hooks/useAuth'
import {
  fetchAllActiveEmployees,
  fetchAllOpenTasks,
  fetchCompletedTasks,
  fetchManualFollowups,
  resendTaskFollowup,
  type FollowupLog,
} from '../../lib/delegation'
import { DelegationSheet } from '../delegation/DelegationSheet'
import { ROLE_SHORT_LABELS } from '../../config/roles'
import type { Employee, RoleId } from '../../types'
import type { DelTask } from '../../types/delegation'
import { urgencyFromPoints } from '../../lib/urgency'
import { Button } from '../ui/button'

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

const STATUS_PILL: Record<string, string> = {
  assigned:     'bg-stone-100 text-stone-600 border-stone-200',
  in_progress:  'bg-sky-100 text-sky-700 border-sky-200',
  submitted:    'bg-amber-100 text-amber-700 border-amber-200',
  under_review: 'bg-violet-100 text-violet-700 border-violet-200',
}
const TONE_COLOR: Record<string, string> = {
  overdue: 'text-red-600 font-semibold',
  today:   'text-amber-700 font-semibold',
  soon:    'text-amber-600',
  ok:      'text-stone-500',
}

interface DeadlineInfo { label: string; sub: string | null; tone: 'overdue' | 'today' | 'soon' | 'ok' }

// The column shows the actual calendar date ("5 Sep · 14:30"), not a relative
// word — Ma'am reads this against her own diary, and "Aaj / Kal / 3d baaki" is
// unusable for that. Lateness stays as a secondary hint on overdue rows only,
// since that is the one case where the gap matters more than the date.
function deadlineInfo(task: DelTask): DeadlineInfo {
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
  const diff = Math.round((new Date(task.task_date + 'T00:00:00Z').getTime() - new Date(todayStr + 'T00:00:00Z').getTime()) / 86400000)
  const date = new Date(task.task_date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  const label = task.due_time ? `${date} · ${String(task.due_time).slice(0, 5)}` : date
  if (diff < 0)   return { label, sub: `${Math.abs(diff)}d late`, tone: 'overdue' }
  if (diff === 0) return { label, sub: null, tone: 'today' }
  if (diff === 1) return { label, sub: null, tone: 'soon' }
  return { label, sub: null, tone: 'ok' }
}

function fmtDay(s?: string | null): string {
  if (!s) return '—'
  const d = new Date(s.length <= 10 ? s + 'T00:00:00' : s)
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export function EmployeeDelegationBoard() {
  const { employee } = useAuth()
  const qc = useQueryClient()
  const [tab, setTab] = useState<'ongoing' | 'completed'>('ongoing')
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [resendId, setResendId] = useState<string | null>(null)

  const { data: employees = [] }      = useQuery({ queryKey: ['del_all_employees'], queryFn: fetchAllActiveEmployees })
  const { data: openTasks = [] }      = useQuery({ queryKey: ['del_all_open_tasks'], queryFn: fetchAllOpenTasks })
  const { data: completedTasks = [] } = useQuery({ queryKey: ['del_completed_tasks'], queryFn: fetchCompletedTasks })
  const { data: followups = [] }      = useQuery({ queryKey: ['del_followups'], queryFn: fetchManualFollowups })

  const nameByUid = useMemo(() => {
    const m = new Map<string, { name: string; role: string }>()
    ;(employees as Employee[]).forEach((e) => m.set(e.auth_user_id ?? '', { name: e.name, role: e.role }))
    return m
  }, [employees])

  const fuByTask = useMemo(() => {
    const m = new Map<string, FollowupLog[]>()
    followups.forEach((f) => { const a = m.get(f.task_id) ?? []; a.push(f); m.set(f.task_id, a) })
    return m
  }, [followups])

  const ongoing = useMemo(() => {
    const q = norm(query)
    return (openTasks as DelTask[])
      .filter((t) => !q || norm(`${nameByUid.get(t.assigned_to)?.name ?? ''} ${t.title}`).includes(q))
      .sort((a, b) => a.task_date.localeCompare(b.task_date) || (a.due_time ?? '').localeCompare(b.due_time ?? ''))
  }, [openTasks, nameByUid, query])

  const completed = useMemo(() => {
    const q = norm(query)
    return (completedTasks as DelTask[])
      .filter((t) => !q || norm(`${nameByUid.get(t.assigned_to)?.name ?? ''} ${t.title}`).includes(q))
  }, [completedTasks, nameByUid, query])

  const { mutate: doResend, isPending } = useMutation({
    mutationFn: (taskId: string) => resendTaskFollowup(taskId),
    onSuccess: (r) => { toast.success(r.overdue ? 'Strict reminder bhej diya ⚠️' : 'Follow-up bhej diya 🔔'); qc.invalidateQueries({ queryKey: ['del_followups'] }) },
    onError: (err: Error) => toast.error(err.message),
    onSettled: () => setResendId(null),
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['del_all_open_tasks'] })
    qc.invalidateQueries({ queryKey: ['del_completed_tasks'] })
  }

  function FollowupCell({ task, slot, dl }: { task: DelTask; slot: number; dl: DeadlineInfo }) {
    const logs = fuByTask.get(task.id) ?? []
    const count = logs.length
    if (slot <= count) {
      const log = logs[slot - 1]
      return (
        <span title={`${log.kind === 'followup_overdue' ? 'Strict' : 'Gentle'} · ${fmtDay(log.logged_at)}`}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
          <Check size={12} /> {fmtDay(log.logged_at)}
        </span>
      )
    }
    if (slot === count + 1) {
      const busy = isPending && resendId === task.id
      return (
        <Button
          size="sm" variant="outline" disabled={busy}
          onClick={() => { setResendId(task.id); doResend(task.id) }}
          className={`h-7 px-2 text-[11px] ${dl.tone === 'overdue' ? 'border-red-200 text-red-600 hover:bg-red-50' : 'border-amber-200 text-amber-800 hover:bg-amber-50'}`}
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : <><Send size={11} className="mr-1" /> Remind</>}
        </Button>
      )
    }
    return <span className="text-stone-300 text-xs">–</span>
  }

  const th = 'text-left text-[10px] font-semibold text-stone-500 uppercase tracking-wider px-2.5 py-1.5 border-b border-stone-200 bg-stone-100 whitespace-nowrap sticky top-0 z-10'
  const td = 'px-2.5 py-1.5 border-b border-stone-100 align-top'

  return (
    <>
      <div className="bg-white/70 backdrop-blur-sm rounded-2xl border border-amber-100 overflow-hidden" style={{ boxShadow: '0 4px 20px rgba(146,64,14,0.08)' }}>
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-amber-100/80">
          <h2 className="text-sm font-semibold text-stone-800">Team — Delegation</h2>
          <Button size="sm" onClick={() => setCreateOpen(true)} className="text-xs h-9 bg-amber-700 hover:bg-amber-800 text-white">
            <Plus size={13} className="mr-1" /> Naya Kaam
          </Button>
        </div>

        {/* Tabs + search */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-5 pt-3">
          <div className="flex items-center gap-1 bg-stone-100 rounded-lg p-1 shrink-0">
            <button
              onClick={() => setTab('ongoing')}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${tab === 'ongoing' ? 'bg-white text-amber-800 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}
            >
              <ListTodo size={13} /> Chal Rahe ({ongoing.length})
            </button>
            <button
              onClick={() => setTab('completed')}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${tab === 'completed' ? 'bg-white text-emerald-700 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}
            >
              <CheckCircle2 size={13} /> Poore Hue ({completed.length})
            </button>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-stone-200 px-3 h-10 bg-white flex-1">
            <Search size={15} className="text-stone-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Naam ya kaam dhundein…"
              className="w-full text-sm outline-none placeholder:text-stone-400"
            />
          </div>
        </div>

        {/* Table */}
        <div className="p-3">
          <div className="overflow-auto max-h-[58vh] rounded-xl border border-stone-100">
            {tab === 'ongoing' ? (
              <table className="w-full text-sm border-collapse min-w-[560px]">
                <thead>
                  <tr>
                    <th className={th}>Naam</th>
                    <th className={th}>Kaam</th>
                    <th className={th}>Deadline</th>
                    <th className={`${th} text-center`}>Follow-up 1</th>
                    <th className={`${th} text-center`}>Follow-up 2</th>
                    <th className={`${th} text-center`}>Follow-up 3</th>
                  </tr>
                </thead>
                <tbody>
                  {ongoing.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-stone-400">Koi chal raha kaam nahi 🎉</td></tr>
                  ) : ongoing.map((t) => {
                    const dl = deadlineInfo(t)
                    const person = nameByUid.get(t.assigned_to)
                    const urg = urgencyFromPoints(t.custom_points)
                    return (
                      <tr key={t.id} className={dl.tone === 'overdue' ? 'bg-red-50/40' : 'hover:bg-amber-50/30'}>
                        <td className={td}>
                          <div className="font-medium text-stone-800 whitespace-nowrap">{person?.name ?? '—'}</div>
                          <div className="text-[10px] text-stone-400">{ROLE_SHORT_LABELS[(person?.role ?? '') as RoleId] ?? person?.role}</div>
                        </td>
                        <td className={td}>
                          <div className="text-stone-800">{t.title}</div>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            {urg && <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${urg.badge}`}>{urg.label}</span>}
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${STATUS_PILL[t.status] ?? 'bg-stone-100 text-stone-500 border-stone-200'}`}>{t.status.replace(/_/g, ' ')}</span>
                            {t.on_behalf_of && <span className="text-[10px] text-stone-400">by {t.on_behalf_of}</span>}
                          </div>
                        </td>
                        <td className={`${td} whitespace-nowrap`}>
                          <span className={`text-xs ${TONE_COLOR[dl.tone]}`}>⏰ {dl.label}</span>
                          {dl.sub && <span className="block text-[10px] text-red-500 font-medium">{dl.sub}</span>}
                        </td>
                        <td className={`${td} text-center`}><FollowupCell task={t} slot={1} dl={dl} /></td>
                        <td className={`${td} text-center`}><FollowupCell task={t} slot={2} dl={dl} /></td>
                        <td className={`${td} text-center`}><FollowupCell task={t} slot={3} dl={dl} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-sm border-collapse min-w-[560px]">
                <thead>
                  <tr>
                    <th className={th}>Naam</th>
                    <th className={th}>Kaam</th>
                    <th className={th}>Deadline</th>
                    <th className={th}>Poora Hua</th>
                    <th className={`${th} text-center`}>Points</th>
                    <th className={th}>Submission</th>
                  </tr>
                </thead>
                <tbody>
                  {completed.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-stone-400">Abhi koi kaam poora nahi hua</td></tr>
                  ) : completed.map((t) => {
                    const person = nameByUid.get(t.assigned_to)
                    const pts = t.del_points?.find((p) => p.status === 'verified')?.points ?? t.del_points?.[0]?.points ?? 0
                    const sub = t.del_submissions?.[0]
                    const atts = sub?.attachments ?? []
                    return (
                      <tr key={t.id} className="hover:bg-emerald-50/30">
                        <td className={td}><div className="font-medium text-stone-800 whitespace-nowrap">{person?.name ?? '—'}</div><div className="text-[10px] text-stone-400">{ROLE_SHORT_LABELS[(person?.role ?? '') as RoleId] ?? person?.role}</div></td>
                        <td className={td}><span className="text-stone-800">{t.title}</span></td>
                        <td className={`${td} whitespace-nowrap text-stone-500 text-xs`}>{fmtDay(t.task_date)}</td>
                        <td className={`${td} whitespace-nowrap text-emerald-700 text-xs font-medium`}>✓ {fmtDay(t.verified_at ?? t.updated_at)}</td>
                        <td className={`${td} text-center whitespace-nowrap`}><span className="text-xs font-semibold text-amber-800">🏆 {pts}</span></td>
                        <td className={td}>
                          <div className="flex flex-col gap-1">
                            {atts.length > 0 ? atts.map((a, i) => (
                              <a key={i} href={a.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-sky-700 hover:underline max-w-[180px] truncate">
                                <Paperclip size={11} className="shrink-0" /> <span className="truncate">{a.name}</span>
                              </a>
                            )) : null}
                            {sub?.raw_text && (
                              <span title={sub.raw_text} className="inline-flex items-center gap-1 text-[11px] text-stone-500 max-w-[180px] truncate">
                                <FileText size={11} className="shrink-0" /> <span className="truncate">{sub.raw_text}</span>
                              </span>
                            )}
                            {atts.length === 0 && !sub?.raw_text && <span className="text-stone-300 text-xs">—</span>}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Naya Kaam sheet — rendered OUTSIDE the card so the fixed overlay covers the whole window */}
      <AnimatePresence>
        {createOpen && employee && (
          <DelegationSheet
            employee={employee}
            teamMembers={employees as Employee[]}
            onClose={() => setCreateOpen(false)}
            onCreated={invalidate}
          />
        )}
      </AnimatePresence>
    </>
  )
}
