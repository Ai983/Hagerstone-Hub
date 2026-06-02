import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, CheckCircle2, XCircle, Loader2, ClipboardList } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../hooks/useAuth'
import {
  fetchSubmittedTasks,
  fetchTeamMembers,
  fetchAllActiveEmployees,
  verifyTask,
} from '../../lib/delegation'
import type { DelTask } from '../../types/delegation'
import type { Employee } from '../../types'
import { Button } from '../../components/ui/button'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDateTime(s: string) {
  return new Date(s).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

function fmtDate(s: string) {
  return new Date(s + 'T00:00:00').toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short',
  })
}

function buildNameMap(employees: Employee[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const e of employees) {
    if (e.auth_user_id) m.set(e.auth_user_id, e.name)
  }
  return m
}

// ── Task row ──────────────────────────────────────────────────────────────────

function TaskRow({
  task,
  nameMap,
  onApprove,
  onReject,
  loading,
}: {
  task: DelTask
  nameMap: Map<string, string>
  onApprove: (id: string) => void
  onReject:  (id: string, reason: string) => void
  loading: string | null
}) {
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason]       = useState('')
  const isLoading = loading === task.id

  const assigneeName  = nameMap.get(task.assigned_to) ?? 'Unknown'
  const pendingPoints = task.del_points?.[0]?.points ?? 0
  const pendingReason = task.del_points?.[0]?.reason ?? ''

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className="bg-white rounded-xl border border-amber-100 p-4 space-y-3"
      style={{ boxShadow: '0 2px 12px rgba(146,64,14,0.07)' }}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
              {assigneeName}
            </span>
            <span className="text-xs text-stone-400">{task.role_group}</span>
          </div>
          <p className="text-sm font-medium text-stone-800 leading-snug">{task.title}</p>
          {task.description && (
            <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">{task.description}</p>
          )}
        </div>
        <div className="text-right shrink-0 space-y-0.5">
          <div className="text-xs text-stone-500">For: {fmtDate(task.task_date)}</div>
          {task.submitted_at && (
            <div className="text-xs text-stone-400">Submitted: {fmtDateTime(task.submitted_at)}</div>
          )}
        </div>
      </div>

      {/* Pending points */}
      {pendingReason && (
        <div className="text-xs text-stone-500 bg-stone-50 border border-stone-100 rounded-lg px-3 py-2 leading-relaxed">
          {pendingReason}
        </div>
      )}
      {!pendingReason && (
        <div className="text-xs text-stone-400 italic">No points row yet</div>
      )}

      {/* Actions */}
      <AnimatePresence mode="wait">
        {rejecting ? (
          <motion.div
            key="reject-form"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-2"
          >
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for rejection (required)…"
              rows={2}
              className="w-full text-sm rounded-lg border border-red-200 bg-red-50/40 px-3 py-2 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-red-300 resize-none"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="flex-1 text-xs"
                onClick={() => { setRejecting(false); setReason('') }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!reason.trim() || isLoading}
                onClick={() => { onReject(task.id, reason.trim()); setRejecting(false); setReason('') }}
                className="flex-1 text-xs bg-red-600 hover:bg-red-700 text-white"
              >
                {isLoading ? <Loader2 size={12} className="animate-spin mr-1" /> : <XCircle size={12} className="mr-1" />}
                Confirm Reject
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="action-buttons"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex gap-2"
          >
            <Button
              size="sm"
              variant="outline"
              disabled={isLoading}
              onClick={() => setRejecting(true)}
              className="flex-1 text-xs border-red-200 text-red-600 hover:bg-red-50"
            >
              <XCircle size={12} className="mr-1" />
              Reject
            </Button>
            <Button
              size="sm"
              disabled={isLoading}
              onClick={() => onApprove(task.id)}
              className="flex-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {isLoading
                ? <Loader2 size={12} className="animate-spin mr-1" />
                : <CheckCircle2 size={12} className="mr-1" />
              }
              Approve
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function VerifyQueuePage() {
  const { employee } = useAuth()
  const navigate     = useNavigate()
  const qc           = useQueryClient()

  const [actLoading, setActLoading] = useState<string | null>(null)

  // Derive these before hooks so values are stable (employee may be null on first render)
  const isGlobal   = employee?.role === 'founder' || employee?.role === 'admin'
  const filterRole = isGlobal ? null : (employee?.role ?? null)

  const queueKey   = ['del_verify_queue', filterRole]
  const membersKey = ['del_all_members', isGlobal]

  // All hooks unconditionally at the top — no early return before this point
  const { data: tasks = [], isLoading: tasksLoading } = useQuery({
    queryKey: queueKey,
    queryFn:  () => fetchSubmittedTasks(filterRole),
    enabled:  !!employee,
    refetchInterval: 30_000,
  })

  const { data: allEmployees = [] } = useQuery({
    queryKey: membersKey,
    queryFn:  () => isGlobal ? fetchAllActiveEmployees() : fetchTeamMembers(employee!.role),
    enabled:  !!employee,
  })

  const nameMap    = buildNameMap(allEmployees as Employee[])
  const invalidate = () => qc.invalidateQueries({ queryKey: queueKey })

  const { mutate: doApprove } = useMutation({
    mutationFn: (id: string) => {
      setActLoading(id)
      return verifyTask(id, 'approve')
    },
    onSuccess: () => { invalidate(); setActLoading(null); toast.success('Task approved — points verified!') },
    onError:   (err: Error) => { toast.error(err.message); setActLoading(null) },
  })

  const { mutate: doReject } = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => {
      setActLoading(id)
      return verifyTask(id, 'reject', reason)
    },
    onSuccess: () => { invalidate(); setActLoading(null); toast.success('Task rejected.') },
    onError:   (err: Error) => { toast.error(err.message); setActLoading(null) },
  })

  // Safe early return after all hooks
  if (!employee) return null

  const roleLabel = isGlobal ? 'All Departments' : employee.role.replace(/_/g, ' ')

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
        className="relative z-10 bg-white/70 backdrop-blur-md border-b border-amber-100/80 px-6 py-3.5"
        style={{ boxShadow: '0 2px 24px rgba(146,64,14,0.08)' }}
      >
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/dashboard')}
              className="text-stone-400 hover:text-stone-600 transition-colors"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <div className="font-semibold text-stone-800 text-sm flex items-center gap-2">
                <ClipboardList size={15} className="text-amber-700" />
                Verify Queue
              </div>
              <div className="text-xs text-stone-400">{roleLabel}</div>
            </div>
          </div>
          <div className="text-xs text-stone-400 bg-white/60 border border-stone-100 px-2.5 py-1 rounded-full">
            {tasksLoading ? '…' : tasks.length} pending
          </div>
        </div>
      </motion.header>

      <main className="relative z-10 max-w-3xl mx-auto px-4 py-8">
        {tasksLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 bg-white/60 rounded-xl border border-stone-100 animate-pulse" />
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-20"
          >
            <CheckCircle2 size={40} className="text-emerald-400 mx-auto mb-3" />
            <p className="text-stone-500 font-medium">All clear — no submitted tasks</p>
            <p className="text-stone-400 text-sm mt-1">Check back after your team submits their work.</p>
          </motion.div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence>
              {tasks.map((task, i) => (
                <motion.div
                  key={task.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                >
                  <TaskRow
                    task={task}
                    nameMap={nameMap}
                    onApprove={(id) => doApprove(id)}
                    onReject={(id, reason) => doReject({ id, reason })}
                    loading={actLoading}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </main>
    </div>
  )
}
