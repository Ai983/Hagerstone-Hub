import { useState } from 'react'
import { motion } from 'framer-motion'
import { X, Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'
import { createTask } from '../../lib/delegation'
import type { Employee } from '../../types'
import { SearchableSelect, type SearchOption } from '../ui/SearchableSelect'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'

interface Props {
  /** The EA / head / founder doing the assigning. */
  employee: Employee
  /** All active employees — used to build the assignee picker. */
  teamMembers: Employee[]
  onClose: () => void
  onCreated: () => void
}
/**
 * Simplified delegation assign dialog for the EA "Team → Delegation" board.
 * Exactly four inputs: employee (searchable), deadline date, description, Send.
 * No point/task-type picker (that catalog lives in DELEGATION-POINT-SYSTEM.md
 * and still powers the employee self-log flow on Mera Din — untouched here).
 *
 * On Send: creates a del_tasks row assigned to the chosen employee. Because
 * assigned_to !== assigned_by, createTask() fires del-notify-assign, which sends
 * the WhatsApp "Naya Kaam assign hua hai" message. Daily follow-up reminders
 * until completion are handled server-side by the del-daily-reminders engine.
 */
export function AssignTaskDialog({ employee, teamMembers, onClose, onCreated }: Props) {
  const selfUid = employee.auth_user_id ?? ''

  // Assignable people: everyone active except founders/admins and the EA herself.
  const assignable = teamMembers.filter(
    (m) => m.role !== 'founder' && m.role !== 'admin' && m.auth_user_id !== selfUid,
  )
  const employeeOptions: SearchOption[] = assignable.map((m) => ({
    value: m.auth_user_id ?? '',
    label: m.name,
    sublabel: (m.role ?? '').replace(/_/g, ' '),
  }))

  const [assignedTo, setAssignedTo] = useState('')
  const [taskDate, setTaskDate]     = useState(new Date().toISOString().slice(0, 10))
  const [description, setDescription] = useState('')
  const [saving, setSaving]         = useState(false)

  const canSubmit = !!assignedTo && !!description.trim() && !!taskDate && !saving

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    const assignee = assignable.find((m) => m.auth_user_id === assignedTo)
    const text = description.trim()
    setSaving(true)
    try {
      await createTask({
        title: text,                                   // description IS the task
        description: '',                               // stored in title; card + WhatsApp key off title
        type_code: '',                                 // no point/type in the EA flow → stored as null
        task_date: taskDate,
        role_group: assignee?.role ?? employee.role ?? 'ea',
        assigned_to: assignedTo,
        assigned_by: selfUid,
        project_id: null,
        on_behalf_of: null,
        due_time: null,
      })
      toast.success('Kaam assign ho gaya! WhatsApp notification bhej diya.')
      onCreated()
      onClose()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Kaam assign nahi hua')
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
            <p className="text-xs text-stone-400 mt-0.5">Employee chuniye, deadline aur kaam likhiye</p>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 p-1">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="px-5 space-y-4 overflow-y-auto flex-1 pb-2">

            {/* 1. Employee */}
            <div>
              <Label className="text-xs text-stone-500 mb-1.5 block font-medium">Kis employee ko? *</Label>
              <SearchableSelect
                options={employeeOptions}
                value={assignedTo}
                onChange={setAssignedTo}
                placeholder="Naam se dhundein…"
                emptyText="Koi employee nahi mila"
              />
            </div>

            {/* 2. Deadline date */}
            <div>
              <Label className="text-xs text-stone-500 mb-1.5 block font-medium">Deadline (kab tak?) *</Label>
              <Input
                type="date"
                value={taskDate}
                onChange={(e) => setTaskDate(e.target.value)}
                className="text-sm h-11"
              />
            </div>

            {/* 3. Description */}
            <div>
              <Label className="text-xs text-stone-500 mb-1.5 block font-medium">Kaam ka description *</Label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Kya kaam assign kar rahe hain? Poora detail likhiye…"
                rows={5}
                className="w-full text-sm rounded-lg border border-input bg-background px-3 py-2.5 leading-relaxed resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="px-5 py-4 border-t border-stone-100 flex gap-2 shrink-0">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1 text-sm h-11">
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit}
              className="flex-1 text-sm h-11 bg-amber-700 hover:bg-amber-800 text-white font-medium"
            >
              {saving
                ? <><Loader2 size={14} className="animate-spin mr-1.5" /> Bhej rahe hain…</>
                : <><Send size={14} className="mr-1.5" /> Send</>}
            </Button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}
