import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft, Plus, X, Loader2,
  Paperclip, Send, ChevronRight, Clock,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../hooks/useAuth'
import {
  fetchMyTasks,
  fetchAllTaskTypes,
  fetchTeamMembers,
  fetchAllActiveEmployees,
  fetchActiveProjects,
  createTask,
  createTaskType,
  moveToInProgress,
  submitTask,
  uploadAttachment,
  cancelTask,
} from '../../lib/delegation'
import type { DelTask, DelTaskType, DelTaskStatus } from '../../types/delegation'
import type { Employee } from '../../types'
import { PointEntryCard } from '../../components/delegation/PointEntryCard'
import { LABELS, STAGE_EMPTY, type PillStatus } from '../../lib/delegation-ui'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { SearchableSelect, type SearchOption } from '../../components/ui/SearchableSelect'
import { DELEGATION_ROLES, ROLE_SHORT_LABELS } from '../../config/roles'
import { usePointsConfig, tierPointsFrom } from '../../lib/work-scores'

// All roles can access delegation — the task type dropdown controls what tasks are available
const LAUNCH_ROLES = DELEGATION_ROLES

const ALLOWED_TYPES = [
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'image/jpeg',
  'image/jpg',
  'image/png',
]
const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20 MB

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function fmtDate(s: string) {
  return new Date(s + 'T00:00:00').toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short',
  })
}

// ── Column config (4 visible: To Do | Doing | Sent for Review | Done) ─────────

interface ColConfig {
  key: string
  label: string
  sub: string
  accent: string
  border: string
  statuses: DelTaskStatus[]
}

const COLUMNS: ColConfig[] = [
  {
    key: 'todo',
    label: '🆕 Naya Kaam',
    sub: STAGE_EMPTY.assigned,
    accent: 'bg-amber-50',
    border: 'border-amber-200',
    statuses: ['assigned'],
  },
  {
    key: 'doing',
    label: '⏳ Chal Raha Hai',
    sub: STAGE_EMPTY.in_progress,
    accent: 'bg-sky-50',
    border: 'border-sky-200',
    statuses: ['in_progress'],
  },
  {
    key: 'review',
    label: '👀 Review Mein',
    sub: STAGE_EMPTY.review,
    accent: 'bg-violet-50',
    border: 'border-violet-200',
    statuses: ['submitted', 'under_review'],
  },
  {
    key: 'done',
    label: '✅ Ho Gaya',
    sub: STAGE_EMPTY.done,
    accent: 'bg-stone-50',
    border: 'border-stone-200',
    statuses: ['completed', 'verified', 'rejected', 'cancelled'],
  },
]

// ── Submit modal ──────────────────────────────────────────────────────────────

interface SubmitModalProps {
  task: DelTask
  onClose: () => void
  onSubmitted: () => void
}

function SubmitModal({ task, onClose, onSubmitted }: SubmitModalProps) {
  const [text, setText]             = useState('')
  const [files, setFiles]           = useState<File[]>([])
  const [uploading, setUploading]   = useState(false)
  const [saving, setSaving]         = useState(false)
  const fileRef                     = useRef<HTMLInputElement>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    const valid  = picked.filter((f) => {
      if (!ALLOWED_TYPES.includes(f.type)) {
        toast.error(`${f.name}: type not allowed (PDF, Excel, PPT, JPG, PNG only)`)
        return false
      }
      if (f.size > MAX_FILE_SIZE) {
        toast.error(`${f.name}: max 20 MB`)
        return false
      }
      return true
    })
    setFiles((prev) => [...prev, ...valid])
    e.target.value = ''
  }

  function removeFile(i: number) {
    setFiles((prev) => prev.filter((_, idx) => idx !== i))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim()) return

    setSaving(true)
    setUploading(files.length > 0)

    try {
      // Upload attachments first. Use allSettled so one bad file can't block
      // the whole submission — upload what we can, warn about the rest.
      const results = await Promise.allSettled(
        files.map((f) => uploadAttachment(task.id, f)),
      )
      setUploading(false)

      const uploadedAttachments = results
        .filter((r) => r.status === 'fulfilled')
        .map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof uploadAttachment>>>).value)

      const failedFiles = files
        .filter((_, i) => results[i].status === 'rejected')
        .map((f) => f.name)

      // Only abort if there were files and every single one failed.
      if (files.length > 0 && uploadedAttachments.length === 0) {
        toast.error(
          `Koi bhi file upload nahi hui — submit nahi hua. Pehli file: ${
            (results[0] as PromiseRejectedResult).reason?.message ?? 'unknown error'
          }`,
        )
        return
      }

      await submitTask({
        task_id: task.id,
        text: text.trim(),
        attachments: uploadedAttachments,
      })

      if (failedFiles.length > 0) {
        toast.success('Kaam submit ho gaya! AI scoring chal raha hai…')
        toast.error(
          `${failedFiles.length} file(s) upload nahi hui: ${failedFiles.join(', ')}. Baaki sab submit ho gayi.`,
        )
      } else {
        toast.success('Kaam submit ho gaya! AI scoring chal raha hai…')
      }
      onSubmitted()
      onClose()
    } catch (err: unknown) {
      setUploading(false)
      toast.error(err instanceof Error ? err.message : 'Submit failed')
    } finally {
      setSaving(false)
    }
  }

  const busy = saving || uploading

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 280 }}
        className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-stone-100 w-full sm:max-w-lg flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-3 shrink-0">
          <div className="flex-1 min-w-0 pr-3">
            <p className="text-xs text-stone-400 mb-0.5">Kaam kya kiya?</p>
            <p className="font-semibold text-stone-800 text-sm leading-snug line-clamp-2">{task.title}</p>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="shrink-0 text-stone-400 hover:text-stone-600 p-1 -mr-1 mt-0.5 rounded-lg"
          >
            <X size={17} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 pb-5 space-y-3 overflow-y-auto">
          {/* Text area — primary input (STT deferred) */}
          <div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Aaj kya kiya likho — jitna detail ho sake utna likho…"
              rows={5}
              disabled={busy}
              className="w-full text-sm rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent resize-none min-h-[120px] transition-all"
              required
            />
            <p className="text-xs text-stone-400 mt-1">
              Jo kaam kiya uski details likho — AI isko padh ke score suggest karega
            </p>
          </div>

          {/* File attachments */}
          <div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="flex items-center gap-2 text-xs text-amber-700 border border-amber-200 bg-amber-50 hover:bg-amber-100 px-3 py-2 rounded-lg transition-colors font-medium min-h-[44px]"
            >
              <Paperclip size={14} />
              📎 Files Attach Karo (PDF, Excel, PPT, Image)
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".pdf,.xlsx,.xls,.pptx,.ppt,.png,.jpg,.jpeg"
              className="hidden"
              onChange={handleFileChange}
              disabled={busy}
            />

            {files.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 bg-stone-50 border border-stone-100 rounded-lg px-3 py-1.5">
                    <Paperclip size={12} className="text-stone-400 shrink-0" />
                    <span className="text-xs text-stone-700 flex-1 truncate">{f.name}</span>
                    <span className="text-xs text-stone-400 shrink-0">
                      {(f.size / 1024).toFixed(0)} KB
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      disabled={busy}
                      className="text-stone-300 hover:text-red-400"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={busy}
              className="flex-1 text-sm h-11"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy || !text.trim()}
              className="flex-1 text-sm h-11 bg-amber-700 hover:bg-amber-800 text-white font-medium"
            >
              {uploading ? (
                <><Loader2 size={14} className="animate-spin mr-2" /> Files upload…</>
              ) : saving ? (
                <><Loader2 size={14} className="animate-spin mr-2" /> Submit…</>
              ) : (
                <><Send size={14} className="mr-2" /> Submit Karo</>
              )}
            </Button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}

// ── Task card ─────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  taskTypes,
  isHead,
  onInProgress,
  onSubmit,
  onCancel,
  actionLoading,
}: {
  task: DelTask
  taskTypes: DelTaskType[]
  isHead: boolean
  onInProgress: (id: string) => void
  onSubmit: (task: DelTask) => void
  onCancel: (task: DelTask) => void
  actionLoading: string | null
}) {
  const typeLabel = taskTypes.find((t) => t.code === task.type_code)?.label ?? task.type_code ?? 'Kaam'
  const loading   = actionLoading === task.id
  const pt        = task.del_points?.[0]
  const isActionable = task.status === 'assigned' || task.status === 'in_progress'

  // Review / Done / Rejected / Cancelled → compact collapsible card (AI prose hidden)
  if (!isActionable) {
    const pill: PillStatus =
      task.status === 'submitted'    ? 'scoring'  :
      task.status === 'under_review' ? 'pending'  :
      (task.status === 'completed' || task.status === 'verified') ? 'verified' :
      task.status === 'rejected'     ? 'rejected' : 'reversed'

    const pts: number | null =
      task.status === 'submitted'    ? null :
      task.status === 'under_review' ? (pt?.proposed_points ?? pt?.points ?? 0) :
      (pt?.points ?? 0)

    const summary =
      task.status === 'rejected'  ? (task.reject_reason ? `↩ ${task.reject_reason}` : pt?.summary ?? undefined) :
      task.status === 'cancelled' ? (task.reject_reason ? `Cancel: ${task.reject_reason}` : undefined) :
      (pt?.summary ?? pt?.reason ?? undefined)

    return (
      <PointEntryCard
        points={pts}
        sourceLabel={`🏷️ ${typeLabel}`}
        taskTitle={task.title}
        status={pill}
        date={task.task_date}
        summary={summary}
      />
    )
  }

  // To-Do / Doing → action card with glossary buttons
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="bg-card rounded-xl border border-stone-200 p-3 shadow-sm space-y-2"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-stone-800 leading-snug">{task.title}</p>
        <span className="text-xs text-stone-400 whitespace-nowrap shrink-0">{fmtDate(task.task_date)}</span>
      </div>

      {task.description && (
        <p className="text-xs text-stone-500 leading-relaxed line-clamp-2">{task.description}</p>
      )}

      <span className="inline-block text-xs text-stone-400 bg-stone-50 border border-stone-100 px-2 py-0.5 rounded-full">
        🏷️ {typeLabel}
      </span>

      {/* Rejected-and-returned banner — director checked it and sent it back */}
      {task.reject_reason && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-2 leading-relaxed">
          ↩ <span className="font-semibold">{task.on_behalf_of ?? 'Reviewer'}</span> ne reject kiya: {task.reject_reason}
          <span className="block text-red-600 mt-0.5">Kripya theek karke firse submit karein.</span>
        </div>
      )}

      {/* Action buttons — min-h 44px, aligned full-width row */}
      <div className="flex gap-1.5 pt-1">
        {task.status === 'assigned' && (
          <Button
            size="sm"
            variant="outline"
            className="h-11 text-xs border-sky-200 text-sky-700 hover:bg-sky-50 flex-1"
            disabled={loading}
            onClick={() => onInProgress(task.id)}
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : LABELS.startTask}
          </Button>
        )}
        <Button
          size="sm"
          className="h-11 text-xs bg-amber-700 hover:bg-amber-800 text-white flex-1"
          disabled={loading}
          onClick={() => onSubmit(task)}
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <><Send size={12} className="mr-1" />{LABELS.submitWork}</>}
        </Button>
        {isHead && (
          <Button
            size="sm"
            variant="outline"
            className="h-11 w-11 shrink-0 text-stone-400 border-stone-200 hover:text-red-500 hover:border-red-200 hover:bg-red-50"
            disabled={loading}
            onClick={() => onCancel(task)}
            aria-label="Cancel task"
          >
            <X size={14} />
          </Button>
        )}
      </div>
    </motion.div>
  )
}

// ── Cancel confirm modal ──────────────────────────────────────────────────────

function CancelModal({
  task,
  onClose,
  onConfirm,
}: {
  task: DelTask
  onClose: () => void
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ scale: 0.97, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.97, opacity: 0 }}
        className="bg-white rounded-2xl shadow-xl border border-stone-100 w-full max-w-sm p-5 space-y-4"
      >
        <h3 className="font-semibold text-stone-800">Task Cancel Karo?</h3>
        <p className="text-sm text-stone-500 line-clamp-2">{task.title}</p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Cancel karne ki wajah (required)…"
          rows={2}
          className="w-full text-sm rounded-lg border border-stone-200 px-3 py-2 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-red-300 resize-none"
        />
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1 text-sm">Back</Button>
          <Button
            disabled={!reason.trim()}
            onClick={() => onConfirm(reason.trim())}
            className="flex-1 text-sm bg-red-600 hover:bg-red-700 text-white"
          >
            Cancel Karo
          </Button>
        </div>
      </motion.div>
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
  /** Optional pre-fill — used when dispatching a Command Center draft through this same form. */
  initial?: {
    title?: string
    assignedTo?: string
    projectId?: string
    onBehalfOf?: string
    taskDate?: string
    dueTime?: string
  }
}

const TIER_COLOR: Record<string, string> = {
  S:  'bg-sky-100 text-sky-700 border-sky-200',
  M:  'bg-violet-100 text-violet-700 border-violet-200',
  L:  'bg-amber-100 text-amber-700 border-amber-200',
  XL: 'bg-rose-100 text-rose-700 border-rose-200',
}
const DEPT_LABEL: Record<string, string> = ROLE_SHORT_LABELS

export function CreateTaskForm({ employee, taskTypes, teamMembers, onClose, onCreated, initial }: CreateFormProps) {
  const isHead    = employee.is_head
  const isGlobal  = employee.role === 'founder' || employee.role === 'admin' || employee.del_super === true
  const canAssign = isHead || isGlobal

  // Tier point hints — live from points_config (single source of truth).
  const { data: pointsCfg } = usePointsConfig()
  const TIER_PTS = tierPointsFrom(pointsCfg)

  const firstAssignableUid = (() => {
    if (!canAssign) return employee.auth_user_id ?? ''
    const first = teamMembers.find((m) =>
      m.auth_user_id !== employee.auth_user_id &&
      m.role !== 'founder' && m.role !== 'admin'
    )
    return first?.auth_user_id ?? employee.auth_user_id ?? ''
  })()

  const qc = useQueryClient()
  const [title, setTitle]               = useState(initial?.title ?? '')
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set())
  const [taskDate, setTaskDate]         = useState(initial?.taskDate || today())
  const [dueTime, setDueTime]           = useState(initial?.dueTime ?? '')
  const [assignedTo, setAssignedTo]     = useState(initial?.assignedTo || firstAssignableUid)
  const [projectId, setProjectId]       = useState(initial?.projectId ?? '')
  const [onBehalfOf, setOnBehalfOf]     = useState(initial?.onBehalfOf ?? '')
  const [saving, setSaving]             = useState(false)

  // Add-new-type panel
  const [addOpen, setAddOpen]           = useState(false)
  const [newLabel, setNewLabel]         = useState('')
  const [newCategory, setNewCategory]   = useState('')
  const [newTier, setNewTier]           = useState('S')
  const [adding, setAdding]             = useState(false)

  const selfUid = employee.auth_user_id ?? ''

  // Live, spelling-tolerant pickers
  const { data: projects = [] } = useQuery({ queryKey: ['del_projects_active'], queryFn: fetchActiveProjects })
  const projectOptions: SearchOption[] = projects.map((p) => ({ value: p.id, label: p.name, sublabel: p.code }))

  const employeeOptions: SearchOption[] = canAssign
    ? [
        { value: selfUid, label: `${employee.name} (Mujhe)` },
        ...teamMembers
          .filter((m) => m.role !== 'founder' && m.role !== 'admin')
          .map((m) => ({ value: m.auth_user_id ?? '', label: m.name, sublabel: (m.role ?? '').replace(/_/g, ' ') })),
      ]
    : [{ value: selfUid, label: `${employee.name} (Mujhe)` }]

  const DIRECTORS = ['Dhruv Sir', 'Bhaskar Sir']
  const assigningToOther = canAssign && assignedTo !== selfUid

  const resolvedRoleGroup =
    teamMembers.find((m) => m.auth_user_id === assignedTo)?.role ?? employee.role

  // Open picker: show ALL active task types, grouped by category (not role-filtered)
  const visibleTaskTypes = taskTypes
  const categories = Array.from(new Set(taskTypes.map((t) => t.role_group))).sort()

  // Group by category for display
  const grouped = visibleTaskTypes.reduce<Record<string, DelTaskType[]>>((acc, t) => {
    if (!acc[t.role_group]) acc[t.role_group] = []
    acc[t.role_group].push(t)
    return acc
  }, {})

  async function handleAddType() {
    if (!newLabel.trim() || !newCategory) return
    setAdding(true)
    try {
      const t = await createTaskType(newLabel.trim(), newCategory, newTier)
      await qc.invalidateQueries({ queryKey: ['del_task_types', 'all'] })
      setSelectedTypes((prev) => new Set(prev).add(t.code))
      setNewLabel(''); setAddOpen(false)
      toast.success('Naya type add ho gaya!')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Type add nahi hua')
    } finally {
      setAdding(false)
    }
  }

  function toggleType(code: string) {
    setSelectedTypes((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  const totalPts = Array.from(selectedTypes).reduce((sum, code) => {
    const t = visibleTaskTypes.find((x) => x.code === code)
    return sum + (TIER_PTS[t?.effort_tier ?? ''] ?? 0)
  }, 0)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (selectedTypes.size === 0 || !title.trim()) return
    if (assigningToOther && !onBehalfOf) return
    const codes = Array.from(selectedTypes)
    setSaving(true)
    try {
      // Create one task per selected type in parallel
      await Promise.all(
        codes.map((code) => {
          const t = visibleTaskTypes.find((x) => x.code === code)
          return createTask({
            title: codes.length === 1 ? title : `${title} — ${t?.label ?? code}`,
            description: '',
            type_code: code,
            task_date: taskDate,
            role_group: t?.role_group ?? resolvedRoleGroup,
            assigned_to: assignedTo,
            assigned_by: selfUid,
            project_id: projectId || null,
            on_behalf_of: assigningToOther ? onBehalfOf : null,
            due_time: dueTime || null,
          })
        })
      )
      toast.success(codes.length === 1
        ? 'Kaam create ho gaya!'
        : `${codes.length} kaam create ho gaye!`)
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
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && !saving && onClose()}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 280 }}
        className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl border border-stone-100 w-full sm:max-w-lg flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
          <div>
            <h2 className="font-semibold text-stone-800">Naya Kaam</h2>
            <p className="text-xs text-stone-400 mt-0.5">Ek ya zyada type select karo</p>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 p-1">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="px-5 space-y-4 overflow-y-auto flex-1 pb-2">

            {/* Title */}
            <div>
              <Label className="text-xs text-stone-500 mb-1.5 block font-medium">Kaam ka naam *</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Kya kiya / karna hai?"
                className="text-sm h-11"
              />
            </div>

            {/* Deadline date + time */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-stone-500 mb-1.5 block font-medium">Kab tak? (date)</Label>
                <Input
                  type="date"
                  value={taskDate}
                  onChange={(e) => setTaskDate(e.target.value)}
                  className="text-sm h-11"
                />
              </div>
              <div>
                <Label className="text-xs text-stone-500 mb-1.5 flex items-center gap-1 font-medium">
                  <Clock size={12} /> Time
                </Label>
                <Input
                  type="time"
                  value={dueTime}
                  onChange={(e) => setDueTime(e.target.value)}
                  className="text-sm h-11"
                />
              </div>
            </div>

            {/* Project (optional) — live from public.projects */}
            <div>
              <Label className="text-xs text-stone-500 mb-1.5 block font-medium">
                Project <span className="text-stone-400 font-normal">(optional)</span>
              </Label>
              <SearchableSelect
                options={projectOptions}
                value={projectId}
                onChange={setProjectId}
                placeholder="Project dhundein…"
                emptyText="Koi project nahi mila"
              />
            </div>

            {/* Assignee — searchable by name (role shown) */}
            {canAssign && (
              <div>
                <Label className="text-xs text-stone-500 mb-1.5 block font-medium">Kisko?</Label>
                <SearchableSelect
                  options={employeeOptions}
                  value={assignedTo}
                  onChange={setAssignedTo}
                  placeholder="Naam se dhundein…"
                  emptyText="Koi employee nahi mila"
                />
              </div>
            )}

            {/* Assigned by — director on whose behalf (only when assigning to someone else) */}
            {assigningToOther && (
              <div>
                <Label className="text-xs text-stone-500 mb-1.5 block font-medium">Assigned by</Label>
                <select
                  value={onBehalfOf}
                  onChange={(e) => setOnBehalfOf(e.target.value)}
                  className="w-full text-sm rounded-lg border border-input bg-background px-3 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 h-11"
                >
                  <option value="">Director chuniye…</option>
                  {DIRECTORS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            )}

            {/* Task type multi-select */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs text-stone-500 font-medium">
                  Kaam ka type
                  <span className="ml-1 text-stone-400 font-normal">(ek ya zyada chuniye)</span>
                </Label>
                {selectedTypes.size > 0 && (
                  <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                    {selectedTypes.size} selected · up to {totalPts} pts
                  </span>
                )}
              </div>

              {visibleTaskTypes.length === 0 ? (
                <p className="text-xs text-stone-400 italic py-3 text-center">
                  No task types seeded for your role yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {Object.entries(grouped).map(([dept, types]) => (
                    <div key={dept}>
                      {Object.keys(grouped).length > 1 && (
                        <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5">
                          {DEPT_LABEL[dept] ?? dept}
                        </p>
                      )}
                      <div className="grid grid-cols-1 gap-1.5">
                        {types.map((t) => {
                          const selected = selectedTypes.has(t.code)
                          return (
                            <button
                              key={t.code}
                              type="button"
                              onClick={() => toggleType(t.code)}
                              className={`flex items-center justify-between w-full text-left px-3 py-2.5 rounded-xl border transition-all ${
                                selected
                                  ? 'bg-amber-50 border-amber-400 ring-1 ring-amber-300'
                                  : 'bg-stone-50 border-stone-200 hover:border-stone-300 hover:bg-white'
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className={`w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition-colors ${
                                  selected ? 'bg-amber-600 border-amber-600' : 'border-stone-300'
                                }`}>
                                  {selected && (
                                    <svg viewBox="0 0 10 8" className="w-2.5 h-2 text-white fill-current">
                                      <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                  )}
                                </div>
                                <span className={`text-sm leading-snug ${selected ? 'text-amber-900 font-medium' : 'text-stone-700'}`}>
                                  {t.label}
                                </span>
                              </div>
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border shrink-0 ml-2 ${TIER_COLOR[t.effort_tier] ?? 'bg-stone-100 text-stone-500 border-stone-200'}`}>
                                {t.effort_tier} · {TIER_PTS[t.effort_tier] ?? '?'}pts
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Add a brand-new task type — persists forever under its category */}
              <div className="mt-3">
                {!addOpen ? (
                  <button
                    type="button"
                    onClick={() => { setAddOpen(true); setNewCategory(categories[0] ?? '') }}
                    className="text-xs font-medium text-amber-700 hover:text-amber-800"
                  >
                    + Naya type banayein
                  </button>
                ) : (
                  <div className="p-3 rounded-xl border border-amber-300 bg-amber-50/60 space-y-2">
                    <Label className="text-xs text-amber-800 font-semibold block">Naya Task Type</Label>
                    <Input
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                      placeholder="Type ka naam (e.g. Vendor onboarding)"
                      className="text-sm h-10 bg-white"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={newCategory}
                        onChange={(e) => setNewCategory(e.target.value)}
                        className="text-sm h-10 rounded-lg border border-input bg-white px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                      >
                        {categories.map((c) => <option key={c} value={c}>{DEPT_LABEL[c] ?? c}</option>)}
                      </select>
                      <select
                        value={newTier}
                        onChange={(e) => setNewTier(e.target.value)}
                        className="text-sm h-10 rounded-lg border border-input bg-white px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                      >
                        {(['S', 'M', 'L', 'XL'] as const).map((t) => (
                          <option key={t} value={t}>{t} · {TIER_PTS[t]}pts</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" variant="outline" className="flex-1 text-xs h-9" onClick={() => setAddOpen(false)}>
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={adding || !newLabel.trim() || !newCategory}
                        onClick={handleAddType}
                        className="flex-1 text-xs h-9 bg-amber-700 hover:bg-amber-800 text-white"
                      >
                        {adding ? <Loader2 size={12} className="animate-spin" /> : 'Add Type'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-5 py-4 border-t border-stone-100 flex gap-2 shrink-0">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1 text-sm h-11">
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                saving ||
                selectedTypes.size === 0 ||
                !title.trim() ||
                (assigningToOther && !onBehalfOf)
              }
              className="flex-1 text-sm h-11 bg-amber-700 hover:bg-amber-800 text-white font-medium"
            >
              {saving
                ? <><Loader2 size={14} className="animate-spin mr-1.5" /> Creating…</>
                : selectedTypes.size === 0
                  ? 'Type chuniye'
                  : selectedTypes.size === 1
                    ? <><ChevronRight size={14} className="mr-1" /> Banao</>
                    : <><ChevronRight size={14} className="mr-1" /> {selectedTypes.size} Tasks Banao</>
              }
            </Button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function MyDayPage() {
  const { employee } = useAuth()
  const navigate     = useNavigate()
  const qc           = useQueryClient()

  const [createOpen, setCreateOpen]         = useState(false)
  const [submitTask_, setSubmitTask_]       = useState<DelTask | null>(null)
  const [cancelTask_, setCancelTask_]       = useState<DelTask | null>(null)
  const [actionLoading, setActLoad]         = useState<string | null>(null)

  const authUserId = employee?.auth_user_id ?? ''
  const roleGroup  = employee?.role ?? ''
  const isHead     = employee?.is_head ?? false
  const isGlobal   = roleGroup === 'founder' || roleGroup === 'admin' || employee?.del_super === true

  const tasksKey   = ['del_tasks', authUserId]
  const membersKey = ['del_team', roleGroup]

  const { data: tasks = [], isLoading: tasksLoading } = useQuery({
    queryKey: tasksKey,
    queryFn:  () => fetchMyTasks(authUserId),
    enabled:  !!authUserId,
    refetchInterval: 20_000,
  })

  // Always fetch all task types — the form filters by assignee role with a fallback to all
  const { data: taskTypes = [] } = useQuery({
    queryKey: ['del_task_types', 'all'],
    queryFn:  fetchAllTaskTypes,
    enabled:  true,
  })

  const { data: teamMembers = [] } = useQuery({
    queryKey: membersKey,
    queryFn:  () => isGlobal ? fetchAllActiveEmployees() : fetchTeamMembers(roleGroup),
    enabled:  (isHead || isGlobal) && !!roleGroup,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: tasksKey })

  const { mutate: doInProgress } = useMutation({
    mutationFn: (id: string) => { setActLoad(id); return moveToInProgress(id) },
    onSuccess:  () => { invalidate(); setActLoad(null) },
    onError:    (err: Error) => { toast.error(err.message); setActLoad(null) },
  })

  const { mutate: doCancel } = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => {
      setActLoad(id)
      return cancelTask(id, reason)
    },
    onSuccess: () => { invalidate(); setActLoad(null); toast.success('Task cancel ho gaya.') },
    onError:   (err: Error) => { toast.error(err.message); setActLoad(null) },
  })

  function tasksFor(col: ColConfig) {
    return tasks.filter((t) => col.statuses.includes(t.status))
  }

  const hasRole = LAUNCH_ROLES.includes(roleGroup) || isGlobal

  if (!employee) return null

  return (
    <div
      className="min-h-screen"
      style={{ background: 'radial-gradient(ellipse at 20% 0%, #fef9ec 0%, #fffbf0 40%, #fef3c7 100%)' }}
    >
      <div
        className="fixed inset-0 pointer-events-none"
        style={{ backgroundImage: 'radial-gradient(circle, rgba(180,120,30,0.06) 1px, transparent 1px)', backgroundSize: '28px 28px' }}
      />

      {/* Header */}
      <motion.header
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 bg-white/70 backdrop-blur-md border-b border-amber-100/80 px-4 py-3.5"
        style={{ boxShadow: '0 2px 24px rgba(146,64,14,0.08)' }}
      >
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/dashboard')}
              className="text-stone-400 hover:text-stone-600 transition-colors p-1 -ml-1"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <div className="font-semibold text-stone-800 text-sm">Mera Din</div>
              <div className="text-xs text-stone-400">{employee.name}</div>
            </div>
          </div>
          {hasRole && (
            <Button
              size="sm"
              onClick={() => setCreateOpen(true)}
              className="text-xs h-9 bg-amber-700 hover:bg-amber-800 text-white"
            >
              <Plus size={13} className="mr-1" />
              Naya Kaam
            </Button>
          )}
        </div>
      </motion.header>

      <main className="relative z-10 max-w-6xl mx-auto px-3 py-6">
        {!hasRole ? (
          <div className="text-center py-20 text-stone-400 text-sm">
            Aapke role ke liye delegation abhi available nahi hai.
          </div>
        ) : tasksLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {COLUMNS.map((col) => (
              <div key={col.key} className="space-y-2">
                <div className="h-5 w-32 bg-stone-100 rounded animate-pulse" />
                <div className="h-24 bg-white/60 rounded-xl border border-stone-100 animate-pulse" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {COLUMNS.map((col, i) => {
              const colTasks = tasksFor(col)
              return (
                <motion.div
                  key={col.key}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className={`rounded-xl ${col.accent} border ${col.border} p-3 space-y-2 min-h-[120px]`}>
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-sm font-semibold text-stone-700">
                        {col.label}
                        <span className="text-stone-400 font-normal"> ({colTasks.length})</span>
                      </h3>
                    </div>

                    <AnimatePresence>
                      {colTasks.length === 0 ? (
                        <p className="text-xs text-stone-400 text-center py-4">
                          {col.sub}
                        </p>
                      ) : (
                        colTasks.map((task) => (
                          <TaskCard
                            key={task.id}
                            task={task}
                            taskTypes={taskTypes}
                            isHead={isHead || isGlobal}
                            onInProgress={(id) => doInProgress(id)}
                            onSubmit={(t) => setSubmitTask_(t)}
                            onCancel={(t) => setCancelTask_(t)}
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
      </main>

      {/* Submit modal */}
      <AnimatePresence>
        {submitTask_ && (
          <SubmitModal
            task={submitTask_}
            onClose={() => setSubmitTask_(null)}
            onSubmitted={invalidate}
          />
        )}
      </AnimatePresence>

      {/* Cancel modal */}
      <AnimatePresence>
        {cancelTask_ && (
          <CancelModal
            task={cancelTask_}
            onClose={() => setCancelTask_(null)}
            onConfirm={(reason) => {
              doCancel({ id: cancelTask_!.id, reason })
              setCancelTask_(null)
            }}
          />
        )}
      </AnimatePresence>

      {/* Create modal */}
      <AnimatePresence>
        {createOpen && (
          <CreateTaskForm
            employee={employee}
            taskTypes={taskTypes}
            teamMembers={teamMembers as Employee[]}
            onClose={() => setCreateOpen(false)}
            onCreated={invalidate}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
