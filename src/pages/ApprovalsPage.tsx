import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button } from '../components/ui/button'
import { ArrowLeft, LogOut, ChevronDown } from 'lucide-react'
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
  submitted_at: string
  approval_route: string
  s1_note?: string
  s2_note?: string
  s3_note?: string
  director_note?: string
  founder_rejection_count: number
  founder_gate_comment?: string
  founder_gate_status?: 'approved' | 'rejected'
  founder_gate_reviewed_at?: string
}

const FINANCE_API = import.meta.env.VITE_FINANCE_API_URL || 'http://localhost:4000'

async function fetchFounderQueue(token: string) {
  const response = await fetch(`${FINANCE_API}/api/imprest/founder/queue`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`)
  return response.json()
}

async function approveGate(id: string, comment: string, token: string) {
  const response = await fetch(`${FINANCE_API}/api/imprest/${id}/founder-gate-approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ founderGateComment: comment }),
  })
  if (!response.ok) throw new Error(`Failed to approve: ${response.statusText}`)
  return response.json()
}

async function rejectGate(id: string, comment: string, token: string) {
  if (!comment?.trim()) throw new Error('Rejection comment is required')
  const response = await fetch(`${FINANCE_API}/api/imprest/${id}/founder-gate-reject`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ founderGateComment: comment }),
  })
  if (!response.ok) throw new Error(`Failed to reject: ${response.statusText}`)
  return response.json()
}

function ApprovalCard({
  req,
  isReviewed,
  onApprove,
  onReject,
  loading,
}: {
  req: ApprovalRequest
  isReviewed: boolean
  onApprove: (id: string, comment: string) => void
  onReject: (id: string, comment: string) => void
  loading: boolean
}) {
  const [comment, setComment] = useState('')
  const [showNotes, setShowNotes] = useState(false)
  const daysAgo = Math.floor((Date.now() - new Date(req.submitted_at).getTime()) / (24 * 60 * 60 * 1000))
  const route = req.approval_route === 'avisha_finance_founder' ? '🟡 Route A' : '🔴 Route B'

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="border border-amber-200 rounded-lg p-5 bg-white/60 backdrop-blur-sm hover:shadow-md transition-shadow"
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="font-semibold text-amber-950">{req.ref_id}</div>
          <div className="text-sm text-amber-700 mt-1">
            ₹{req.approved_amount?.toLocaleString('en-IN') || req.amount_requested?.toLocaleString('en-IN')} • {req.employee?.name || '—'} • {req.site}
          </div>
        </div>
        <span className="text-xs font-medium bg-amber-100 text-amber-800 px-2 py-1 rounded">
          {route}
        </span>
      </div>

      <div className="text-sm text-amber-800 mb-3">
        <div className="font-medium">{req.category}</div>
        <div className="text-xs text-amber-700 mt-1">{req.purpose}</div>
        <div className="text-xs text-amber-600 mt-2">{daysAgo} days ago</div>
      </div>

      {req.founder_rejection_count > 0 && (
        <div className="bg-red-50 border border-red-200 rounded p-2 mb-3">
          <div className="text-xs font-semibold text-red-800">⚠️ Rejected {req.founder_rejection_count} time(s)</div>
          <div className="text-xs text-red-700 mt-1">{req.founder_gate_comment}</div>
        </div>
      )}

      {/* Stage Notes Accordion */}
      <button
        onClick={() => setShowNotes(!showNotes)}
        className="w-full flex items-center justify-between text-xs font-medium text-amber-800 py-2 px-2 hover:bg-amber-50 rounded mb-3"
      >
        <span>📝 Stage Notes</span>
        <ChevronDown size={14} className={`transition-transform ${showNotes ? 'rotate-180' : ''}`} />
      </button>

      {showNotes && (
        <div className="bg-amber-50 rounded p-3 mb-3 space-y-2 text-xs">
          {req.s1_note && <div><span className="font-semibold text-amber-900">✅ S1 (Avisha):</span> {req.s1_note}</div>}
          {req.director_note && <div><span className="font-semibold text-amber-900">✅ Director:</span> {req.director_note}</div>}
          {req.s2_note && <div><span className="font-semibold text-amber-900">✅ S2:</span> {req.s2_note}</div>}
          {req.s3_note && <div><span className="font-semibold text-amber-900">✅ Finance (S3):</span> {req.s3_note}</div>}
          {!req.s1_note && !req.s2_note && !req.s3_note && !req.director_note && (
            <div className="text-amber-600 italic">No notes recorded</div>
          )}
        </div>
      )}

      {!isReviewed && (
        <>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Add a comment (optional)"
            rows={2}
            className="w-full text-xs p-2 border border-amber-200 rounded mb-3 focus:outline-none focus:ring-2 focus:ring-amber-400"
          />

          <div className="flex gap-2">
            <button
              onClick={() => onApprove(req.id, comment)}
              disabled={loading}
              className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-xs font-medium py-2 rounded transition"
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
              className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-medium py-2 rounded transition"
            >
              {loading ? '…' : '❌ REJECT'}
            </button>
          </div>
        </>
      )}

      {isReviewed && (
        <div className="bg-amber-50 rounded p-3 text-xs">
          <div className="font-semibold text-amber-900 mb-1">
            {req.founder_gate_status === 'approved' ? '✅ Approved' : '❌ Rejected'}
          </div>
          <div className="text-amber-700">
            {new Date(req.founder_gate_reviewed_at!).toLocaleDateString('en-IN')}
          </div>
          {req.founder_gate_comment && (
            <div className="text-amber-700 mt-2 italic">"{req.founder_gate_comment}"</div>
          )}
        </div>
      )}
    </motion.div>
  )
}

export function ApprovalsPage() {
  const { employee, signOut } = useAuth()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<'pending' | 'reviewed'>('pending')
  const [actingId, setActingId] = useState<string | null>(null)

  const queueQuery = useQuery({
    queryKey: ['imprest_founder_queue'],
    queryFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData.session) throw new Error('No session')
      return fetchFounderQueue(sessionData.session.access_token)
    },
    refetchInterval: 30000,
  })

  const handleApprove = async (id: string, comment: string) => {
    try {
      setActingId(id)
      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData.session) throw new Error('No session')
      await approveGate(id, comment, sessionData.session.access_token)
      toast.success('Approved!')
      queueQuery.refetch()
    } catch (err: any) {
      toast.error(err.message)
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
      queueQuery.refetch()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setActingId(null)
    }
  }

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const role = employee?.role
  const allowed = role === 'founder' || role === 'admin'

  if (!employee) return null
  if (!allowed) {
    navigate('/dashboard')
    return null
  }

  const requests = queueQuery.data?.requests || []
  const pending = requests.filter((r: ApprovalRequest) => !r.founder_gate_status)
  const reviewed = requests.filter((r: ApprovalRequest) => r.founder_gate_status)

  const displayRequests = activeTab === 'pending' ? pending : reviewed

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
          <button
            onClick={() => setActiveTab('pending')}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition ${
              activeTab === 'pending'
                ? 'border-amber-600 text-amber-900'
                : 'border-transparent text-amber-700 hover:text-amber-900'
            }`}
          >
            Pending ({pending.length})
          </button>
          <button
            onClick={() => setActiveTab('reviewed')}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition ${
              activeTab === 'reviewed'
                ? 'border-amber-600 text-amber-900'
                : 'border-transparent text-amber-700 hover:text-amber-900'
            }`}
          >
            Reviewed ({reviewed.length})
          </button>
        </div>

        {/* Loading */}
        {queueQuery.isLoading && (
          <div className="text-center py-10 text-amber-700 animate-pulse">Loading approvals…</div>
        )}

        {/* Error */}
        {queueQuery.isError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800 text-sm">
            Failed to load approvals. Check your connection and try again.
          </div>
        )}

        {/* Empty */}
        {!queueQuery.isLoading && displayRequests.length === 0 && (
          <div className="text-center py-10 text-amber-700">
            {activeTab === 'pending' ? 'No pending approvals' : 'No reviewed approvals yet'}
          </div>
        )}

        {/* Cards */}
        <div className="space-y-4">
          {displayRequests.map((req: ApprovalRequest) => (
            <ApprovalCard
              key={req.id}
              req={req}
              isReviewed={activeTab === 'reviewed'}
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
