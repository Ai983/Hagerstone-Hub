import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { toast } from 'sonner'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Switch } from '../../components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import { ArrowLeft } from 'lucide-react'
import { MODULE_REGISTRY } from '../../config/modules'
import { ROLE_LABELS, ROLE_DEFAULT_MODULES } from '../../config/roles'
import type { RoleId } from '../../types'

const schema = z.object({
  name: z.string().min(2, 'Name is required'),
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
  is_active: z.boolean(),
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
  ['accounts_team', 'Accounts Team'], ['design_team', 'Design Team'], ['it_head', 'IT Head'],
]

export function EditEmployeePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [moduleAccessLoaded, setModuleAccessLoaded] = useState(false)

  const { data: employee, isLoading } = useQuery({
    queryKey: ['employee', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .eq('id', id)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!id,
  })

  const { data: moduleAccess, isLoading: modulesLoading } = useQuery({
    queryKey: ['employee-modules', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employee_module_access')
        .select('module_id, can_access')
        .eq('employee_id', id)
      if (error) throw error
      return data
    },
    enabled: !!id,
  })

  const { register, handleSubmit, control, setValue, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      is_active: true,
      staff_type: 'office',
      finance_role: 'none', finance_active: true, finance_link_email: '',
      cps_role: 'none', cps_active: true, cps_link_email: '',
      module_access: MODULE_REGISTRY.map(m => ({ module_id: m.id, enabled: false })),
    },
  })

  useEffect(() => {
    if (employee && moduleAccess && !moduleAccessLoaded) {
      reset({
        name: employee.name,
        phone: employee.phone || '',
        designation: employee.designation || '',
        role: employee.role,
        staff_type: employee.staff_type ?? 'office',
        finance_role: employee.finance_role ?? 'none',
        finance_active: employee.finance_active ?? true,
        finance_link_email: employee.finance_link_email ?? '',
        cps_role: employee.cps_role ?? 'none',
        cps_active: employee.cps_active ?? true,
        cps_link_email: employee.cps_link_email ?? '',
        is_active: employee.is_active,
        module_access: MODULE_REGISTRY.map(m => ({
          module_id: m.id,
          enabled: moduleAccess.find(ma => ma.module_id === m.id)?.can_access ?? false,
        })),
      })
      setModuleAccessLoaded(true)
    }
  }, [employee, moduleAccess, moduleAccessLoaded, reset])

  const handleRoleChange = (role: RoleId) => {
    setValue('role', role)
    const defaults = ROLE_DEFAULT_MODULES[role]
    setValue('module_access', MODULE_REGISTRY.map(m => ({
      module_id: m.id,
      enabled: defaults.includes(m.id),
    })))
  }

  const updateMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const { error: empError } = await supabase
        .from('employees')
        .update({
          name: data.name,
          phone: data.phone || null,
          designation: data.designation || null,
          role: data.role,
          staff_type: data.staff_type,
          finance_role: data.finance_role === 'none' ? null : data.finance_role,
          finance_active: data.finance_active,
          finance_link_email: data.finance_link_email || null,
          cps_role: data.cps_role === 'none' ? null : data.cps_role,
          cps_active: data.cps_active,
          cps_link_email: data.cps_link_email || null,
          is_active: data.is_active,
        })
        .eq('id', id)
      if (empError) throw empError

      // Sync module flags AND provision/deactivate the user's CPS/Finance
      // profile rows under their shared auth identity (same login everywhere).
      const { error: syncError } = await supabase.rpc('sync_module_access', {
        p_employee_id: id,
        p_modules: data.module_access.map(m => ({ module_id: m.module_id, enabled: m.enabled })),
      })
      if (syncError) throw syncError

      // Hub-wins: project the chosen Finance/CPS roles + active onto the linked system rows
      const { error: sysError } = await supabase.rpc('sync_employee_systems', { p_employee_id: id })
      if (sysError) throw sysError
    },
    onSuccess: () => {
      toast.success('Employee updated successfully')
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      queryClient.invalidateQueries({ queryKey: ['employee', id] })
      navigate('/admin/employees')
    },
    // Surface what actually failed. This used to swallow the error entirely,
    // so a rejected save (RLS, a constraint, a failing sync RPC) looked
    // identical to a button that did nothing.
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e)
      console.error('Employee update failed:', e)
      toast.error(`Failed to update employee: ${msg}`)
    },
  })

  // Wait for BOTH queries. reset() below only fires once both have landed, so
  // rendering on the employee query alone showed the form with its bare
  // defaultValues — Role empty, Finance/CPS role reading "No access" — and a
  // Radix Select whose value arrives after mount keeps showing that stale
  // display. Anyone who then hit Save was submitting the placeholder values.
  if (isLoading || modulesLoading) {
    return (
      <div className="min-h-screen bg-amber-50 flex items-center justify-center">
        <div className="text-stone-400 text-sm animate-pulse">Loading...</div>
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
          <h1 className="font-semibold text-stone-800">Edit Employee</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8">
        {/* Only `name` renders its own error message, so any other invalid field
            made Save look like a dead button. Report whatever failed instead. */}
        <form
          onSubmit={handleSubmit(
            d => updateMutation.mutate(d),
            invalid => {
              const fields = Object.entries(invalid)
                .map(([field, err]) => `${field}${(err as { message?: string })?.message ? ` (${(err as { message?: string }).message})` : ''}`)
              console.error('Employee form validation failed:', invalid)
              toast.error(`Can't save — check: ${fields.join(', ')}`)
            },
          )}
          className="space-y-6"
        >
          <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-stone-700 text-sm">Personal Details</h2>
              <div className="text-xs text-stone-400">{employee?.email}</div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Full Name *</Label>
                <Input {...register('name')} />
                {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input value={employee?.email ?? ''} disabled className="bg-gray-50 text-stone-400" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input {...register('phone')} />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Controller
                  name="is_active"
                  control={control}
                  render={({ field }) => (
                    <div className="flex items-center gap-2 pt-2">
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={employee?.role === 'admin'}
                      />
                      <span className="text-sm text-stone-600">
                        {field.value ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  )}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Designation</Label>
              <Input {...register('designation')} />
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
                    disabled={employee?.role === 'admin'}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(ROLE_LABELS).map(([id, label]) => (
                        <SelectItem key={id} value={id}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {employee?.role === 'admin' && (
                <p className="text-xs text-stone-400">Admin role cannot be changed.</p>
              )}
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
              <p className="text-xs text-stone-400">Set each system's role + block here. The Hub overwrites Finance/CPS on save.</p>

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
              <Label>Module Access</Label>
              <Controller
                name="module_access"
                control={control}
                render={({ field }) => (
                  <div className="space-y-2">
                    {MODULE_REGISTRY.map((module, idx) => (
                      <div key={module.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-2">
                          <span className="text-base">{module.icon}</span>
                          <div className="text-sm font-medium text-stone-700">{module.name}</div>
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
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
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
