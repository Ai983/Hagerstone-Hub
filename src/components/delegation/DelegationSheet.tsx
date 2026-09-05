import { useState } from 'react'
import { motion } from 'framer-motion'
import { X, Plus, Trash2, Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'
import { createTask } from '../../lib/delegation'
import type { Employee } from '../../types'
import { SearchableSelect, type SearchOption } from '../ui/SearchableSelect'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { URGENCIES, URGENCY_BY_VALUE, type Urgency } from '../../lib/urgency'

interface Props {
  /** The person doing the assigning (EA / head / founder / del_super). */
  employee: Employee
  /** Active employees — builds the per-row assignee picker. */
  teamMembers: Employee[]
  onClose: () => void
  onCreated: () => void
}

interface Row {
  id: number
  title: string
  assignedTo: string
  taskDate: string
  dueTime: string
  urgency: Urgency
}

const DIRECTORS = ['Dhruv Sir', 'Bhaskar Sir']

let seq = 0
function blankRow(assignedTo: string): Row {
  seq += 1
  return {
    id: seq,
    title: '',
    assignedTo,
    taskDate: new Date().toISOString().slice(0, 10),
    dueTime: '',
    urgency: 'normal',
  }
}

/**
 * Excel-style delegation sheet. Ma'am fills rows (Kaam · Kisko · Deadline ·
 * Urgency) and hits "Assign All" — one del_tasks row per filled line. Urgency
 * replaces the old S/M/L/XL picker and rides in custom_points (Very Urgent 20 /
 * Urgent 10 / Normal 5), so the head-verify → leaderboard pipeline is unchanged.
 * Assigning to someone else fires the WhatsApp "Naya Kaam" notice via createTask.
 */
export function DelegationSheet({ employee, teamMembers, onClose, onCreated }: Props) {
  const selfUid = employee.auth_user_id ?? ''
  const isGlobal = employee.role === 'founder' || employee.role === 'admin' || employee.del_super === true
  const canAssign = !!employee.is_head || isGlobal

  const assigneeOptions: SearchOption[] = [
    { value: selfUid, label: `${employee.name} (Mujhe)` },
    ...teamMembers
      .filter((m) => m.role !== 'founder' && m.role !== 'admin' && m.auth_user_id && m.auth_user_id !== selfUid)
      .map((m) => ({ value: m.auth_user_id ?? '', label: m.name, sublabel: (m.role ?? '').replace(/_/g, ' ') })),
  ]

  const [onBehalfOf, setOnBehalfOf] = useState('')
  const [rows, setRows] = useState<Row[]>(() => [
    blankRow(canAssign ? '' : selfUid),
    blankRow(canAssign ? '' : selfUid),
    blankRow(canAssign ? '' : selfUid),
  ])
  const [saving, setSaving] = useState(false)

  const ready = rows.filter((r) => r.title.trim() && r.taskDate && (canAssign ? !!r.assignedTo : true))
  const totalPts = ready.reduce((sum, r) => sum + URGENCY_BY_VALUE[r.urgency].points, 0)

  function patchRow(id: number, p: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)))
  }
  function addRow() {
    setRows((rs) => [...rs, blankRow(canAssign ? '' : selfUid)])
  }
  function removeRow(id: number) {
    setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : rs))
  }

  async function assignAll() {
    if (ready.length === 0 || saving) return
    setSaving(true)
    const results = await Promise.allSettled(
      ready.map((r) => {
        const assignedTo = canAssign ? r.assignedTo : selfUid
        const roleGroup =
          teamMembers.find((m) => m.auth_user_id === assignedTo)?.role ?? employee.role ?? 'general'
        return createTask({
          title: r.title.trim(),
          description: '',
          type_code: '',
          task_date: r.taskDate,
          role_group: roleGroup,
          assigned_to: assignedTo,
          assigned_by: selfUid,
          custom_points: URGENCY_BY_VALUE[r.urgency].points,
          on_behalf_of: assignedTo !== selfUid && onBehalfOf ? onBehalfOf : null,
          due_time: r.dueTime || null,
        })
      }),
    )
    setSaving(false)
    const ok = results.filter((x) => x.status === 'fulfilled').length
    const fail = results.length - ok
    if (ok > 0) {
      toast.success(`${ok} kaam assign ho gaye${fail > 0 ? `, ${fail} fail hua` : ''}!`)
      onCreated()
      onClose()
    } else {
      toast.error('Koi kaam assign nahi hua — dobara koshish karein')
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
        className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl border border-stone-100 w-full sm:max-w-4xl flex flex-col max-h-[92vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
          <div>
            <h2 className="font-semibold text-stone-800">Delegation Sheet</h2>
            <p className="text-xs text-stone-400 mt-0.5">Har row = ek kaam · deadline aur urgency bharo</p>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 p-1">
            <X size={18} />
          </button>
        </div>

        {/* On-behalf-of (directors) — applies to every row assigned to someone else */}
        {canAssign && (
          <div className="px-5 pb-3 shrink-0">
            <Label className="text-xs text-stone-500 mb-1.5 block font-medium">
              Assigned by <span className="text-stone-400 font-normal">(director — optional, sab rows par lagega)</span>
            </Label>
            <select
              value={onBehalfOf}
              onChange={(e) => setOnBehalfOf(e.target.value)}
              className="w-full sm:w-64 text-sm rounded-lg border border-input bg-background px-3 py-2.5 h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            >
              <option value="">— Koi nahi —</option>
              {DIRECTORS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        )}

        {/* The sheet */}
        <div className="px-5 overflow-auto flex-1 pb-2">
          <table className="w-full text-sm border-separate border-spacing-y-1.5">
            <thead>
              <tr className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider text-left">
                <th className="w-6 pr-1 font-semibold">#</th>
                <th className="px-1 font-semibold min-w-[180px]">Kaam *</th>
                {canAssign && <th className="px-1 font-semibold min-w-[160px]">Kisko *</th>}
                <th className="px-1 font-semibold w-[140px]">Deadline</th>
                <th className="px-1 font-semibold w-[100px]">Time</th>
                <th className="px-1 font-semibold w-[140px]">Urgency</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const meta = URGENCY_BY_VALUE[r.urgency]
                return (
                  <tr key={r.id} className="align-top">
                    <td className="pr-1 pt-3 text-xs text-stone-400 tabular-nums">{i + 1}</td>
                    <td className="px-1">
                      <Input
                        value={r.title}
                        onChange={(e) => patchRow(r.id, { title: e.target.value })}
                        placeholder="Kya karna hai?"
                        className="text-sm h-10"
                      />
                    </td>
                    {canAssign && (
                      <td className="px-1">
                        <SearchableSelect
                          options={assigneeOptions}
                          value={r.assignedTo}
                          onChange={(v) => patchRow(r.id, { assignedTo: v })}
                          placeholder="Naam…"
                          emptyText="Koi nahi mila"
                        />
                      </td>
                    )}
                    <td className="px-1">
                      <Input
                        type="date"
                        value={r.taskDate}
                        onChange={(e) => patchRow(r.id, { taskDate: e.target.value })}
                        className="text-sm h-10"
                      />
                    </td>
                    <td className="px-1">
                      <Input
                        type="time"
                        value={r.dueTime}
                        onChange={(e) => patchRow(r.id, { dueTime: e.target.value })}
                        className="text-sm h-10"
                      />
                    </td>
                    <td className="px-1">
                      <select
                        value={r.urgency}
                        onChange={(e) => patchRow(r.id, { urgency: e.target.value as Urgency })}
                        className={`w-full text-sm rounded-lg border px-2 h-10 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${meta.badge}`}
                      >
                        {URGENCIES.map((u) => (
                          <option key={u.value} value={u.value}>{u.label} · {u.points}pt</option>
                        ))}
                      </select>
                    </td>
                    <td className="pt-2 text-center">
                      <button
                        type="button"
                        onClick={() => removeRow(r.id)}
                        disabled={rows.length === 1}
                        className="text-stone-300 hover:text-red-500 disabled:opacity-30 disabled:hover:text-stone-300 p-1"
                        aria-label="Remove row"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <button
            type="button"
            onClick={addRow}
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 hover:text-amber-800"
          >
            <Plus size={14} /> Aur row add karein
          </button>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-stone-100 flex items-center gap-3 shrink-0">
          <span className="text-xs text-stone-500">
            {ready.length > 0
              ? <><span className="font-semibold text-stone-700">{ready.length}</span> kaam · up to <span className="font-semibold text-stone-700">{totalPts}</span> pts</>
              : 'Kam se kam ek row bharein'}
          </span>
          <div className="flex gap-2 ml-auto">
            <Button type="button" variant="outline" onClick={onClose} className="text-sm h-11 px-5">
              Cancel
            </Button>
            <Button
              type="button"
              onClick={assignAll}
              disabled={saving || ready.length === 0}
              className="text-sm h-11 px-5 bg-amber-700 hover:bg-amber-800 text-white font-medium"
            >
              {saving
                ? <><Loader2 size={14} className="animate-spin mr-1.5" /> Assign ho raha…</>
                : <><Send size={14} className="mr-1.5" /> Assign All{ready.length > 0 ? ` (${ready.length})` : ''}</>}
            </Button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
