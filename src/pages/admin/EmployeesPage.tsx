import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { toast } from 'sonner'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Badge } from '../../components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '../../components/ui/table'
import { UserPlus, Send, Edit, UserX, ArrowLeft } from 'lucide-react'
import type { Employee, RoleId } from '../../types'

const ROLE_LABELS: Record<RoleId, string> = {
  admin: 'Admin',
  management: 'Management',
  procurement: 'Procurement',
  finance: 'Finance',
  hr: 'HR',
  project_manager: 'Project Manager',
  site_engineer: 'Site Engineer',
  ai: 'AI',
  mis: 'MIS',
  design: 'Design',
  ea: 'Executive Assistant',
  sales: 'Sales',
  crm: 'CRM',
  founder: 'Founder',
}

export function EmployeesPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')

  const { data: employees = [], isLoading } = useQuery({
    queryKey: ['employees'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Employee[]
    },
  })

  const sendOnboardingMutation = useMutation({
    mutationFn: async (employee: Employee) => {
      const { data, error } = await supabase.functions.invoke('send-onboarding', {
        body: { employee_id: employee.id, channels: ['whatsapp'] },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      return data
    },
    onSuccess: (_, employee) => {
      const msg = employee.phone
        ? `Invite sent to ${employee.name} via WhatsApp`
        : `Account created for ${employee.name} — no phone on record, share credentials manually`
      toast.success(msg)
      queryClient.invalidateQueries({ queryKey: ['employees'] })
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to send onboarding'),
  })

  const deactivateMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('employees')
        .update({ is_active: false })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Employee deactivated')
      queryClient.invalidateQueries({ queryKey: ['employees'] })
    },
  })

  const filtered = employees.filter(e => {
    const matchesSearch = search === '' ||
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      e.email.toLowerCase().includes(search.toLowerCase())
    const matchesRole = roleFilter === 'all' || e.role === roleFilter
    return matchesSearch && matchesRole
  })

  return (
    <div className="min-h-screen bg-amber-50">
      <header className="bg-white border-b border-gray-100 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')}>
              <ArrowLeft size={14} className="mr-1" /> Dashboard
            </Button>
            <span className="text-stone-300">|</span>
            <h1 className="font-semibold text-stone-800">Employee Management</h1>
          </div>
          <Button
            onClick={() => navigate('/admin/employees/add')}
            className="bg-amber-800 hover:bg-amber-700 text-sm"
          >
            <UserPlus size={14} className="mr-2" />
            Add Employee
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex gap-3 mb-6">
          <Input
            placeholder="Search by name or email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="max-w-xs bg-white"
          />
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-44 bg-white">
              <SelectValue placeholder="All roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              {Object.entries(ROLE_LABELS).map(([id, label]) => (
                <SelectItem key={id} value={id}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex-1" />
          <div className="text-sm text-stone-500 self-center">
            {filtered.length} employees
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50">
                <TableHead className="text-xs font-medium">Name</TableHead>
                <TableHead className="text-xs font-medium">Email</TableHead>
                <TableHead className="text-xs font-medium">Role</TableHead>
                <TableHead className="text-xs font-medium">Status</TableHead>
                <TableHead className="text-xs font-medium">Onboarded</TableHead>
                <TableHead className="text-xs font-medium text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-stone-400 text-sm">
                    Loading employees...
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-stone-400 text-sm">
                    No employees found
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map(emp => (
                  <TableRow key={emp.id} className="text-sm">
                    <TableCell className="font-medium text-stone-800">
                      <div>{emp.name}</div>
                      {emp.designation && (
                        <div className="text-xs text-stone-400">{emp.designation}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-stone-600">{emp.email}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs font-normal">
                        {ROLE_LABELS[emp.role]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={`text-xs font-normal ${
                          emp.is_active
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-gray-50 text-gray-500 border-gray-200'
                        }`}
                        variant="outline"
                      >
                        {emp.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-stone-400 text-xs">
                      {emp.onboarded_at
                        ? new Date(emp.onboarded_at).toLocaleDateString('en-IN')
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => navigate(`/admin/employees/${emp.id}/edit`)}
                        >
                          <Edit size={12} className="mr-1" /> Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-blue-600 hover:text-blue-700"
                          onClick={() => sendOnboardingMutation.mutate(emp)}
                          disabled={sendOnboardingMutation.isPending}
                        >
                          <Send size={12} className="mr-1" />
                          {emp.onboarded_at ? 'Resend' : 'Send Invite'}
                        </Button>
                        {emp.is_active && emp.role !== 'admin' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-red-500 hover:text-red-600"
                            onClick={() => {
                              if (confirm(`Deactivate ${emp.name}?`)) {
                                deactivateMutation.mutate(emp.id)
                              }
                            }}
                          >
                            <UserX size={12} />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </main>
    </div>
  )
}
