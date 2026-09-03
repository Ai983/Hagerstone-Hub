import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, Paperclip } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import {
  fetchSnags, fetchSnagEvents, fetchWaStatus,
  updateSnagStatus, addSnagComment, canManageSnags,
} from '../../lib/snags'
import {
  SNAG_STATUSES, SNAG_STATUS_LABELS, SNAG_PRIORITY_LABELS, SNAG_NEXT_STATUS,
} from '../../types/snags'
import type { Snag, SnagStatus, SnagPriority, WaStatus } from '../../types/snags'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Badge } from '../../components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '../../components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../../components/ui/table'

const STATUS_STYLES: Record<SnagStatus, string> = {
  open: 'bg-red-50 text-red-700 border-red-200',
  in_progress: 'bg-amber-50 text-amber-800 border-amber-200',
  resolved: 'bg-blue-50 text-blue-700 border-blue-200',
  closed: 'bg-stone-100 text-stone-500 border-stone-200',
}

const PRIORITY_STYLES: Record<SnagPriority, string> = {
  low: 'bg-stone-100 text-stone-600 border-stone-200',
  medium: 'bg-sky-50 text-sky-700 border-sky-200',
  high: 'bg-orange-50 text-orange-700 border-orange-200',
  urgent: 'bg-red-600 text-white border-red-600',
}

/** A queued message is not a delivered one — the gateway paces sends, so
 *  'queued' is normal for the first few seconds and only worrying if it sticks. */
const WA_LABELS: Record<WaStatus, string> = {
  queued: 'Queued', sent: 'Sent', delivered: 'Delivered', read: 'Read', failed: 'Failed',
}

function ageDays(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

export function SnagsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { employee } = useAuth()
  const canManage = canManageSnags(employee)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('open_only')
  const [priorityFilter, setPriorityFilter] = useState<string>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Deep link from the WhatsApp alert: /snags?ref=SNG-… opens that snag directly.
  // Held as a ref string because the row isn't loaded yet on first render.
  const [deepRef, setDeepRef] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('ref'),
  )
  const [note, setNote] = useState('')

  const { data: snags = [], isLoading } = useQuery({ queryKey: ['snags'], queryFn: fetchSnags })

  // Derived, not stored: the open dialog then always reflects the latest fetched
  // row (status changes, new events) without an effect syncing a copy.
  const selected = useMemo(() => {
    if (selectedId) return snags.find((s) => s.id === selectedId) ?? null
    if (deepRef) return snags.find((s) => s.ref === deepRef) ?? null
    return null
  }, [snags, selectedId, deepRef])

  const closeDialog = () => { setSelectedId(null); setDeepRef(null); setNote('') }

  const { data: events = [] } = useQuery({
    queryKey: ['snag_events', selected?.id],
    queryFn: () => fetchSnagEvents(selected!.id),
    enabled: !!selected,
  })

  const waIds = useMemo(
    () => events.filter((e) => e.wa_message_id).map((e) => e.wa_message_id!),
    [events],
  )
  const { data: waStatus = {} } = useQuery({
    queryKey: ['snag_wa', waIds],
    queryFn: () => fetchWaStatus(waIds),
    enabled: waIds.length > 0,
  })

  const statusMutation = useMutation({
    mutationFn: async ({ snag, to }: { snag: Snag; to: SnagStatus }) =>
      updateSnagStatus(snag, to, employee!.id, note),
    onSuccess: (_d, vars) => {
      toast.success(`Marked ${SNAG_STATUS_LABELS[vars.to].toLowerCase()}`)
      setNote('')
      queryClient.invalidateQueries({ queryKey: ['snags'] })
      queryClient.invalidateQueries({ queryKey: ['snag_events'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const commentMutation = useMutation({
    mutationFn: async (text: string) => addSnagComment(selected!.id, employee!.id, text),
    onSuccess: () => {
      toast.success('Note added')
      setNote('')
      queryClient.invalidateQueries({ queryKey: ['snag_events'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const filtered = snags.filter((s) => {
    const q = search.toLowerCase()
    const matchesSearch = q === ''
      || s.ref.toLowerCase().includes(q)
      || s.title.toLowerCase().includes(q)
      || s.reporter_name.toLowerCase().includes(q)
      || (s.project?.name ?? '').toLowerCase().includes(q)
    const matchesStatus =
      statusFilter === 'all' ? true
        : statusFilter === 'open_only' ? s.status !== 'closed'
          : s.status === statusFilter
    const matchesPriority = priorityFilter === 'all' || s.priority === priorityFilter
    return matchesSearch && matchesStatus && matchesPriority
  })

  const openCount = snags.filter((s) => s.status !== 'closed').length
  const urgentCount = snags.filter((s) => s.status !== 'closed' && s.priority === 'urgent').length

  const nextStatus = selected ? SNAG_NEXT_STATUS[selected.status] : null

  return (
    <div className="min-h-screen bg-amber-50">
      <header className="bg-white border-b border-gray-100 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')}>
              <ArrowLeft size={14} className="mr-1" /> Dashboard
            </Button>
            <span className="text-stone-300">|</span>
            <h1 className="font-semibold text-stone-800">Snags</h1>
          </div>
          <div className="text-xs text-stone-500">
            <span className="font-semibold text-stone-800">{openCount}</span> open
            {urgentCount > 0 && <span className="text-red-600 font-semibold"> · {urgentCount} urgent</span>}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-5 space-y-4">
        {!canManage && (
          <div className="text-xs text-stone-500 bg-white border border-stone-100 rounded-lg px-3 py-2">
            You have view-only access to snags.
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            placeholder="Search ref, title, client or project…"
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="sm:max-w-xs bg-white"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="sm:w-44 bg-white"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="open_only">Open (not closed)</SelectItem>
              <SelectItem value="all">All statuses</SelectItem>
              {SNAG_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{SNAG_STATUS_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="sm:w-40 bg-white"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              {(Object.keys(SNAG_PRIORITY_LABELS) as SnagPriority[]).map((p) => (
                <SelectItem key={p} value={p}>{SNAG_PRIORITY_LABELS[p]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="bg-white rounded-xl border border-stone-100 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ref</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Issue</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Age</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center text-stone-400 py-8 text-sm">Loading…</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-stone-400 py-8 text-sm">No snags match these filters.</TableCell></TableRow>
              ) : filtered.map((s) => (
                <TableRow
                  key={s.id} onClick={() => { setDeepRef(null); setSelectedId(s.id) }}
                  className="cursor-pointer hover:bg-amber-50/60"
                >
                  <TableCell className="font-mono text-xs text-stone-500 whitespace-nowrap">{s.ref}</TableCell>
                  <TableCell className="text-sm text-stone-700 whitespace-nowrap">{s.project?.name ?? '—'}</TableCell>
                  <TableCell className="text-sm text-stone-800 max-w-xs">
                    <span className="line-clamp-1">{s.title}</span>
                    {s.attachments.length > 0 && (
                      <span className="text-[11px] text-stone-400 inline-flex items-center gap-0.5 mt-0.5">
                        <Paperclip size={10} /> {s.attachments.length}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-stone-600 whitespace-nowrap">{s.reporter_name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-[11px] ${PRIORITY_STYLES[s.priority]}`}>
                      {SNAG_PRIORITY_LABELS[s.priority]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-[11px] ${STATUS_STYLES[s.status]}`}>
                      {SNAG_STATUS_LABELS[s.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-xs text-stone-500 whitespace-nowrap">
                    {s.status === 'closed' ? '—' : `${ageDays(s.created_at)}d`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </main>

      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) closeDialog() }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 flex-wrap pr-6">
                  <span className="font-mono text-xs text-stone-400">{selected.ref}</span>
                  <Badge variant="outline" className={`text-[11px] ${STATUS_STYLES[selected.status]}`}>
                    {SNAG_STATUS_LABELS[selected.status]}
                  </Badge>
                  <Badge variant="outline" className={`text-[11px] ${PRIORITY_STYLES[selected.priority]}`}>
                    {SNAG_PRIORITY_LABELS[selected.priority]}
                  </Badge>
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-stone-800">{selected.title}</h3>
                  <p className="text-sm text-stone-600 whitespace-pre-wrap mt-1">{selected.description}</p>
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs bg-stone-50 rounded-lg p-3">
                  <div><dt className="text-stone-400">Project</dt><dd className="text-stone-700">{selected.project?.name ?? '—'}</dd></div>
                  <div><dt className="text-stone-400">Reported</dt><dd className="text-stone-700">{fmt(selected.created_at)}</dd></div>
                  <div><dt className="text-stone-400">Client</dt><dd className="text-stone-700">{selected.reporter_name}</dd></div>
                  <div>
                    <dt className="text-stone-400">Contact</dt>
                    <dd className="text-stone-700">
                      {selected.reporter_phone
                        ? <a href={`tel:${selected.reporter_phone}`} className="text-amber-800 hover:underline">{selected.reporter_phone}</a>
                        : '—'}
                    </dd>
                  </div>
                  {selected.category && (
                    <div><dt className="text-stone-400">Area / trade</dt><dd className="text-stone-700">{selected.category}</dd></div>
                  )}
                  {selected.reporter_email && (
                    <div><dt className="text-stone-400">Email</dt><dd className="text-stone-700 truncate">{selected.reporter_email}</dd></div>
                  )}
                </dl>

                {selected.attachments.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-stone-600 mb-2">
                      Attachments ({selected.attachments.length})
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {selected.attachments.map((a, i) => (
                        <a
                          key={`${a.url}-${i}`} href={a.url} target="_blank" rel="noreferrer"
                          className="block rounded-lg border border-stone-200 overflow-hidden hover:border-amber-400 transition-colors"
                        >
                          {a.type.startsWith('image/') ? (
                            <img src={a.url} alt={a.name} className="w-full h-20 object-cover" loading="lazy" />
                          ) : (
                            <div className="w-full h-20 flex items-center justify-center bg-stone-50 text-2xl">🎬</div>
                          )}
                          <div className="text-[10px] text-stone-500 truncate px-1.5 py-1">{a.name}</div>
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {selected.resolution_note && (
                  <div className="text-xs bg-blue-50 border border-blue-100 rounded-lg p-3">
                    <div className="font-semibold text-blue-800 mb-0.5">Resolution</div>
                    <div className="text-blue-900 whitespace-pre-wrap">{selected.resolution_note}</div>
                  </div>
                )}

                <div>
                  <div className="text-xs font-semibold text-stone-600 mb-2">Activity</div>
                  <ul className="space-y-2">
                    {events.map((e) => (
                      <li key={e.id} className="text-xs flex gap-2">
                        <span className="text-stone-300 shrink-0">•</span>
                        <div className="min-w-0">
                          <span className="text-stone-700">
                            {e.event_type === 'created' && 'Reported by the client'}
                            {e.event_type === 'status_changed' && `Moved to ${SNAG_STATUS_LABELS[e.to_status as SnagStatus] ?? e.to_status}`}
                            {e.event_type === 'comment' && (e.note ?? '')}
                            {e.event_type === 'assigned' && 'Assigned'}
                            {e.event_type === 'notified' && (
                              <>
                                WhatsApp to {e.recipient_phone}
                                {e.wa_message_id && waStatus[e.wa_message_id] && (
                                  <span className={waStatus[e.wa_message_id] === 'failed' ? 'text-red-600 font-semibold' : 'text-stone-400'}>
                                    {' '}· {WA_LABELS[waStatus[e.wa_message_id]]}
                                  </span>
                                )}
                                {e.wa_message_id === null && <span className="text-red-600 font-semibold"> · Failed to send</span>}
                              </>
                            )}
                          </span>
                          {e.event_type === 'status_changed' && e.note && (
                            <div className="text-stone-500 mt-0.5 whitespace-pre-wrap">{e.note}</div>
                          )}
                          <div className="text-stone-400">
                            {fmt(e.created_at)}{e.actor?.name ? ` · ${e.actor.name}` : ''}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>

                {canManage && (
                  <div className="border-t border-stone-100 pt-4 space-y-2">
                    <textarea
                      value={note} onChange={(e) => setNote(e.target.value)}
                      placeholder={nextStatus === 'closed'
                        ? 'Closure note — what was done to fix it'
                        : 'Add a note (optional)'}
                      className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm min-h-[70px] focus:outline-none focus:ring-2 focus:ring-amber-700/30"
                    />
                    <div className="flex flex-wrap gap-2">
                      {nextStatus && (
                        <Button
                          onClick={() => statusMutation.mutate({ snag: selected, to: nextStatus })}
                          disabled={statusMutation.isPending}
                          className="bg-amber-800 hover:bg-amber-700 text-sm"
                        >
                          Mark {SNAG_STATUS_LABELS[nextStatus]}
                        </Button>
                      )}
                      <Button
                        variant="outline" className="text-sm"
                        onClick={() => note.trim() ? commentMutation.mutate(note) : toast.error('Write a note first')}
                        disabled={commentMutation.isPending}
                      >
                        Add note only
                      </Button>
                      {selected.status !== 'closed' && nextStatus !== 'closed' && (
                        <Button
                          variant="ghost" className="text-sm text-stone-500"
                          onClick={() => statusMutation.mutate({ snag: selected, to: 'closed' })}
                          disabled={statusMutation.isPending}
                        >
                          Close without fixing
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
