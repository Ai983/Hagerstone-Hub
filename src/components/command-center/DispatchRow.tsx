import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Send, Trash2, Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import { TableRow, TableCell } from '../ui/table'
import { Button } from '../ui/button'
import { AssigneeSelect } from './AssigneeSelect'
import { PointsSelect } from './PointsSelect'
import { resolveDraft } from './dispatch'
import { updateDraft, rejectDraft, dispatchDraft, type GieDraftTask } from '../../lib/gie'
import type { Employee } from '../../types'

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })
}

export function DispatchRow({
  draft, employees, assignedByAuthUid, selected, onToggleSelect,
}: {
  draft: GieDraftTask
  employees: Employee[]
  assignedByAuthUid: string
  selected: boolean
  onToggleSelect: (id: string, next: boolean) => void
}) {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  // Text fields are edited locally and saved on blur; selects save immediately.
  const [title, setTitle] = useState(draft.title)
  const [description, setDescription] = useState(draft.description ?? '')
  const [taskDate, setTaskDate] = useState(draft.task_date ?? '')
  const [dueTime, setDueTime] = useState(draft.due_time?.slice(0, 5) ?? '')

  // The row is keyed by draft.id and never remounts, so pull in server-side edits
  // (another operator, auto-dispatch) when the stored values actually change.
  useEffect(() => {
    setTitle(draft.title)
    setDescription(draft.description ?? '')
    setTaskDate(draft.task_date ?? '')
    setDueTime(draft.due_time?.slice(0, 5) ?? '')
  }, [draft.title, draft.description, draft.task_date, draft.due_time])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['gie_drafts'] })
    qc.invalidateQueries({ queryKey: ['gie_tracking'] })
  }

  const saveM = useMutation({
    mutationFn: (patch: Parameters<typeof updateDraft>[1]) => updateDraft(draft.id, patch),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not save edit'),
  })

  const rejectM = useMutation({
    mutationFn: () => rejectDraft(draft.id),
    onSuccess: () => { toast.success('Draft deleted'); invalidate() },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not delete'),
  })

  const dispatchM = useMutation({
    mutationFn: () => {
      const r = resolveDraft(draft, employees)
      if (!r.ready || !r.build) throw new Error(`Missing: ${r.missing.join(', ')}`)
      return dispatchDraft(r.build(assignedByAuthUid))
    },
    onSuccess: ({ flipped }) => {
      toast.success(flipped ? 'Dispatched · WhatsApp sent' : 'Dispatched (draft flip lagged — refresh)')
      invalidate()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Dispatch failed'),
  })

  const r = resolveDraft(draft, employees)

  return (
    <>
      <TableRow className={r.ready ? '' : 'bg-amber-50/40'}>
        {/* select */}
        <TableCell className="p-2 w-8">
          <input
            type="checkbox"
            checked={selected}
            disabled={!r.ready}
            onChange={(e) => onToggleSelect(draft.id, e.target.checked)}
            aria-label="Select row"
            className="accent-amber-600"
          />
        </TableCell>

        {/* 1 Date */}
        <TableCell className="p-2 align-top text-[11px] text-stone-500 leading-tight">{fmtDate(draft.created_at)}</TableCell>

        {/* 2 Group */}
        <TableCell className="p-2 align-top">
          <span className="block truncate rounded bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-600"
            title={draft.group?.name ?? ''}>
            {draft.group?.name ?? '—'}
          </span>
        </TableCell>

        {/* 3 Assigned by */}
        <TableCell className="p-2 align-top text-xs font-semibold text-stone-700 truncate"
          title={draft.assigned_by_name ?? draft.on_behalf_of ?? ''}>
          {draft.assigned_by_name ?? draft.on_behalf_of ?? '—'}
        </TableCell>

        {/* 4 Assigned to */}
        <TableCell className="p-2 align-top">
          <AssigneeSelect
            employees={employees}
            value={draft.suggested_assignee_employee_id}
            onChange={(empId) => {
              const emp = employees.find((e) => e.id === empId)
              saveM.mutate({
                suggested_assignee_employee_id: empId,
                role_group: draft.role_group || emp?.role || null,
                needs_info: false,
              })
            }}
          />
        </TableCell>

        {/* 5 Task details */}
        <TableCell className="p-2 align-top">
          <button onClick={() => setExpanded((v) => !v)} className="flex items-start gap-1 text-left w-full">
            {expanded ? <ChevronDown size={13} className="mt-0.5 shrink-0 text-stone-400" /> : <ChevronRight size={13} className="mt-0.5 shrink-0 text-stone-400" />}
            <span className="text-sm text-stone-800 line-clamp-2">{title}</span>
          </button>
        </TableCell>

        {/* 6 Complete by */}
        <TableCell className="p-2 align-top">
          <div className="flex flex-col gap-1">
            <input
              type="date"
              value={taskDate}
              onChange={(e) => setTaskDate(e.target.value)}
              onBlur={() => taskDate !== (draft.task_date ?? '') && saveM.mutate({ task_date: taskDate || null })}
              className={`w-full h-8 rounded-lg border px-1.5 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                taskDate ? 'border-input text-stone-800' : 'border-amber-300 text-amber-700'
              }`}
            />
            <input
              type="time"
              value={dueTime}
              onChange={(e) => setDueTime(e.target.value)}
              onBlur={() => dueTime !== (draft.due_time?.slice(0, 5) ?? '') && saveM.mutate({ due_time: dueTime || null })}
              className="w-full h-7 rounded-lg border border-input px-1.5 text-[11px] text-stone-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            />
          </div>
        </TableCell>

        {/* 7 Points */}
        <TableCell className="p-2 align-top">
          <PointsSelect value={draft.custom_points} onChange={(v) => saveM.mutate({ custom_points: v })} />
        </TableCell>

        {/* 8 Reminders (pending = —) */}
        <TableCell className="p-2 text-center text-xs text-stone-300">—</TableCell>

        {/* 9 Action */}
        <TableCell className="p-2 align-top">
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              disabled={!r.ready || dispatchM.isPending}
              onClick={() => dispatchM.mutate()}
              className="h-8 bg-amber-700 hover:bg-amber-800 text-white text-[11px] px-2 disabled:opacity-40"
              title={r.ready ? 'Dispatch' : `Needs: ${r.missing.join(', ')}`}
            >
              {dispatchM.isPending ? <Loader2 size={12} className="animate-spin" /> : <><Send size={12} className="mr-1" /> Send</>}
            </Button>
            <Button
              size="sm" variant="ghost"
              disabled={rejectM.isPending}
              onClick={() => { if (confirm(`Delete this draft?\n\n“${draft.title}”\n\nIt will be removed from the queue (no task is created, no WhatsApp is sent).`)) rejectM.mutate() }}
              className="h-8 w-7 p-0 shrink-0 text-stone-400 hover:text-red-600"
              title="Delete draft"
            >
              {rejectM.isPending ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={14} />}
            </Button>
          </div>
        </TableCell>
      </TableRow>

      {expanded && (
        <TableRow className="bg-stone-50/60">
          <TableCell colSpan={10} className="p-3">
            <div className="space-y-2 text-sm">
              <div>
                <label className="text-[11px] uppercase tracking-wide text-stone-400">Title</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={() => title.trim() && title !== draft.title && saveM.mutate({ title: title.trim() })}
                  className="mt-0.5 w-full h-9 rounded-lg border border-input px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wide text-stone-400">Details</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onBlur={() => description !== (draft.description ?? '') && saveM.mutate({ description: description || null })}
                  rows={2}
                  className="mt-0.5 w-full rounded-lg border border-input px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                />
              </div>
              {draft.source_excerpt && (
                <div>
                  <label className="text-[11px] uppercase tracking-wide text-stone-400">Original message</label>
                  <p className="mt-0.5 rounded-lg bg-white border border-stone-100 px-2 py-1.5 text-xs text-stone-500 italic">
                    “{draft.source_excerpt}”
                  </p>
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}
