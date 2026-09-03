import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { toast } from 'sonner'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Switch } from '../../components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import { ArrowLeft, Copy, Send, CheckCircle } from 'lucide-react'
import { MODULE_REGISTRY } from '../../config/modules'
import { ROLE_LABELS, ROLE_DEFAULT_MODULES } from '../../config/roles'
import type { RoleId, Employee } from '../../types'

const schema = z.object({
  name: z.string().min(2, 'Name is required'),
  email: z.string().email('Enter a valid email'),
  phone: z.string().optional(),
  designation: z.string().optional(),
  role: z.enum(['admin', 'management', 'procurement', 'finance', 'hr', 'project_manager', 'site_engineer', 'ai', 'mis', 'design', 'ea', 'sales', 'crm', 'founder']),
  staff_type: z.enum(['office', 'site', 'both']),
  finance_role: z.string(),
  finance_active: z.boolean(),
  finance_link_email: z.string().optional(),
  cps_role: z.string(),
  cps_active: z.boolean(),
  cps_link_email: z.string().optional(),
  snag_viewer: z.boolean(),
  snag_owner: z.boolean(),
  snag_notify: z.boolean(),
  module_access: z.array(z.object({
    module_id: z.string(),
    enabled: z.boolean(),
  })),
})

type FormData = z.infer<typeof schema>

// 'none' = no access (Radix Select disallows empty value); mapped to null on save.
const FINANCE_ROLE_OPTS: [string, string][] = [
  ['none', 'No access'], ['employee', 'Employee'], ['approver_s1', 'S1 approver'], ['approver_s2', 'S2 approver'],
  ['finance', 'Finance'], ['manager', 'Manager'], ['head', 'Head'], ['founder', 'Founder'],
]
const CPS_ROLE_OPTS: [string, string][] = [
  ['none', 'No access'], ['requestor', 'Requestor'], ['procurement_head', 'Procurement Head'], ['management', 'Management'],
  ['accounts_team', 'Accounts Team'], ['design_team', 'Design Team'], ['it_head', 'IT Head'], ['vendor_registrar', 'Vendor Registration'],
]

export function AddEmployeePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [createdEmployee, setCreatedEmployee] = useState<Employee | null>(null)
  const [createdTempPassword, setCreatedTempPassword] = useState<string | null>(null)
  const [linkedExisting, setLinkedExisting] = useState(false)
  const [copied, setCopied] = useState(false)

  const { register, handleSubmit, control, setValue, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      role: 'site_engineer',
      staff_type: 'site',
      finance_role: 'none', finance_active: true, finance_link_email: '',
      cps_role: 'none', cps_active: true, cps_link_email: '',
      snag_viewer: false, snag_owner: false, snag_notify: false,
      module_access: MODULE_REGISTRY.map(m => ({
        module_id: m.id,
        enabled: ROLE_DEFAULT_MODULES['site_engineer'].includes(m.id),
      })),
    },
  })

  const handleRoleChange = (role: RoleId) => {
    setValue('role', role)
    setValue('staff_type', role === 'site_engineer' ? 'site' : 'office')
    const defaults = ROLE_DEFAULT_MODULES[role]
    setValue('module_access', MODULE_REGISTRY.map(m => ({
      module_id: m.id,
      enabled: defaults.includes(m.id),
    })))
  }

  const addEmployeeMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const { data: result, error } = await supabase.functions.invoke('admin-create-user', {
        body: {
          name: data.name,
          email: data.email,
          phone: data.phone || null,
          designation: data.designation || null,
          role: data.role,
        },
      })
      if (error) throw error
      if (result.error) throw new Error(result.error)
      const created = result as { employee: Employee; temp_password: string | null; linked_existing: boolean }

      // Provision module access + cross-schema profile rows under the shared identity.
      const { error: syncError } = await supabase.rpc('sync_module_access', {
        p_employee_id: created.employee.id,
        p_modules: data.module_access.map(m => ({ module_id: m.module_id, enabled: m.enabled })),
      })
      if (syncError) throw syncError

      // Office/Site classification + Hub-authoritative per-system roles
      await supabase.from('employees').update({
        staff_type: data.staff_type,
        finance_role: data.finance_role === 'none' ? null : data.finance_role,
        finance_active: data.finance_active,
        finance_link_email: data.finance_link_email || null,
        cps_role: data.cps_role === 'none' ? null : data.cps_role,
        cps_active: data.cps_active,
        cps_link_email: data.cps_link_email || null,
        snag_viewer: data.snag_viewer,
        snag_owner: data.snag_owner,
        snag_notify: data.snag_notify,
      }).eq('id', created.employee.id)
      await supabase.rpc('sync_employee_systems', { p_employee_id: created.employee.id })

      return created
    },
    onSuccess: ({ employee, temp_password, linked_existing }) => {
      setCreatedEmployee(employee)
      setCreatedTempPassword(temp_password)
      setLinkedExisting(linked_existing)
      queryClient.invalidateQueries({ queryKey: ['employees'] })
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to create employee'),
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
      if (error) throw error
      await supabase
        .from('employees')
        .update({ onboarded_at: new Date().toISOString() })
        .eq('id', createdEmployee.id)
    },
    onSuccess: () => toast.success('Onboarding message sent via WhatsApp'),
    onError: () => toast.error('Failed to send onboarding message'),
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
          <p className="text-sm text-stone-500 mb-6">{createdEmployee.name} has been added to the Hub.</p>

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

      <main className="max-w-2xl mx-auto px-6 py-8">
        <form onSubmit={handleSubmit(d => addEmployeeMutation.mutate(d))} className="space-y-6">
          <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
            <h2 className="font-medium text-stone-700 text-sm">Personal Details</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Full Name *</Label>
                <Input placeholder="Ravi Sharma" {...register('name')} />
                {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Email *</Label>
                <Input type="email" placeholder="ravi@hagerstone.com" {...register('email')} />
                {errors.email && <p className="text-xs text-red-500">{errors.email.message}</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input placeholder="+91 98765 43210" {...register('phone')} />
              </div>
              <div className="space-y-1.5">
                <Label>Employee Code</Label>
                <Input placeholder="Auto-assigned (HAG-XXX)" disabled className="bg-gray-50 text-stone-400" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Designation</Label>
                <Input placeholder="Site Engineer" {...register('designation')} />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
            <h2 className="font-medium text-stone-700 text-sm">Role & Access</h2>

            <div className="space-y-1.5">
              <Label>Role *</Label>
              <Controller
                name="role"
                control={control}
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(val) => handleRoleChange(val as RoleId)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(ROLE_LABELS).map(([id, label]) => (
                        <SelectItem key={id} value={id}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Staff type *</Label>
              <Controller
                name="staff_type"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Office / Site / Both" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="office">Office staff</SelectItem>
                      <SelectItem value="site">Site staff</SelectItem>
                      <SelectItem value="both">Both</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
              <p className="text-xs text-stone-400">Used for follow-up frequency (office = daily, site = weekly).</p>
            </div>

            {/* System Access & Roles — Hub-authoritative; synced to Finance/CPS on save */}
            <div className="space-y-3 border-t border-stone-100 pt-4">
              <Label className="text-sm">System Access &amp; Roles</Label>
              <p className="text-xs text-stone-400">Finance/CPS roles apply once that module is enabled below (and the system account exists).</p>

              <div className="rounded-lg border border-stone-100 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-stone-700">💰 Finance</span>
                  <Controller name="finance_active" control={control} render={({ field }) => (
                    <label className="flex items-center gap-2 text-xs text-stone-500">
                      {field.value ? 'Active' : 'Blocked'}
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </label>
                  )} />
                </div>
                <Controller name="finance_role" control={control} render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue placeholder="No access" /></SelectTrigger>
                    <SelectContent>
                      {FINANCE_ROLE_OPTS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )} />
                <Input placeholder="Linked Finance email (only if different)" {...register('finance_link_email')} className="text-xs" />
              </div>

              <div className="rounded-lg border border-stone-100 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-stone-700">📦 CPS (Procurement)</span>
                  <Controller name="cps_active" control={control} render={({ field }) => (
                    <label className="flex items-center gap-2 text-xs text-stone-500">
                      {field.value ? 'Active' : 'Blocked'}
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </label>
                  )} />
                </div>
                <Controller name="cps_role" control={control} render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue placeholder="No access" /></SelectTrigger>
                    <SelectContent>
                      {CPS_ROLE_OPTS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )} />
                <Input placeholder="Linked CPS email (only if different)" {...register('cps_link_email')} className="text-xs" />
              </div>
            </div>

            <div className="space-y-3">
              <Label>Snags</Label>
              <p className="text-xs text-stone-400">
                Post-handover client defect reports. Off by default — most people
                don't need it, and it can be granted later from Edit Employee.
              </p>
              <div className="space-y-2">
                {([
                  ['snag_viewer', 'View snags', 'Can open the Snags page (read-only).'],
                  ['snag_owner', 'Manage snags', 'Can update status, add notes and close. Implies view.'],
                  ['snag_notify', 'WhatsApp alerts', 'Gets a WhatsApp when a client submits a new snag.'],
                ] as const).map(([name, label, hint]) => (
                  <Controller key={name} name={name} control={control} render={({ field }) => (
                    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg gap-3">
                      <div>
                        <div className="text-sm font-medium text-stone-700">{label}</div>
                        <div className="text-xs text-stone-500">{hint}</div>
                      </div>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </div>
                  )} />
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <Label>Module Access</Label>
              <p className="text-xs text-stone-400">
                Pre-filled based on role. Toggle to override.
              </p>
              <Controller
                name="module_access"
                control={control}
                render={({ field }) => (
                  <div className="space-y-2">
                    {MODULE_REGISTRY.map((module, idx) => (
                      <div key={module.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-2">
                          <span className="text-base">{module.icon}</span>
                          <div>
                            <div className="text-sm font-medium text-stone-700">{module.name}</div>
                          </div>
                        </div>
                        <Switch
                          checked={field.value[idx]?.enabled ?? false}
                          onCheckedChange={(checked) => {
                            const updated = [...field.value]
                            updated[idx] = { ...updated[idx], enabled: checked }
                            field.onChange(updated)
                          }}
                        />
                      </div>
                    ))}
                  </div>
                )}
              />
            </div>
          </div>

          <div className="flex gap-3">
            <Button
              type="submit"
              className="bg-amber-800 hover:bg-amber-700 flex-1"
              disabled={addEmployeeMutation.isPending}
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
