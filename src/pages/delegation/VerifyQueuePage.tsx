import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, CheckCircle2, XCircle, Loader2, ClipboardList,
  Sliders, AlertTriangle, Paperclip, ChevronDown, ChevronUp,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../hooks/useAuth'
import {
  fetchSubmittedTasks,
  fetchTeamMembers,
  fetchAllActiveEmployees,
  fetchAllTaskTypes,
  verifyTask,
} from '../../lib/delegation'
import { DELEGATION_POINTS } from '../../config/delegation-points'
import type { DelTask, AgentMeta } from '../../types/delegation'
import type { Employee } from '../../types'
import { PointEntryCard } from '../../components/delegation/PointEntryCard'
import { type PillStatus } from '../../lib/delegation-ui'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'

function fmtDateTime(s: string) {
  return new Date(s).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

function buildNameMap(employees: Employee[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const e of employees) {
    if (e.auth_user_id) m.set(e.auth_user_id, e.name)
  }
  return m
}

function confidencePill(confidence: AgentMeta['confidence']) {
  const cfg = {
    high:   { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'High confidence' },
    medium: { cls: 'bg-amber-50 text-amber-700 border-amber-200',       label: 'Medium confidence' },
    low:    { cls: 'bg-red-50 text-red-600 border-red-200',             label: 'Low confidence' },
  }[confidence] ?? { cls: 'bg-stone-100 text-stone-500 border-stone-200', label: confidence ? `${confidence} confidence` : 'Confidence n/a' }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  )
}

// ── TaskRow ───────────────────────────────────────────────────────────────────

function TaskRow({
  task,
  nameMap,
  onApprove,
  onAdjust,
  onReject,
  loading,
  maxPts,
}: {
  task: DelTask
  nameMap: Map<string, string>
  onApprove: (id: string) => void
  onAdjust:  (id: string, pts: number) => void
  onReject:  (id: string, reason: string) => void
  loading: string | null
  maxPts?: number
}) {
  const [mode, setMode]           = useState<'actions' | 'adjust' | 'reject'>('actions')
  const [adjustPts, setAdjustPts] = useState<string>('')
  const [rejectReason, setRejectReason] = useState('')
  const [showRaw, setShowRaw]     = useState(false)

  const isLoading = loading === task.id

  const assigneeName = nameMap.get(task.assigned_to) ?? 'Unknown'
  const pt           = task.del_points?.[0]
  // A task may carry several submissions (e.g. resubmitted after a rejection).
  // Always show the most recent one so the reviewer sees the latest attachments.
  const submission   = [...(task.del_submissions ?? [])].sort(
    (a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime(),
  )[0]
  const agentMeta    = pt?.agent_meta as AgentMeta | null
  const proposed     = pt?.proposed_points ?? 0

  // Flags that warrant extra attention
  const hasRedFlags  = agentMeta?.flags?.length && agentMeta.flags.length > 0
  const hasAttachments = submission?.attachments && (submission.attachments as []).length > 0

  const pill: PillStatus = task.status === 'submitted' ? 'scoring' : 'pending'

  return (
    <PointEntryCard
      points={pt ? proposed : null}
      sourceLabel={`👤 ${assigneeName}`}
      taskTitle={task.title}
      status={pill}
      date={task.task_date}
      summary={pt?.summary ?? 'AI scoring chal raha hai… thodi der mein score aayega.'}
    >
      {/* ── Expanded: full review detail + actions ──────────────────────── */}
      <div className="space-y-3">
        {/* Meta line */}
        <div className="flex items-center gap-2 flex-wrap text-xs text-stone-400">
          <span>{task.role_group}</span>
          {task.submitted_at && <span>· Submitted {fmtDateTime(task.submitted_at)}</span>}
        </div>

        {task.description && (
          <p className="text-xs text-stone-500 leading-relaxed">{task.description}</p>
        )}

        {pt && (
          <div className="bg-amber-50/60 border border-amber-100 rounded-xl p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold text-amber-800">{proposed}</span>
                <span className="text-sm text-stone-400">pts (AI proposal)</span>
                {maxPts != null && (
                  <span className="text-xs font-medium text-stone-500 bg-stone-100 border border-stone-200 px-1.5 py-0.5 rounded">
                    Max {maxPts}
                  </span>
                )}
              </div>
              {agentMeta && confidencePill(agentMeta.confidence)}
            </div>

            {hasRedFlags && (
              <div className="flex items-start gap-1.5 flex-wrap">
                <AlertTriangle size={13} className="text-amber-600 shrink-0 mt-0.5" />
                {agentMeta!.flags.map((flag) => (
                  <span key={flag} className="text-xs bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded">
                    {flag.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            )}

            {/* Raw submission toggle */}
            {submission?.raw_text && (
              <div>
                <button
                  onClick={() => setShowRaw((s) => !s)}
                  className="flex items-center gap-1 text-xs text-stone-500 hover:text-stone-700 transition-colors"
                >
                  {showRaw ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  Employee ne kya likha
                </button>
                <AnimatePresence>
                  {showRaw && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-2 text-xs text-stone-600 bg-white border border-stone-100 rounded-lg px-3 py-2.5 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">
                        {submission.raw_text}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* Attachments */}
            {hasAttachments && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <Paperclip size={12} className="text-stone-400" />
                {(submission!.attachments as { name: string; url: string; type: string; size: number }[]).map((a, i) => (
                  <a
                    key={i}
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-amber-700 underline underline-offset-2 hover:text-amber-900 truncate max-w-[180px]"
                  >
                    {a.name}
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Action area */}
        <AnimatePresence mode="wait">
          {mode === 'actions' && (
            <motion.div
              key="actions"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex gap-2 flex-wrap"
            >
              <Button
                size="sm"
                variant="outline"
                disabled={isLoading}
                onClick={() => setMode('reject')}
                className="flex-1 min-w-[80px] text-xs border-red-200 text-red-600 hover:bg-red-50 h-10"
              >
                <XCircle size={12} className="mr-1" />
                Reject
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={isLoading || !pt}
                onClick={() => { setAdjustPts(String(proposed)); setMode('adjust') }}
                className="flex-1 min-w-[80px] text-xs border-violet-200 text-violet-600 hover:bg-violet-50 h-10"
              >
                <Sliders size={12} className="mr-1" />
                Adjust
              </Button>
              <Button
                size="sm"
                disabled={isLoading || !pt}
                onClick={() => onApprove(task.id)}
                className="flex-1 min-w-[80px] text-xs bg-emerald-600 hover:bg-emerald-700 text-white h-10"
              >
                {isLoading
                  ? <Loader2 size={12} className="animate-spin mr-1" />
                  : <CheckCircle2 size={12} className="mr-1" />
                }
                Approve ({proposed} pts)
              </Button>
            </motion.div>
          )}

          {mode === 'adjust' && (
            <motion.div
              key="adjust"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-2"
            >
              <p className="text-xs text-stone-500">
                AI ne {proposed} suggest kiya{maxPts != null ? ` — max ${maxPts} pts de sakte hain` : ''} — aap change kar sakte ho:
              </p>
              <Input
                type="number"
                min={0}
                max={maxPts}
                value={adjustPts}
                onChange={(e) => setAdjustPts(e.target.value)}
                placeholder="Final points…"
                className="text-sm h-10"
              />
              {maxPts != null && Number(adjustPts) > maxPts && (
                <p className="text-xs text-red-600">Max {maxPts} pts allowed (decided at assignment).</p>
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 text-xs h-10"
                  onClick={() => setMode('actions')}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={isLoading || !adjustPts || Number(adjustPts) < 0 || (maxPts != null && Number(adjustPts) > maxPts)}
                  onClick={() => {
                    const pts = maxPts != null ? Math.min(Number(adjustPts), maxPts) : Number(adjustPts)
                    onAdjust(task.id, pts)
                    setMode('actions')
                  }}
                  className="flex-1 text-xs bg-violet-600 hover:bg-violet-700 text-white h-10"
                >
                  {isLoading ? <Loader2 size={12} className="animate-spin mr-1" /> : <Sliders size={12} className="mr-1" />}
                  Confirm ({adjustPts || 0} pts)
                </Button>
              </div>
            </motion.div>
          )}

          {mode === 'reject' && (
            <motion.div
              key="reject"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-2"
            >
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Reject karne ki wajah (required)…"
                rows={2}
                className="w-full text-sm rounded-lg border border-red-200 bg-red-50/40 px-3 py-2 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-red-300 resize-none"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 text-xs h-10"
                  onClick={() => { setMode('actions'); setRejectReason('') }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={!rejectReason.trim() || isLoading}
                  onClick={() => { onReject(task.id, rejectReason.trim()); setMode('actions'); setRejectReason('') }}
                  className="flex-1 text-xs bg-red-600 hover:bg-red-700 text-white h-10"
                >
                  {isLoading ? <Loader2 size={12} className="animate-spin mr-1" /> : <XCircle size={12} className="mr-1" />}
                  Reject Karo
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </PointEntryCard>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function VerifyQueuePage() {
  const { employee } = useAuth()
  const navigate     = useNavigate()
  const qc           = useQueryClient()

  const [actLoading, setActLoading] = useState<string | null>(null)

  const isGlobal   = employee?.role === 'founder' || employee?.role === 'admin' || employee?.del_super === true
  const filterRole = isGlobal ? null : (employee?.role ?? null)

  const queueKey   = ['del_verify_queue', filterRole]
  const membersKey = ['del_all_members', isGlobal]

  const { data: tasks = [], isLoading: tasksLoading } = useQuery({
    queryKey: queueKey,
    queryFn:  () => fetchSubmittedTasks(filterRole),
    enabled:  !!employee,
    refetchInterval: 20_000,
  })

  const { data: allEmployees = [] } = useQuery({
    queryKey: membersKey,
    queryFn:  () => isGlobal ? fetchAllActiveEmployees() : fetchTeamMembers(employee!.role),
    enabled:  !!employee,
  })

  const nameMap    = buildNameMap(allEmployees as Employee[])
  const invalidate = () => qc.invalidateQueries({ queryKey: queueKey })

  // Max awardable points per task (decided at assignment): custom Other points,
  // else the task type's tier ceiling. Mirrors the server-side clamp.
  const { data: taskTypes = [] } = useQuery({ queryKey: ['del_task_types', 'all'], queryFn: fetchAllTaskTypes })
  const tierMap = new Map<string, number>()
  ;(taskTypes as { code: string; effort_tier: string }[]).forEach((t) =>
    tierMap.set(t.code, (DELEGATION_POINTS.tier as Record<string, number>)[t.effort_tier] ?? 0))
  const maxFor = (t: DelTask): number | undefined =>
    t.custom_points ?? (t.type_code ? tierMap.get(t.type_code) : undefined)

  const { mutate: doApprove } = useMutation({
    mutationFn: (id: string) => {
      setActLoading(id)
      return verifyTask({ task_id: id, decision: 'approve' })
    },
    onSuccess: () => { invalidate(); setActLoading(null); toast.success('Approved — points verify ho gaye!') },
    onError:   (err: Error) => { toast.error(err.message); setActLoading(null) },
  })

  const { mutate: doAdjust } = useMutation({
    mutationFn: ({ id, pts }: { id: string; pts: number }) => {
      setActLoading(id)
      return verifyTask({ task_id: id, decision: 'adjust', final_points: pts })
    },
    onSuccess: () => { invalidate(); setActLoading(null); toast.success('Points adjust aur approve ho gaye!') },
    onError:   (err: Error) => { toast.error(err.message); setActLoading(null) },
  })

  const { mutate: doReject } = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => {
      setActLoading(id)
      return verifyTask({ task_id: id, decision: 'reject', reject_reason: reason })
    },
    onSuccess: () => { invalidate(); setActLoading(null); toast.success('Rejected.') },
    onError:   (err: Error) => { toast.error(err.message); setActLoading(null) },
  })

  if (!employee) return null

  const roleLabel = isGlobal ? 'Sabhi Departments' : employee.role.replace(/_/g, ' ')

  // Separate: under_review (AI done) first, then submitted (AI still running)
  const underReview = tasks.filter((t) => t.status === 'under_review')
  const aiRunning   = tasks.filter((t) => t.status === 'submitted')

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
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/dashboard')}
              className="text-stone-400 hover:text-stone-600 transition-colors p-1 -ml-1"
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
          <div className="text-xs text-stone-500 bg-white/60 border border-stone-100 px-2.5 py-1 rounded-full">
            {tasksLoading ? '…' : underReview.length} review mein
          </div>
        </div>
      </motion.header>

      <main className="relative z-10 max-w-3xl mx-auto px-3 py-6">
        {tasksLoading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-40 bg-white/60 rounded-xl border border-stone-100 animate-pulse" />
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-20"
          >
            <CheckCircle2 size={40} className="text-emerald-400 mx-auto mb-3" />
            <p className="text-stone-600 font-medium">Sab clear hai!</p>
            <p className="text-stone-400 text-sm mt-1">Abhi koi submit nahi hua. Team ke kaam karne ka wait karo.</p>
          </motion.div>
        ) : (
          <div className="space-y-4">
            {/* Under review — actionable */}
            {underReview.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide px-1">
                  AI Score Ready ({underReview.length})
                </p>
                <AnimatePresence>
                  {underReview.map((task, i) => (
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
                        onAdjust={(id, pts) => doAdjust({ id, pts })}
                        onReject={(id, reason) => doReject({ id, reason })}
                        loading={actLoading}
                        maxPts={maxFor(task)}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}

            {/* Still scoring */}
            {aiRunning.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide px-1">
                  AI Scoring Chal Raha Hai ({aiRunning.length})
                </p>
                <AnimatePresence>
                  {aiRunning.map((task, i) => (
                    <motion.div
                      key={task.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 + 0.1, duration: 0.35 }}
                    >
                      <TaskRow
                        task={task}
                        nameMap={nameMap}
                        onApprove={(id) => doApprove(id)}
                        onAdjust={(id, pts) => doAdjust({ id, pts })}
                        onReject={(id, reason) => doReject({ id, reason })}
                        loading={actLoading}
                        maxPts={maxFor(task)}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
