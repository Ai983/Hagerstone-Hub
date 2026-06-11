import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button } from '../components/ui/button'
import { ArrowLeft, LogOut, Pencil } from 'lucide-react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { useState } from 'react'

interface ApprovalRequest {
  id: string
  ref_id: string
  employee_id: string
  employee?: { name: string }
  site: string
  category: string
  purpose: string
  amount_requested: number
  approved_amount: number
  old_balance_deducted?: number
  net_approved_amount?: number
  founder_adjusted_amount?: number | null
  submitted_at: string
  approval_route: string
  // canonical note columns (written by backend after the fix)
  s1_note?: string
  s2_note?: string
  s3_note?: string
  director_note?: string
  // legacy plural columns (written by older backend — kept for backward compat display)
  s1_notes?: string
  s2_notes?: string
  founder_rejection_count: number
  founder_gate_comment?: string
  founder_gate_status?: 'approved' | 'rejected'
  founder_gate_reviewed_at?: string
  // payment status (for the Approved tab)
  paid?: boolean
  paid_amount?: number
  paid_at?: string
}

type Tab = 'pending' | 'approved' | 'rejected'

const FINANCE_API = import.meta.env.VITE_FINANCE_API_URL || 'http://localhost:4000'

const inr = (n?: number | null) => `₹${Number(n ?? 0).toLocaleString('en-IN')}`
const fmtDate = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : ''

async function fetchFounderQueue(token: string) {
  const response = await fetch(`${FINANCE_API}/api/imprest/founder/queue`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`)
  const json = await response.json()
  return json.data ?? json
}

async function fetchFounderHistory(token: string) {
  const response = await fetch(`${FINANCE_API}/api/imprest/founder/history`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`)
  const json = await response.json()
  return json.data ?? json
}

async function approveGate(id: string, comment: string, token: string, adjustedAmount?: number) {
  const body: Record<string, unknown> = { founderGateComment: comment }
  if (adjustedAmount != null) body.adjustedAmount = adjustedAmount
  const response = await fetch(`${FINANCE_API}/api/imprest/${id}/founder-gate-approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const msg = await response.json().catch(() => null)
    throw new Error(msg?.error || `Failed to approve: ${response.statusText}`)
  }
  return response.json()
}

async function rejectGate(id: string, comment: string, token: string) {
  if (!comment?.trim()) throw new Error('Rejection comment is required')
  const response = await fetch(`${FINANCE_API}/api/imprest/${id}/founder-gate-reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ founderGateComment: comment }),
  })
  if (!response.ok) {
    const msg = await response.json().catch(() => null)
    throw new Error(msg?.error || `Failed to reject: ${response.statusText}`)
  }
  return response.json()
}

// Resolve stage labels for route-aware display
function stageLabel(route: string, stage: 's1' | 's2' | 'director' | 's3') {
  const isS2Route = route === 's2_finance_founder'
  const isDirectorRoute = route === 'avisha_director_finance_founder'
  if (stage === 's1') return isS2Route ? null : '✅ S1 — Avisha'
  if (stage === 's2') return isS2Route ? '✅ S2 — Ritu Ma\'am' : null
  if (stage === 'director') return isDirectorRoute ? '✅ Director' : null
  if (stage === 's3') return '✅ Finance'
  return null
}

function ApprovalCard({
  req,
  mode,
  onApprove,
  onReject,
  loading,
}: {
  req: ApprovalRequest
  mode: Tab
  onApprove: (id: string, comment: string, adjustedAmount?: number) => void
  onReject: (id: string, comment: string) => void
  loading: boolean
}) {
  const [comment, setComment] = useState('')
  const [adjustOpen, setAdjustOpen] = useState(false)
  const currentAmount = Number(req.approved_amount || req.amount_requested || 0)
  const [adjustValue, setAdjustValue] = useState<string>(String(currentAmount))

  // Resolve route label
  const routeLabel =
    req.approval_route === 's2_finance_founder'
      ? '🔵 HO/Bangalore'
      : req.approval_route === 'avisha_director_finance_founder'
      ? '🔴 High-Value'
      : '🟡 Standard'

  // Resolved notes — use singular column, fall back to plural for old records
  const s1Note = req.s1_note || req.s1_notes || null
  const s2Note = req.s2_note || req.s2_notes || null
  const s3Note = req.s3_note || null
  const dirNote = req.director_note || null
  const hasAnyNote = !!(s1Note || s2Note || s3Note || dirNote)

  const netAmount = req.net_approved_amount ?? (
    req.old_balance_deducted && req.old_balance_deducted > 0
      ? currentAmount - req.old_balance_deducted
      : currentAmount
  )

  const adjusted = req.founder_adjusted_amount != null ? Number(req.founder_adjusted_amount) : null

  const handleApproveClick = () => {
    let amount: number | undefined
    if (adjustOpen) {
      const v = Number(adjustValue)
      if (!Number.isFinite(v) || v <= 0) {
        toast.error('Enter a valid amount')
        return
      }
      if (v > currentAmount) {
        toast.error(`Amount can only be reduced (max ${inr(currentAmount)})`)
        return
      }
      // Only counts as an adjustment if it actually differs
      if (Math.round(v * 100) !== Math.round(currentAmount * 100)) {
        if (!comment.trim()) {
          toast.error('A note is required when you change the amount')
          return
        }
        amount = v
      }
    }
    onApprove(req.id, comment, amount)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="border border-amber-200 rounded-xl p-5 bg-white/70 backdrop-blur-sm hover:shadow-md transition-shadow"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="font-bold text-amber-950 text-base">{req.ref_id}</div>
          <div className="text-sm text-amber-700 mt-0.5">
            {req.employee?.name || '—'} · {req.site}
          </div>
        </div>
        <span className="text-xs font-medium bg-amber-100 text-amber-800 px-2 py-1 rounded-full">
          {routeLabel}
        </span>
      </div>

      {/* Amount block */}
      <div className="bg-amber-50 rounded-lg p-3 mb-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-amber-600 font-medium">
              {adjusted != null ? 'Finance Approved' : 'Approved Amount'}
            </div>
            <div className={`text-lg font-bold text-amber-900 ${adjusted != null ? 'line-through opacity-60 text-base' : ''}`}>
              {inr(currentAmount)}
            </div>
            {adjusted == null && (req.old_balance_deducted ?? 0) > 0 && (
              <div className="text-xs text-orange-700 mt-0.5">
                ⚠ Old balance deducted: {inr(req.old_balance_deducted)} → Net payable: {inr(netAmount)}
              </div>
            )}
          </div>
          <div className="text-right">
            <div className="text-xs text-amber-600">{req.category}</div>
            <div className="text-xs text-amber-500 mt-0.5">{fmtDate(req.submitted_at)}</div>
          </div>
        </div>

        {/* Founder-adjusted payout (exact amount Finance will pay) */}
        {adjusted != null && (
          <div className="mt-2 pt-2 border-t border-amber-200 flex items-center gap-2">
            <Pencil size={13} className="text-emerald-700" />
            <span className="text-xs text-emerald-800 font-medium">Founder set payout:</span>
            <span className="text-lg font-bold text-emerald-800">{inr(adjusted)}</span>
          </div>
        )}
      </div>

      {req.purpose && (
        <div className="text-xs text-amber-700 italic mb-3 px-1">Purpose: {req.purpose}</div>
      )}

      {/* Repeat rejection warning */}
      {req.founder_rejection_count > 0 && mode === 'pending' && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 mb-3">
          <div className="text-xs font-semibold text-red-800">⚠️ Previously rejected {req.founder_rejection_count} time(s)</div>
          {req.founder_gate_comment && (
            <div className="text-xs text-red-700 mt-1 italic">Last comment: "{req.founder_gate_comment}"</div>
          )}
        </div>
      )}

      {/* Approval trail — always visible so Founder can see each stage's notes */}
      <div className="border border-amber-100 rounded-lg p-3 mb-4 bg-white/50">
        <div className="text-xs font-bold text-amber-900 mb-2">📋 Approval Trail</div>
        <div className="space-y-2">
          {stageLabel(req.approval_route, 's1') && (
            <div className="flex gap-2 text-xs">
              <span className="text-green-600 mt-0.5">●</span>
              <div>
                <span className="font-semibold text-gray-800">{stageLabel(req.approval_route, 's1')}</span>
                {s1Note
                  ? <p className="text-gray-600 mt-0.5 italic">"{s1Note}"</p>
                  : <p className="text-amber-500 mt-0.5 italic">No note recorded</p>}
              </div>
            </div>
          )}
          {stageLabel(req.approval_route, 's2') && (
            <div className="flex gap-2 text-xs">
              <span className="text-green-600 mt-0.5">●</span>
              <div>
                <span className="font-semibold text-gray-800">{stageLabel(req.approval_route, 's2')}</span>
                {s2Note
                  ? <p className="text-gray-600 mt-0.5 italic">"{s2Note}"</p>
                  : <p className="text-amber-500 mt-0.5 italic">No note recorded</p>}
              </div>
            </div>
          )}
          {stageLabel(req.approval_route, 'director') && dirNote && (
            <div className="flex gap-2 text-xs">
              <span className="text-blue-600 mt-0.5">●</span>
              <div>
                <span className="font-semibold text-gray-800">{stageLabel(req.approval_route, 'director')}</span>
                <p className="text-gray-600 mt-0.5 italic">"{dirNote}"</p>
              </div>
            </div>
          )}
          <div className="flex gap-2 text-xs">
            <span className="text-purple-600 mt-0.5">●</span>
            <div>
              <span className="font-semibold text-gray-800">✅ Finance — Reviewed</span>
              {s3Note
                ? <p className="text-gray-600 mt-0.5 italic">"{s3Note}"</p>
                : <p className="text-amber-500 mt-0.5 italic">No note recorded</p>}
            </div>
          </div>
        </div>
        {!hasAnyNote && (
          <div className="text-xs text-amber-500 italic mt-2">No reviewer notes have been recorded for this request.</div>
        )}
      </div>

      {/* PENDING: adjust amount + approve / reject */}
      {mode === 'pending' && (
        <>
          {/* Adjust amount control */}
          <div className="mb-3">
            {!adjustOpen ? (
              <button
                onClick={() => { setAdjustOpen(true); setAdjustValue(String(currentAmount)) }}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-800 border border-amber-300 rounded-lg px-3 py-1.5 hover:bg-amber-50 transition"
              >
                <Pencil size={12} /> Adjust amount
              </button>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-amber-800">Adjusted payout (can only be reduced)</label>
                  <button
                    onClick={() => { setAdjustOpen(false); setAdjustValue(String(currentAmount)) }}
                    className="text-xs text-amber-500 hover:text-amber-700"
                  >
                    Cancel
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-amber-700 font-semibold">₹</span>
                  <input
                    type="number"
                    min={1}
                    max={currentAmount}
                    value={adjustValue}
                    onChange={(e) => setAdjustValue(e.target.value)}
                    className="flex-1 text-sm p-2 border border-amber-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
                <p className="text-[11px] text-amber-600 mt-1">
                  Max {inr(currentAmount)}. Finance will pay exactly this amount. A note is required when you change it.
                </p>
              </div>
            )}
          </div>

          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Add your note (required for rejection or amount change, recommended for approval)"
            rows={2}
            className="w-full text-xs p-2 border border-amber-200 rounded-lg mb-3 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
          />

          <div className="flex gap-2">
            <button
              onClick={handleApproveClick}
              disabled={loading}
              className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-xs font-semibold py-2.5 rounded-lg transition active:scale-95"
            >
              {loading ? '…' : '✅ APPROVE'}
            </button>
            <button
              onClick={() => {
                if (!comment?.trim()) {
                  toast.error('Rejection comment is required')
                  return
                }
                onReject(req.id, comment)
              }}
              disabled={loading}
              className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-semibold py-2.5 rounded-lg transition active:scale-95"
            >
              {loading ? '…' : '❌ REJECT'}
            </button>
          </div>
        </>
      )}

      {/* APPROVED: decision summary + payment status */}
      {mode === 'approved' && (
        <div className="rounded-lg p-3 text-xs bg-green-50 border border-green-200 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-green-800">✅ Approved by you</span>
            <span className="text-gray-600">{fmtDate(req.founder_gate_reviewed_at)}</span>
          </div>
          {req.founder_gate_comment && (
            <div className="text-gray-700 italic">"{req.founder_gate_comment}"</div>
          )}
          {/* Payment status */}
          {req.paid ? (
            <div className="inline-flex items-center gap-1.5 bg-emerald-100 text-emerald-800 font-medium rounded-full px-2.5 py-1">
              ✅ Paid {inr(req.paid_amount)}{req.paid_at ? ` on ${fmtDate(req.paid_at)}` : ''}
            </div>
          ) : (
            <div className="inline-flex items-center gap-1.5 bg-amber-100 text-amber-800 font-medium rounded-full px-2.5 py-1">
              🟡 Payment pending from Finance
            </div>
          )}
        </div>
      )}

      {/* REJECTED: decision summary */}
      {mode === 'rejected' && (
        <div className="rounded-lg p-3 text-xs bg-red-50 border border-red-200">
          <div className="flex items-center justify-between mb-1">
            <span className="font-semibold text-red-800">❌ Rejected by you</span>
            <span className="text-gray-600">{fmtDate(req.founder_gate_reviewed_at)}</span>
          </div>
          {req.founder_gate_comment && (
            <div className="text-gray-700 italic">"{req.founder_gate_comment}"</div>
          )}
        </div>
      )}
    </motion.div>
  )
}

export function ApprovalsPage() {
  const { employee, signOut } = useAuth()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<Tab>('pending')
  const [actingId, setActingId] = useState<string | null>(null)

  const role = employee?.role
  const allowed = role === 'founder' || role === 'admin'

  const queueQuery = useQuery({
    queryKey: ['imprest_founder_queue'],
    enabled: allowed,
    queryFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData.session) throw new Error('No session')
      return fetchFounderQueue(sessionData.session.access_token)
    },
    refetchInterval: 30000,
  })

  const historyQuery = useQuery({
    queryKey: ['imprest_founder_history'],
    enabled: allowed,
    queryFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData.session) throw new Error('No session')
      return fetchFounderHistory(sessionData.session.access_token)
    },
    refetchInterval: 30000,
  })

  const refetchAll = () => { queueQuery.refetch(); historyQuery.refetch() }

  const handleApprove = async (id: string, comment: string, adjustedAmount?: number) => {
    try {
      setActingId(id)
      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData.session) throw new Error('No session')
      await approveGate(id, comment, sessionData.session.access_token, adjustedAmount)
      toast.success(adjustedAmount != null ? `Approved at ${inr(adjustedAmount)}!` : 'Approved!')
      refetchAll()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to approve')
    } finally {
      setActingId(null)
    }
  }

  const handleReject = async (id: string, comment: string) => {
    try {
      setActingId(id)
      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData.session) throw new Error('No session')
      await rejectGate(id, comment, sessionData.session.access_token)
      toast.success('Rejected!')
      refetchAll()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reject')
    } finally {
      setActingId(null)
    }
  }

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  if (!employee) return null
  if (!allowed) {
    navigate('/dashboard')
    return null
  }

  const pending: ApprovalRequest[] = queueQuery.data?.requests || []
  const history: ApprovalRequest[] = historyQuery.data?.requests || []
  const approved = history.filter((r) => r.founder_gate_status === 'approved')
  const rejected = history.filter((r) => r.founder_gate_status === 'rejected')

  const displayRequests = activeTab === 'pending' ? pending : activeTab === 'approved' ? approved : rejected
  const isLoading = activeTab === 'pending' ? queueQuery.isLoading : historyQuery.isLoading
  const isError = activeTab === 'pending' ? queueQuery.isError : historyQuery.isError

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'pending', label: 'Pending', count: pending.length },
    { key: 'approved', label: 'Approved', count: approved.length },
    { key: 'rejected', label: 'Rejected', count: rejected.length },
  ]

  return (
    <div
      className="min-h-screen"
      style={{ background: 'radial-gradient(ellipse at 20% 0%, #fef9ec 0%, #fffbf0 40%, #fef3c7 100%)' }}
    >
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white/70 backdrop-blur-md border-b border-amber-100/80 px-6 py-3.5"
        style={{ boxShadow: '0 2px 24px rgba(146,64,14,0.08)' }}
      >
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')}>
              <ArrowLeft size={16} />
            </Button>
            <h1 className="text-xl font-semibold text-amber-950">📋 Imprest Approvals</h1>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-amber-700">
              {employee.name} ({role === 'founder' ? 'Founder' : 'Admin'})
            </span>
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              <LogOut size={16} />
            </Button>
          </div>
        </div>
      </motion.header>

      <main className="max-w-5xl mx-auto px-6 py-10">
        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b border-amber-200">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-4 py-2 font-medium text-sm border-b-2 transition ${
                activeTab === t.key
                  ? 'border-amber-600 text-amber-900'
                  : 'border-transparent text-amber-700 hover:text-amber-900'
              }`}
            >
              {t.label} ({t.count})
            </button>
          ))}
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="text-center py-10 text-amber-700 animate-pulse">Loading approvals…</div>
        )}

        {/* Error */}
        {isError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800 text-sm">
            Failed to load approvals. Check your connection and try again.
          </div>
        )}

        {/* Empty */}
        {!isLoading && !isError && displayRequests.length === 0 && (
          <div className="text-center py-10 text-amber-700">
            {activeTab === 'pending'
              ? 'No pending approvals'
              : activeTab === 'approved'
              ? 'No approved requests yet'
              : 'No rejected requests yet'}
          </div>
        )}

        {/* Cards */}
        <div className="space-y-4">
          {displayRequests.map((req) => (
            <ApprovalCard
              key={req.id}
              req={req}
              mode={activeTab}
              onApprove={handleApprove}
              onReject={handleReject}
              loading={actingId === req.id}
            />
          ))}
        </div>
      </main>
    </div>
  )
}
