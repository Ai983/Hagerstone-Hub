import { useState, useMemo } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { AnimatePresence } from 'framer-motion'
import { Search, Plus, ChevronDown, Send, Loader2, Trophy } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../hooks/useAuth'
import {
  fetchAllActiveEmployees,
  fetchAllTaskTypes,
  fetchAllOpenTasks,
  resendTaskFollowup,
} from '../../lib/delegation'
import { useDelegationScores } from '../../lib/delegation-scores'
import { AssignTaskDialog } from './AssignTaskDialog'
import { ROLE_SHORT_LABELS } from '../../config/roles'
import type { Employee, RoleId } from '../../types'
import type { DelTask, DelTaskType } from '../../types/delegation'
import { Button } from '../ui/button'

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

const STATUS_PILL: Record<string, string> = {
  assigned:     'bg-stone-100 text-stone-600 border-stone-200',
  in_progress:  'bg-sky-100 text-sky-700 border-sky-200',
  submitted:    'bg-amber-100 text-amber-700 border-amber-200',
  under_review: 'bg-violet-100 text-violet-700 border-violet-200',
}

function deadlineInfo(task: DelTask): { label: string; tone: 'overdue' | 'today' | 'soon' | 'ok' } {
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
  const d1 = new Date(todayStr + 'T00:00:00Z').getTime()
  const d2 = new Date(task.task_date + 'T00:00:00Z').getTime()
  const diff = Math.round((d2 - d1) / 86400000)
  const t = task.due_time ? ' ' + String(task.due_time).slice(0, 5) : ''
  if (diff < 0)  return { label: `${Math.abs(diff)} din overdue`, tone: 'overdue' }
  if (diff === 0) return { label: `Aaj${t}`, tone: 'today' }
  if (diff === 1) return { label: `Kal${t}`, tone: 'soon' }
  return { label: `${diff} din baaki`, tone: 'ok' }
}

const TONE_COLOR: Record<string, string> = {
  overdue: 'text-red-600',
  today:   'text-amber-700',
  soon:    'text-amber-600',
  ok:      'text-stone-400',
}

export function EmployeeDelegationBoard() {
  const { employee } = useAuth()
  const qc = useQueryClient()
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const { data: employees = [] } = useQuery({ queryKey: ['del_all_employees'], queryFn: fetchAllActiveEmployees })
  const { data: openTasks = [] } = useQuery({ queryKey: ['del_all_open_tasks'], queryFn: fetchAllOpenTasks })
  const { data: taskTypes = [] } = useQuery({ queryKey: ['del_task_types', 'all'], queryFn: fetchAllTaskTypes })
  const { data: scores = [] } = useDelegationScores('all')

  const typeLabel = useMemo(() => {
    const m = new Map<string, string>()
    ;(taskTypes as DelTaskType[]).forEach((t) => m.set(t.code, t.label))
    return m
  }, [taskTypes])

  const pointsByUser = useMemo(() => {
    const m = new Map<string, number>()
    scores.forEach((s) => m.set(s.user_id, s.total))
    return m
  }, [scores])

  const tasksByUser = useMemo(() => {
    const m = new Map<string, DelTask[]>()
    ;(openTasks as DelTask[]).forEach((t) => {
      const arr = m.get(t.assigned_to) ?? []
      arr.push(t)
      m.set(t.assigned_to, arr)
    })
    return m
  }, [openTasks])

  const ranked = useMemo(() => {
    const list = (employees as Employee[])
      .filter((e) => e.role !== 'founder' && e.role !== 'admin')
      .map((e) => {
        const uid = e.auth_user_id ?? ''
        const tasks = tasksByUser.get(uid) ?? []
        return { e, uid, tasks, openCount: tasks.length, points: pointsByUser.get(uid) ?? 0 }
      })
    const q = norm(query)
    const filtered = q ? list.filter((r) => norm(`${r.e.name} ${r.e.role}`).includes(q)) : list
    // Priority: most open tasks first, then most points, then name
    return filtered.sort((a, b) =>
      (b.openCount - a.openCount) || (b.points - a.points) || a.e.name.localeCompare(b.e.name),
    )
  }, [employees, tasksByUser, pointsByUser, query])

  const { mutate: doResend, isPending } = useMutation({
    mutationFn: (taskId: string) => resendTaskFollowup(taskId),
    onSuccess: (r) => toast.success(r.overdue ? 'Strict reminder bhej diya ⚠️' : 'Follow-up bhej diya 🔔'),
    onError: (err: Error) => toast.error(err.message),
  })
  const [resendId, setResendId] = useState<string | null>(null)

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['del_all_open_tasks'] })
    qc.invalidateQueries({ queryKey: ['del_scores'] })
  }

  return (
    <>
      <div className="bg-white/70 backdrop-blur-sm rounded-2xl border border-amber-100 overflow-hidden" style={{ boxShadow: '0 4px 20px rgba(146,64,14,0.08)' }}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-amber-100/80">
        <h2 className="text-sm font-semibold text-stone-800">Team — Delegation</h2>
        <Button
          size="sm"
          onClick={() => setCreateOpen(true)}
          className="text-xs h-9 bg-amber-700 hover:bg-amber-800 text-white"
        >
          <Plus size={13} className="mr-1" /> Naya Kaam
        </Button>
      </div>

      {/* Search */}
      <div className="px-5 pt-3">
        <div className="flex items-center gap-2 rounded-lg border border-stone-200 px-3 h-10 bg-white">
          <Search size={15} className="text-stone-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Employee dhundein (naam)…"
            className="w-full text-sm outline-none placeholder:text-stone-400"
          />
        </div>
      </div>

      {/* Employee list */}
      <div className="p-3 space-y-2 max-h-[60vh] overflow-y-auto">
        {ranked.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-stone-400">Koi employee nahi mila</div>
        ) : ranked.map(({ e, uid, tasks, openCount, points }) => {
          const isOpen = expanded === uid
          return (
            <div key={uid || e.id} className="rounded-xl border border-stone-100 bg-white overflow-hidden">
              <button
                onClick={() => setExpanded(isOpen ? null : uid)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-amber-50/50 text-left"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-stone-800 truncate">{e.name}</div>
                  <div className="text-xs text-stone-400">{ROLE_SHORT_LABELS[e.role as RoleId] ?? e.role}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {openCount > 0 && (
                    <span className="text-[11px] font-semibold text-amber-800 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-full">
                      {openCount} task{openCount > 1 ? 's' : ''}
                    </span>
                  )}
                  <span className="text-[11px] text-stone-500 flex items-center gap-1">
                    <Trophy size={11} className="text-amber-500" /> {points}
                  </span>
                  <ChevronDown size={15} className={`text-stone-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-stone-100 divide-y divide-stone-50">
                  {tasks.length === 0 ? (
                    <div className="px-4 py-3 text-xs text-stone-400">Koi active task nahi.</div>
                  ) : tasks.map((t) => {
                    const dl = deadlineInfo(t)
                    const isCustom = t.custom_points != null
                    return (
                      <div key={t.id} className="px-4 py-3 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm text-stone-800">{t.title}</div>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            <span className="text-[10px] text-stone-400">
                              {isCustom ? 'Other' : (typeLabel.get(t.type_code ?? '') ?? t.type_code ?? '—')}
                            </span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${STATUS_PILL[t.status] ?? 'bg-stone-100 text-stone-500 border-stone-200'}`}>
                              {t.status.replace(/_/g, ' ')}
                            </span>
                            <span className={`text-[10px] font-medium ${TONE_COLOR[dl.tone]}`}>⏰ {dl.label}</span>
                            {t.on_behalf_of && <span className="text-[10px] text-stone-400">· {t.on_behalf_of}</span>}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isPending && resendId === t.id}
                          onClick={() => { setResendId(t.id); doResend(t.id) }}
                          className={`text-xs h-8 shrink-0 ${dl.tone === 'overdue' ? 'border-red-200 text-red-600 hover:bg-red-50' : 'border-amber-200 text-amber-800 hover:bg-amber-50'}`}
                        >
                          {isPending && resendId === t.id
                            ? <Loader2 size={12} className="animate-spin" />
                            : <><Send size={12} className="mr-1" /> {dl.tone === 'overdue' ? 'Remind!' : 'Resend'}</>}
                        </Button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      </div>

      {/* Naya Kaam modal — rendered OUTSIDE the blurred/overflow card so the
          fixed overlay covers the whole window (like the Mera Din page). */}
      <AnimatePresence>
        {createOpen && employee && (
          <AssignTaskDialog
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
