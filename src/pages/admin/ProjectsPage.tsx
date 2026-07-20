import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { toast } from 'sonner'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Badge } from '../../components/ui/badge'
import { Switch } from '../../components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../../components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../../components/ui/table'
import { FolderPlus, Edit, Tag, ArrowLeft, Plus, X } from 'lucide-react'
import type { Project, ProjectAlias, ProjectCategory } from '../../types'

const CATEGORY_LABELS: Record<ProjectCategory, string> = {
  project: 'Project',
  office_region: 'Office / Region',
  other: 'Other',
}

type ProjectForm = {
  code: string
  name: string
  category: ProjectCategory
  is_active: boolean
  is_cps: boolean
  is_finance: boolean
  site_address: string
  site_incharge_name: string
  site_contact: string
}

const EMPTY_FORM: ProjectForm = {
  code: '', name: '', category: 'project',
  is_active: true, is_cps: false, is_finance: true,
  site_address: '', site_incharge_name: '', site_contact: '',
}

export function ProjectsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

  // edit/add dialog
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Project | null>(null)
  const [form, setForm] = useState<ProjectForm>(EMPTY_FORM)

  // alias dialog
  const [aliasFor, setAliasFor] = useState<Project | null>(null)
  const [newAlias, setNewAlias] = useState('')

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .order('name')
      if (error) throw error
      return data as Project[]
    },
  })

  const { data: aliases = [] } = useQuery({
    queryKey: ['project_aliases'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_aliases')
        .select('*')
        .order('alias')
      if (error) throw error
      return data as ProjectAlias[]
    },
  })

  const aliasCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of aliases) m.set(a.project_id, (m.get(a.project_id) ?? 0) + 1)
    return m
  }, [aliases])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        code: form.code.trim(),
        name: form.name.trim(),
        category: form.category,
        is_active: form.is_active,
        is_cps: form.is_cps,
        is_finance: form.is_finance,
        site_address: form.site_address.trim() || null,
        site_incharge_name: form.site_incharge_name.trim() || null,
        site_contact: form.site_contact.trim() || null,
        updated_at: new Date().toISOString(),
      }
      if (!payload.code || !payload.name) throw new Error('Code and name are required')
      if (editing) {
        const { error } = await supabase.from('projects').update(payload).eq('id', editing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('projects').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      toast.success(editing ? 'Project updated' : 'Project created')
      setFormOpen(false)
      setEditing(null)
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
    onError: (err: Error) => toast.error(err.message || 'Save failed'),
  })

  const toggleActiveMutation = useMutation({
    mutationFn: async (p: Project) => {
      const { error } = await supabase
        .from('projects')
        .update({ is_active: !p.is_active, updated_at: new Date().toISOString() })
        .eq('id', p.id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
    onError: (err: Error) => toast.error(err.message),
  })

  const addAliasMutation = useMutation({
    mutationFn: async () => {
      if (!aliasFor) return
      const alias = newAlias.trim()
      if (!alias) throw new Error('Alias cannot be empty')
      const { error } = await supabase
        .from('project_aliases')
        .insert({ project_id: aliasFor.id, alias, source: 'manual' })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Alias added')
      setNewAlias('')
      queryClient.invalidateQueries({ queryKey: ['project_aliases'] })
    },
    onError: (err: Error) =>
      toast.error(/duplicate|unique/i.test(err.message) ? 'That alias already exists' : err.message),
  })

  const removeAliasMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('project_aliases').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Alias removed')
      queryClient.invalidateQueries({ queryKey: ['project_aliases'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const openAdd = () => { setEditing(null); setForm(EMPTY_FORM); setFormOpen(true) }
  const openEdit = (p: Project) => {
    setEditing(p)
    setForm({
      code: p.code, name: p.name, category: p.category,
      is_active: p.is_active, is_cps: p.is_cps, is_finance: p.is_finance,
      site_address: p.site_address ?? '', site_incharge_name: p.site_incharge_name ?? '',
      site_contact: p.site_contact ?? '',
    })
    setFormOpen(true)
  }

  const filtered = projects.filter(p => {
    const s = search.toLowerCase()
    const matchesSearch = s === '' || p.name.toLowerCase().includes(s) || p.code.toLowerCase().includes(s)
    const matchesCat = categoryFilter === 'all' || p.category === categoryFilter
    return matchesSearch && matchesCat
  })

  const aliasesForOpen = aliasFor ? aliases.filter(a => a.project_id === aliasFor.id) : []

  return (
    <div className="min-h-screen bg-amber-50">
      <header className="bg-white border-b border-gray-100 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')}>
              <ArrowLeft size={14} className="mr-1" /> Dashboard
            </Button>
            <span className="text-stone-300">|</span>
            <h1 className="font-semibold text-stone-800">Project Management</h1>
          </div>
          <Button onClick={openAdd} className="bg-amber-800 hover:bg-amber-700 text-sm">
            <FolderPlus size={14} className="mr-2" /> Add Project
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <Input
            placeholder="Search by name or code..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full sm:w-auto sm:max-w-xs bg-white"
          />
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-48 bg-white"><SelectValue placeholder="All categories" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              <SelectItem value="project">Project</SelectItem>
              <SelectItem value="office_region">Office / Region</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex-1" />
          <div className="text-sm text-stone-500 self-center">{filtered.length} projects</div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50">
                <TableHead className="text-xs font-medium">Code</TableHead>
                <TableHead className="text-xs font-medium">Name</TableHead>
                <TableHead className="text-xs font-medium">Category</TableHead>
                <TableHead className="text-xs font-medium">Systems</TableHead>
                <TableHead className="text-xs font-medium">Aliases</TableHead>
                <TableHead className="text-xs font-medium">Active</TableHead>
                <TableHead className="text-xs font-medium text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-stone-400 text-sm">Loading projects...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-stone-400 text-sm">No projects found</TableCell></TableRow>
              ) : (
                filtered.map(p => (
                  <TableRow key={p.id} className="text-sm">
                    <TableCell className="font-mono text-xs text-stone-500">{p.code}</TableCell>
                    <TableCell className="font-medium text-stone-800">{p.name}</TableCell>
                    <TableCell className="text-stone-600 text-xs">{CATEGORY_LABELS[p.category]}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {p.is_cps && <Badge variant="secondary" className="text-[10px] font-normal">CPS</Badge>}
                        {p.is_finance && <Badge variant="secondary" className="text-[10px] font-normal">Finance</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setAliasFor(p)}>
                        <Tag size={12} className="mr-1" /> {aliasCount.get(p.id) ?? 0}
                      </Button>
                    </TableCell>
                    <TableCell>
                      <Switch checked={p.is_active} onCheckedChange={() => toggleActiveMutation.mutate(p)} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end">
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => openEdit(p)}>
                          <Edit size={12} className="mr-1" /> Edit
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </main>

      {/* Add / Edit dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Project' : 'Add Project'}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Code</Label>
              <Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="e.g. VANEET" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Category</Label>
              <Select value={form.category} onValueChange={(v) => setForm(f => ({ ...f, category: v as ProjectCategory }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="project">Project</SelectItem>
                  <SelectItem value="office_region">Office / Region</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label className="text-xs">Name</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Canonical project name" />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label className="text-xs">Site address</Label>
              <Input value={form.site_address} onChange={e => setForm(f => ({ ...f, site_address: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Site in-charge</Label>
              <Input value={form.site_incharge_name} onChange={e => setForm(f => ({ ...f, site_incharge_name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Site contact</Label>
              <Input value={form.site_contact} onChange={e => setForm(f => ({ ...f, site_contact: e.target.value }))} />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:col-span-2 pt-1">
              <label className="flex items-center gap-2 text-xs"><Switch checked={form.is_cps} onCheckedChange={(v) => setForm(f => ({ ...f, is_cps: v }))} /> In CPS</label>
              <label className="flex items-center gap-2 text-xs"><Switch checked={form.is_finance} onCheckedChange={(v) => setForm(f => ({ ...f, is_finance: v }))} /> In Finance</label>
              <label className="flex items-center gap-2 text-xs"><Switch checked={form.is_active} onCheckedChange={(v) => setForm(f => ({ ...f, is_active: v }))} /> Active</label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button className="bg-amber-800 hover:bg-amber-700" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving...' : editing ? 'Save changes' : 'Create project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Aliases dialog */}
      <Dialog open={!!aliasFor} onOpenChange={(o) => { if (!o) setAliasFor(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Aliases — {aliasFor?.name}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-stone-500 -mt-2">
            Any of these strings (finance site / CPS name / typo variant) resolves to this project.
          </p>
          <div className="flex gap-2 py-2">
            <Input
              placeholder="Add an alias..."
              value={newAlias}
              onChange={e => setNewAlias(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addAliasMutation.mutate() }}
            />
            <Button size="sm" className="bg-amber-800 hover:bg-amber-700" onClick={() => addAliasMutation.mutate()} disabled={addAliasMutation.isPending}>
              <Plus size={14} />
            </Button>
          </div>
          <div className="max-h-72 overflow-y-auto space-y-1">
            {aliasesForOpen.length === 0 ? (
              <div className="text-center py-6 text-stone-400 text-sm">No aliases yet</div>
            ) : aliasesForOpen.map(a => (
              <div key={a.id} className="flex items-center justify-between bg-gray-50 rounded px-3 py-1.5 text-sm">
                <span className="text-stone-700">{a.alias}</span>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px] font-normal">{a.source}</Badge>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-500 hover:text-red-600" onClick={() => removeAliasMutation.mutate(a.id)}>
                    <X size={12} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
