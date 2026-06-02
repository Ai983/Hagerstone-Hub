import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, Plus, X, CheckCircle2, Clock, AlertCircle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../hooks/useAuth'
import {
  fetchMyTasks,
  fetchTaskTypes,
  fetchTeamMembers,
  fetchAllActiveEmployees,
  createTask,
  moveToInProgress,
  submitTask,
} from '../../lib/delegation'
import type { DelTask, DelTaskType, DelTaskStatus } from '../../types/delegation'
import type { Employee } from '../../types'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'

// Roles that have seeded task types in this launch
const LAUNCH_ROLES = ['site_engineer', 'procurement', 'finance', 'mis']

// ── Helpers ───────────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function fmtDate(s: string) {
  return new Date(s + 'T00:00:00').toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short',
  })
}

function pointBadge(task: DelTask) {
  const pt = task.del_points?.[0]
  if (!pt) return null
  const color =
    pt.status === 'verified'  ? 'text-emerald-700 bg-emerald-50 border-emerald-200' :
    pt.status === 'rejected'  ? 'text-red-500 bg-red-50 border-red-200 line-through' :
    'text-stone-400 bg-stone-50 border-stone-200'
  const label =
    pt.status === 'verified' ? `+${pt.points} pts ✓` :
    pt.status === 'rejected' ? `0 pts ✗` :
    `+${pt.points} pts (pending)`
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${color}`}>
      {label}
    </span>
  )
}

// ── Column config ─────────────────────────────────────────────────────────────

const COLUMNS: { status: DelTaskStatus; label: string; accent: string; border: string }[] = [
  { status: 'assigned',   label: 'Assigned',   accent: 'bg-amber-50',   border: 'border-amber-200' },
  { status: 'in_progress', label: 'In Progress', accent: 'bg-sky-50',  border: 'border-sky-200'  },
  { status: 'submitted',  label: 'Submitted',  accent: 'bg-violet-50', border: 'border-violet-200' },
  { status: 'verified',   label: 'Done',        accent: 'bg-stone-50', border: 'border-stone-200' },
]

// ── Task card ─────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  taskTypes,
  onInProgress,
  onSubmit,
  actionLoading,
}: {
  task: DelTask
  taskTypes: DelTaskType[]
  onInProgress: (id: string) => void
  onSubmit: (id: string) => void
  actionLoading: string | null
}) {
  const typeLabel = taskTypes.find((t) => t.code === task.type_code)?.label ?? task.type_code ?? '—'
  const loading = actionLoading === task.id

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="bg-white rounded-xl border border-stone-100 p-3 shadow-sm space-y-2"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-stone-800 leading-snug">{task.title}</p>
        <span className="text-xs text-stone-400 whitespace-nowrap">{fmtDate(task.task_date)}</span>
      </div>

      {task.description && (
        <p className="text-xs text-stone-500 leading-relaxed line-clamp-2">{task.description}</p>
      )}

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs text-stone-400 bg-stone-50 border border-stone-100 px-2 py-0.5 rounded-full">
          {typeLabel}
        </span>
        {pointBadge(task)}
      </div>

      {task.status === 'rejected' && task.reject_reason && (
        <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-2 py-1">
          Rejected: {task.reject_reason}
        </p>
      )}

      <div className="flex gap-1.5 pt-1">
        {task.status === 'assigned' && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs border-sky-200 text-sky-700 hover:bg-sky-50"
              disabled={loading}
              onClick={() => onInProgress(task.id)}
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : 'In Progress'}
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs bg-amber-700 hover:bg-amber-800 text-white"
              disabled={loading}
              onClick={() => onSubmit(task.id)}
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : 'Submit'}
            </Button>
          </>
        )}
        {task.status === 'in_progress' && (
          <Button
            size="sm"
            className="h-7 text-xs bg-amber-700 hover:bg-amber-800 text-white"
            disabled={loading}
            onClick={() => onSubmit(task.id)}
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : 'Submit EOD'}
          </Button>
        )}
        {task.status === 'submitted' && (
          <span className="text-xs text-violet-600 flex items-center gap-1">
            <Clock size={12} /> Awaiting Head verification
          </span>
        )}
        {task.status === 'verified' && (
          <span className="text-xs text-emerald-600 flex items-center gap-1">
            <CheckCircle2 size={12} /> Verified
          </span>
        )}
        {task.status === 'rejected' && (
          <span className="text-xs text-red-500 flex items-center gap-1">
            <AlertCircle size={12} /> Rejected
          </span>
        )}
      </div>
    </motion.div>
  )
}

// ── Create task form ──────────────────────────────────────────────────────────

interface CreateFormProps {
  employee: Employee
  taskTypes: DelTaskType[]
  teamMembers: Employee[]
  onClose: () => void
  onCreated: () => void
}

function CreateTaskForm({ employee, taskTypes, teamMembers, onClose, onCreated }: CreateFormProps) {
  const isHead    = employee.is_head
  const isGlobal  = employee.role === 'founder' || employee.role === 'admin'
  const canAssign = isHead || isGlobal

  const [title, setTitle]           = useState('')
  const [description, setDesc]      = useState('')
  const [typeCode, setTypeCode]     = useState(taskTypes[0]?.code ?? '')
  const [taskDate, setTaskDate]     = useState(today())
  const [assignedTo, setAssignedTo] = useState(employee.auth_user_id ?? '')
  const [saving, setSaving]         = useState(false)

  const selfEntry = { auth_user_id: employee.auth_user_id ?? '', name: `${employee.name} (me)` }
  const assignees: { auth_user_id: string; name: string }[] = canAssign
    ? [selfEntry, ...teamMembers.filter((m) => m.auth_user_id !== employee.auth_user_id).map((m) => ({ auth_user_id: m.auth_user_id ?? '', name: m.name }))]
    : [selfEntry]

  // For founder/admin picking someone from a different role_group, the role_group
  // should follow the assignee. We resolve it from teamMembers or fall back to employee.role.
  const resolvedRoleGroup =
    teamMembers.find((m) => m.auth_user_id === assignedTo)?.role ?? employee.role

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    try {
      await createTask({
        title,
        description,
        type_code:   typeCode,
        task_date:   taskDate,
        role_group:  resolvedRoleGroup,
        assigned_to: assignedTo,
        assigned_by: employee.auth_user_id ?? '',
      })
      toast.success('Task created')
      onCreated()
      onClose()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to create task')
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl shadow-xl border border-stone-100 w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-stone-800">New Task</h2>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label className="text-xs text-stone-600 mb-1 block">Title *</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              required
              className="text-sm"
            />
          </div>

          <div>
            <Label className="text-xs text-stone-600 mb-1 block">Description</Label>
            <textarea
              value={description}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Optional details…"
              rows={2}
              className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-stone-600 mb-1 block">Task type</Label>
              <select
                value={typeCode}
                onChange={(e) => setTypeCode(e.target.value)}
                className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {taskTypes.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.label} ({t.effort_tier})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label className="text-xs text-stone-600 mb-1 block">For date</Label>
              <Input
                type="date"
                value={taskDate}
                onChange={(e) => setTaskDate(e.target.value)}
                className="text-sm"
              />
            </div>
          </div>

          {canAssign && (
            <div>
              <Label className="text-xs text-stone-600 mb-1 block">Assign to</Label>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {assignees.map((a) => (
                  <option key={a.auth_user_id} value={a.auth_user_id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1 text-sm">
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving || !title.trim()}
              className="flex-1 text-sm bg-amber-700 hover:bg-amber-800 text-white"
            >
              {saving ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
              Create Task
            </Button>
          </div>
        </form>
      </div>
    </motion.div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function MyDayPage() {
  const { employee } = useAuth()
  const navigate     = useNavigate()
  const qc           = useQueryClient()

  const [createOpen, setCreateOpen]   = useState(false)
  const [actionLoading, setActLoad]   = useState<string | null>(null)

  const authUserId  = employee?.auth_user_id ?? ''
  const roleGroup   = employee?.role ?? ''
  const isHead      = employee?.is_head ?? false
  const isGlobal    = roleGroup === 'founder' || roleGroup === 'admin'

  const tasksKey     = ['del_tasks', authUserId]
  const typesKey     = ['del_task_types', roleGroup]
  const membersKey   = ['del_team', roleGroup]

  const { data: tasks = [], isLoading: tasksLoading } = useQuery({
    queryKey: tasksKey,
    queryFn:  () => fetchMyTasks(authUserId),
    enabled:  !!authUserId,
  })

  const { data: taskTypes = [] } = useQuery({
    queryKey: typesKey,
    queryFn:  () => fetchTaskTypes(roleGroup),
    enabled:  !!roleGroup,
  })

  const { data: teamMembers = [] } = useQuery({
    queryKey: membersKey,
    queryFn:  () => isGlobal ? fetchAllActiveEmployees() : fetchTeamMembers(roleGroup),
    enabled:  (isHead || isGlobal) && !!roleGroup,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: tasksKey })

  const { mutate: doInProgress } = useMutation({
    mutationFn: (id: string) => {
      setActLoad(id)
      return moveToInProgress(id)
    },
    onSuccess: () => { invalidate(); setActLoad(null) },
    onError:   (err: Error) => { toast.error(err.message); setActLoad(null) },
  })

  const { mutate: doSubmit } = useMutation({
    mutationFn: (id: string) => {
      setActLoad(id)
      return submitTask(id)
    },
    onSuccess: (result) => {
      invalidate()
      setActLoad(null)
      toast.success(result.points > 0
        ? `Submitted! ${result.points} pts pending verification.`
        : 'Submitted. No points this time — check the reason.')
    },
    onError: (err: Error) => { toast.error(err.message); setActLoad(null) },
  })

  // Split tasks by status (merge verified + rejected into "done" column)
  function tasksFor(status: DelTaskStatus | 'done') {
    if (status === 'done') return tasks.filter((t) => t.status === 'verified' || t.status === 'rejected')
    return tasks.filter((t) => t.status === status)
  }

  const hasRole = LAUNCH_ROLES.includes(roleGroup) || isGlobal

  if (!employee) return null

  return (
    <div
      className="min-h-screen"
      style={{ background: 'radial-gradient(ellipse at 20% 0%, #fef9ec 0%, #fffbf0 40%, #fef3c7 100%)' }}
    >
      {/* dot pattern */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{ backgroundImage: 'radial-gradient(circle, rgba(180,120,30,0.06) 1px, transparent 1px)', backgroundSize: '28px 28px' }}
      />

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
            <button
              onClick={() => navigate('/dashboard')}
              className="text-stone-400 hover:text-stone-600 transition-colors"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <div className="font-semibold text-stone-800 text-sm">Mera Din</div>
              <div className="text-xs text-stone-400">{employee.name} · {employee.role}</div>
            </div>
          </div>
          {hasRole && (
            <Button
              size="sm"
              onClick={() => setCreateOpen(true)}
              className="text-xs bg-amber-700 hover:bg-amber-800 text-white"
            >
              <Plus size={13} className="mr-1" />
              New Task
            </Button>
          )}
        </div>
      </motion.header>

      <main className="relative z-10 max-w-6xl mx-auto px-4 py-8">
        {!hasRole ? (
          <div className="text-center py-20 text-stone-400 text-sm">
            Delegation is not enabled for your role yet.
          </div>
        ) : tasksLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {COLUMNS.map((col) => (
              <div key={col.status} className="space-y-2">
                <div className="h-5 w-24 bg-stone-100 rounded animate-pulse" />
                <div className="h-24 bg-white/60 rounded-xl border border-stone-100 animate-pulse" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {COLUMNS.map((col, i) => {
              const colTasks = tasksFor(col.status === 'verified' ? 'done' : col.status as DelTaskStatus)
              return (
                <motion.div
                  key={col.status}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className={`rounded-xl ${col.accent} border ${col.border} p-3 space-y-2 min-h-[120px]`}>
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-xs font-semibold text-stone-600 uppercase tracking-wide">
                        {col.label}
                      </h3>
                      <span className="text-xs text-stone-400 bg-white/60 border border-stone-100 px-1.5 py-0.5 rounded-full">
                        {colTasks.length}
                      </span>
                    </div>
                    <AnimatePresence>
                      {colTasks.length === 0 ? (
                        <p className="text-xs text-stone-400 text-center py-4">Nothing here</p>
                      ) : (
                        colTasks.map((task) => (
                          <TaskCard
                            key={task.id}
                            task={task}
                            taskTypes={taskTypes}
                            onInProgress={(id) => doInProgress(id)}
                            onSubmit={(id) => doSubmit(id)}
                            actionLoading={actionLoading}
                          />
                        ))
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}

        {tasks.length === 0 && hasRole && !tasksLoading && (
          <p className="text-center text-stone-400 text-sm mt-6">
            No tasks yet — create one with the button above.
          </p>
        )}
      </main>

      {/* Create modal */}
      <AnimatePresence>
        {createOpen && (
          <CreateTaskForm
            employee={employee}
            taskTypes={taskTypes}
            teamMembers={teamMembers}
            onClose={() => setCreateOpen(false)}
            onCreated={invalidate}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
