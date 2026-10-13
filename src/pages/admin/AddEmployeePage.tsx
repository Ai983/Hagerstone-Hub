import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { toast } from 'sonner'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import { ArrowLeft, Copy, Send, CheckCircle, AlertTriangle, Circle } from 'lucide-react'
import { edgeFunctionError } from '../../lib/edgeFunctionError'
import { MODULE_REGISTRY } from '../../config/modules'
import { ROLE_LABELS, ROLE_DEFAULT_MODULES } from '../../config/roles'
import type { RoleId, Employee } from '../../types'

// Onboarding from the UI covers the three things a new hire normally needs:
// Expense & Imprest (finance employee), Procurement (requestor / procurement
// head) and Attendance. Every other finance/CPS role, snags etc. is granted
// from Edit Employee or the backend — keeping them off this form is deliberate,
// because a half-filled role (e.g. Finance on with no role) silently suspends
// the account downstream.
const CORE_MODULES = ['finance_employee', 'cps', 'attendance'] as const

const schema = z.object({
  name: z.string().trim().min(2, 'Enter the full name'),
  email: z.string().trim().email('Enter a valid email'),
  phone: z.string().trim().regex(/^\+?[0-9 ]{10,15}$/, 'Enter a 10-digit mobile number'),
  designation: z.string().optional(),
  role: z.enum(['admin', 'management', 'procurement', 'finance', 'hr', 'project_manager', 'site_engineer', 'ai', 'mis', 'design', 'ea', 'sales', 'crm', 'founder']),
  staff_type: z.enum(['office', 'site', 'both']),
  site_id: z.string(),
  expense: z.boolean(),
  procurement: z.boolean(),
  cps_role: z.enum(['requestor', 'procurement_head']),
  attendance: z.boolean(),
}).superRefine((d, ctx) => {
  if ((d.expense || d.attendance) && d.site_id === 'none') {
    ctx.addIssue({
      code: 'custom', path: ['site_id'],
      message: 'Pick a site. Imprest is filed under it and attendance is geofenced to it.',
    })
  }
})

type FormData = z.infer<typeof schema>

type Check = { ok: boolean; warn?: boolean; text: string }

export function AddEmployeePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [createdEmployee, setCreatedEmployee] = useState<Employee | null>(null)
  const [createdTempPassword, setCreatedTempPassword] = useState<string | null>(null)
  const [linkedExisting, setLinkedExisting] = useState(false)
  const [copied, setCopied] = useState(false)

  const { register, handleSubmit, control, setValue, watch, formState: { errors, submitCount } } = useForm<FormData>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: {
      name: '', email: '', phone: '', designation: '',
      role: 'site_engineer',
      staff_type: 'site',
      site_id: 'none',
      expense: true,
      procurement: true,
      cps_role: 'requestor',
      attendance: true,
    },
  })

  const v = watch()

  // Posting pick-list. Comes from hr.sites via a SECURITY DEFINER RPC because
  // this client is bound to `public` and hr.* has RLS on.
  const { data: sites = [] } = useQuery({
    queryKey: ['attendance-sites'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('attendance_sites')
      if (error) throw error
      return (data ?? []) as { id: string; name: string }[]
    },
  })
  const siteName = sites.find(s => s.id === v.site_id)?.name

  const handleRoleChange = (role: RoleId) => {
    setValue('role', role)
    setValue('staff_type', role === 'site_engineer' ? 'site' : 'office')
  }

  // Live checklist shown beside the submit button, so the admin sees exactly
  // what the person will and won't be able to do before creating them.
  const checks: Check[] = [
    { ok: !!v.name?.trim() && !!v.email?.trim() && !!v.phone?.trim(), text: 'Name, email and phone filled' },
    v.expense || v.attendance
      ? { ok: v.site_id !== 'none', text: siteName ? `Site: ${siteName}` : 'Site not selected — required for imprest & attendance' }
      : { ok: true, warn: v.site_id === 'none', text: siteName ? `Site: ${siteName}` : 'No site (will default to Head Office)' },
    v.expense
      ? { ok: true, text: 'Can file expenses & imprest (Employee)' }
      : { ok: true, warn: true, text: 'Will NOT be able to log in to the Expense app' },
    v.procurement
      ? { ok: true, text: `Can use Procurement as ${v.cps_role === 'procurement_head' ? 'Procurement Head' : 'Requestor'}` }
      : { ok: true, warn: true, text: 'No Procurement (CPS) access' },
    v.attendance
      ? { ok: v.site_id !== 'none', text: siteName ? `Attendance marked at ${siteName}` : 'Attendance needs a site' }
      : { ok: true, warn: true, text: 'Will NOT be able to mark attendance' },
    { ok: true, warn: v.role === 'site_engineer' && v.staff_type === 'office', text: `Staff type: ${v.staff_type}` },
  ]
  const blocking = checks.filter(c => !c.ok).length

  const addEmployeeMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const site = data.site_id === 'none' ? null : sites.find(s => s.id === data.site_id) ?? null

      const { data: result, error } = await supabase.functions.invoke('admin-create-user', {
        body: {
          name: data.name.trim(),
          email: data.email.trim().toLowerCase(),
          phone: data.phone.replace(/\s/g, ''),
          designation: data.designation || null,
          role: data.role,
          // sync_module_access reads department when it first creates the finance
          // row, so without it the imprest site is stamped 'Head Office'.
          department: site?.name ?? null,
        },
      })
      if (error) throw await edgeFunctionError(error, 'Failed to create employee')
      if (result.error) throw new Error(result.error)
      const created = result as { employee: Employee; temp_password: string | null; linked_existing: boolean }

      // Core modules come from the three switches; anything else keeps the role default.
      const enabledCore: Record<string, boolean> = {
        finance_employee: data.expense,
        cps: data.procurement,
        attendance: data.attendance,
      }
      const defaults = ROLE_DEFAULT_MODULES[data.role]
      const modules = MODULE_REGISTRY.map(m => ({
        module_id: m.id,
        enabled: (CORE_MODULES as readonly string[]).includes(m.id) ? enabledCore[m.id] : defaults.includes(m.id),
      }))

      const { error: syncError } = await supabase.rpc('sync_module_access', {
        p_employee_id: created.employee.id,
        p_modules: modules,
      })
      if (syncError) throw new Error(`Access setup failed: ${syncError.message}`)

      // Role and active flag always travel together, so Finance/CPS can never
      // end up "on" with no role (which the sync treats as suspended).
      const { error: updErr } = await supabase.from('employees').update({
        staff_type: data.staff_type,
        finance_role: data.expense ? 'employee' : null,
        finance_active: data.expense,
        cps_role: data.procurement ? data.cps_role : null,
        cps_active: data.procurement,
        snag_viewer: false, snag_owner: false, snag_notify: false,
      }).eq('id', created.employee.id)
      if (updErr) throw new Error(`Saving roles failed: ${updErr.message}`)

      const { error: sysErr } = await supabase.rpc('sync_employee_systems', { p_employee_id: created.employee.id })
      if (sysErr) throw new Error(`Expense/Procurement sync failed: ${sysErr.message}`)

      // Posting + attendance profile. Runs last because it reads staff_type.
      const { error: provErr } = await supabase.rpc('provision_employee_attendance', {
        p_employee_id: created.employee.id,
        p_site_name: site?.name ?? null,
        p_home_site_id: site?.id ?? null,
      })
      if (provErr) throw new Error(`Attendance setup failed: ${provErr.message}`)

      return created
    },
    onSuccess: ({ employee, temp_password, linked_existing }) => {
      setCreatedEmployee(employee)
      setCreatedTempPassword(temp_password)
      setLinkedExisting(linked_existing)
      queryClient.invalidateQueries({ queryKey: ['employees'] })
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to create employee', { duration: 10000 }),
  })

  const sendOnboardingMutation = useMutation({
    mutationFn: async () => {
      if (!createdEmployee) return
      const { error } = await supabase.functions.invoke('send-onboarding', {
        body: {
          employee_id: createdEmployee.id,
          channels: ['whatsapp'],
        },
      })
      if (error) throw await edgeFunctionError(error, 'Failed to send onboarding message')
      await supabase
        .from('employees')
        .update({ onboarded_at: new Date().toISOString() })
        .eq('id', createdEmployee.id)
    },
    onSuccess: () => toast.success('Onboarding message sent via WhatsApp'),
    onError: (err: Error) => toast.error(err.message || 'Failed to send onboarding message'),
  })

  const copyPassword = () => {
    if (createdTempPassword) {
      navigator.clipboard.writeText(createdTempPassword)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (createdEmployee) {
    return (
      <div className="min-h-screen bg-amber-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="text-emerald-600" size={32} />
          </div>
          <h2 className="text-lg font-semibold text-stone-800 mb-1">Employee created!</h2>
          <p className="text-sm text-stone-500 mb-4">{createdEmployee.name} has been added to the Hub.</p>

          <ul className="text-left text-xs text-stone-600 bg-stone-50 rounded-xl p-3 mb-6 space-y-1">
            {checks.slice(1, 5).map((c, i) => (
              <li key={i} className="flex gap-2">
                {c.warn ? <AlertTriangle size={14} className="text-amber-500 shrink-0" /> : <CheckCircle size={14} className="text-emerald-500 shrink-0" />}
                {c.text}
              </li>
            ))}
          </ul>

          {linkedExisting ? (
            <div className="bg-emerald-50 rounded-xl p-4 mb-6 text-left">
              <p className="text-sm font-medium text-emerald-800 mb-1">Linked to existing account</p>
              <p className="text-xs text-stone-500">
                This person already has a Hagerstone login (CPS / Expense). They sign in to the Hub
                with their <span className="font-medium">existing email and password</span> — no new
                password needed.
              </p>
            </div>
          ) : createdTempPassword ? (
            <div className="bg-amber-50 rounded-xl p-4 mb-6 text-left">
              <p className="text-xs text-stone-500 mb-1">Temporary password</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm font-mono text-stone-800 bg-white border border-gray-200 rounded px-3 py-2">
                  {createdTempPassword}
                </code>
                <Button variant="outline" size="sm" onClick={copyPassword}>
                  {copied ? <CheckCircle size={14} className="text-emerald-500" /> : <Copy size={14} />}
                </Button>
              </div>
              <p className="text-xs text-stone-400 mt-2">Share this with the employee. They sign in directly with this password.</p>
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <Button
              onClick={() => sendOnboardingMutation.mutate()}
              disabled={sendOnboardingMutation.isPending}
              className="bg-amber-800 hover:bg-amber-700"
            >
              <Send size={14} className="mr-2" />
              {sendOnboardingMutation.isPending ? 'Sending...' : 'Send WhatsApp Onboarding'}
            </Button>
            <Button variant="outline" onClick={() => navigate('/admin/employees')}>
              Back to Employees
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const AccessCard = ({ name, title, hint, children }: {
    name: 'expense' | 'procurement' | 'attendance'; title: string; hint: string; children?: React.ReactNode
  }) => (
    <Controller name={name} control={control} render={({ field }) => (
      <div className={`rounded-xl border-2 p-4 transition-colors ${field.value ? 'border-amber-600 bg-amber-50/60' : 'border-stone-200 bg-white'}`}>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" className="mt-1 h-5 w-5 accent-amber-700" checked={field.value} onChange={e => field.onChange(e.target.checked)} />
          <div className="flex-1">
            <div className="text-sm font-semibold text-stone-800">{title}</div>
            <div className="text-xs text-stone-500">{hint}</div>
          </div>
        </label>
        {field.value && children && <div className="mt-3 pl-8">{children}</div>}
      </div>
    )} />
  )

  return (
    <div className="min-h-screen bg-amber-50">
      <header className="bg-white border-b border-gray-100 px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin/employees')}>
            <ArrowLeft size={14} className="mr-1" /> Employees
          </Button>
          <span className="text-stone-300">|</span>
          <h1 className="font-semibold text-stone-800">Add Employee</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
        <form onSubmit={handleSubmit(d => addEmployeeMutation.mutate(d))} className="space-y-6">
          {/* Step 1 */}
          <section className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
            <h2 className="font-medium text-stone-700 text-sm">1. Who is joining?</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Full name *</Label>
                <Input placeholder="Ravi Sharma" {...register('name')} />
                {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Email * <span className="text-stone-400 font-normal">(used to log in)</span></Label>
                <Input type="email" placeholder="ravi@gmail.com" {...register('email')} />
                {errors.email && <p className="text-xs text-red-500">{errors.email.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Mobile * <span className="text-stone-400 font-normal">(WhatsApp)</span></Label>
                <Input placeholder="98765 43210" {...register('phone')} />
                {errors.phone && <p className="text-xs text-red-500">{errors.phone.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Designation</Label>
                <Input placeholder="Site Engineer" {...register('designation')} />
              </div>
              <div className="space-y-1.5">
                <Label>Hub role *</Label>
                <Controller name="role" control={control} render={({ field }) => (
                  <Select value={field.value} onValueChange={val => handleRoleChange(val as RoleId)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(ROLE_LABELS).map(([id, label]) => (
                        <SelectItem key={id} value={id}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )} />
              </div>
              <div className="space-y-1.5">
                <Label>Works at *</Label>
                <Controller name="staff_type" control={control} render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="site">Site</SelectItem>
                      <SelectItem value="office">Office</SelectItem>
                      <SelectItem value="both">Both</SelectItem>
                    </SelectContent>
                  </Select>
                )} />
              </div>
            </div>
          </section>

          {/* Step 2 */}
          <section className="bg-white rounded-xl border border-gray-100 p-6 space-y-2">
            <h2 className="font-medium text-stone-700 text-sm">2. Which site are they posted at?</h2>
            <Controller name="site_id" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className={errors.site_id ? 'border-red-400 ring-1 ring-red-300' : ''}>
                  <SelectValue placeholder="Select site" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Select site —</SelectItem>
                  {sites.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )} />
            {errors.site_id
              ? <p className="text-xs text-red-500">{errors.site_id.message}</p>
              : <p className="text-xs text-stone-400">Their imprest is filed under this site and attendance is checked against its location. Site missing? Add it under Attendance Setup → Geofence Sites first.</p>}
          </section>

          {/* Step 3 */}
          <section className="bg-white rounded-xl border border-gray-100 p-6 space-y-3">
            <h2 className="font-medium text-stone-700 text-sm">3. What should they be able to do?</h2>
            <AccessCard name="expense" title="💰 Expenses & Imprest" hint="Log in to the Expense app, file expenses and request imprest." />
            <AccessCard name="procurement" title="📦 Procurement" hint="Raise purchase requests in CPS.">
              <Controller name="cps_role" control={control} render={({ field }) => (
                <div className="flex flex-wrap gap-2">
                  {([['requestor', 'Requestor (site engineer)'], ['procurement_head', 'Procurement Head']] as const).map(([val, label]) => (
                    <button type="button" key={val} onClick={() => field.onChange(val)}
                      className={`px-3 py-1.5 rounded-full text-xs border ${field.value === val ? 'bg-amber-700 text-white border-amber-700' : 'bg-white text-stone-600 border-stone-300'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              )} />
            </AccessCard>
            <AccessCard name="attendance" title="📍 Attendance" hint="Mark daily attendance from their phone at the selected site." />
            <p className="text-xs text-stone-400">Approver, finance team, admin and other roles are set later from Edit Employee.</p>
          </section>

          {/* Live summary */}
          <section className={`rounded-xl border p-4 ${blocking ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}>
            <h3 className="text-sm font-medium mb-2 text-stone-700">
              {blocking ? `Fix ${blocking} thing${blocking > 1 ? 's' : ''} before creating` : 'Ready to create'}
            </h3>
            <ul className="space-y-1 text-xs">
              {checks.map((c, i) => (
                <li key={i} className={`flex gap-2 ${!c.ok ? 'text-red-600 font-medium' : c.warn ? 'text-amber-700' : 'text-stone-600'}`}>
                  {!c.ok ? <Circle size={14} className="shrink-0" />
                    : c.warn ? <AlertTriangle size={14} className="shrink-0" />
                    : <CheckCircle size={14} className="text-emerald-500 shrink-0" />}
                  {c.text}
                </li>
              ))}
            </ul>
          </section>

          <div className="flex gap-3">
            <Button
              type="submit"
              className="bg-amber-800 hover:bg-amber-700 flex-1"
              disabled={addEmployeeMutation.isPending || (submitCount > 0 && blocking > 0)}
            >
              {addEmployeeMutation.isPending ? 'Creating...' : 'Create Employee'}
            </Button>
            <Button type="button" variant="outline" onClick={() => navigate('/admin/employees')}>
              Cancel
            </Button>
          </div>
        </form>
      </main>
    </div>
  )
}
