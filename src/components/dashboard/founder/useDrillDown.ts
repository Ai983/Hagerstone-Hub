import { useState, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'
import type { DrillConfig, DrillColumn, DrillChart } from './DrillDownModal'
import { fmt } from './DrillDownModal'

type DrillState = { config: DrillConfig | null }

// ─── expense drill ─────────────────────────────────────────────────────────────
export async function fetchExpenseDrill(
  period: string,
  { site, category, employeeId }: { site?: string; category?: string; employeeId?: string },
): Promise<DrillConfig> {
  const params: Record<string, unknown> = { p_period: period, p_limit: 150 }
  if (site) params.p_site = site
  if (category) params.p_category = category
  if (employeeId) params.p_employee_id = employeeId

  const { data, error } = await supabase.rpc('founder_drill_expenses', params)
  if (error) throw error

  const rows = (data ?? []) as Record<string, unknown>[]

  // build mini chart: top 8 categories (or sites if filtering by category)
  const groupKey = category ? 'site' : 'category'
  const agg: Record<string, number> = {}
  for (const r of rows) {
    const k = String(r[groupKey] ?? 'Other')
    agg[k] = (agg[k] ?? 0) + Number(r.amount ?? 0)
  }
  const sorted = Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 8)

  const AMBER = ['#92400e','#b45309','#d97706','#f59e0b','#fbbf24','#fcd34d','#fde68a','#fffbeb']
  const chart: DrillChart = {
    type: 'bar',
    labels: sorted.map(([k]) => k.length > 20 ? k.slice(0, 18) + '…' : k),
    datasets: [{ data: sorted.map(([, v]) => v), backgroundColor: AMBER, borderRadius: 4 }],
    tooltipFmt: fmt.inr,
  }

  const columns: DrillColumn[] = [
    { key: 'submitted_at', label: 'Date', format: fmt.dateTime },
    { key: 'employee_name', label: 'Employee' },
    { key: 'site', label: 'Site' },
    { key: 'category', label: 'Category' },
    { key: 'amount', label: 'Amount', align: 'right', format: fmt.inr },
    { key: 'status', label: 'Status', format: fmt.status },
    { key: 'description', label: 'Description' },
  ]

  const total = rows.reduce((s, r) => s + Number(r.amount ?? 0), 0)
  const subtitle = `${rows.length} expenses · Total: ${fmt.inr(total)}`

  return {
    title: category ? `Expenses — ${category}` : site ? `Expenses — ${site}` : 'All Expenses',
    subtitle,
    chart,
    columns,
    rows,
  }
}

// ─── PO drill ──────────────────────────────────────────────────────────────────
export async function fetchPoDrill(
  period: string,
  { project, vendor, status }: { project?: string; vendor?: string; status?: string },
): Promise<DrillConfig> {
  const params: Record<string, unknown> = { p_period: period, p_limit: 150 }
  if (project) params.p_project = project
  // Skip vendor filter if name is our null-fallback placeholder
  if (vendor && vendor !== '—' && vendor !== '-') params.p_vendor = vendor
  if (status) params.p_status = status

  const { data, error } = await supabase.rpc('founder_drill_pos', params)
  if (error) throw error

  const rows = (data ?? []) as Record<string, unknown>[]

  const agg: Record<string, number> = {}
  const groupKey = project ? 'vendor_name' : 'project_name'
  for (const r of rows) {
    const k = String(r[groupKey] ?? '—')
    agg[k] = (agg[k] ?? 0) + Number(r.grand_total ?? 0)
  }
  const sorted = Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 8)
  const COLORS = ['#92400e','#b45309','#d97706','#f59e0b','#fbbf24','#fcd34d','#fde68a','#fffbeb']

  const chart: DrillChart = {
    type: 'bar',
    labels: sorted.map(([k]) => k.length > 22 ? k.slice(0, 20) + '…' : k),
    datasets: [{ data: sorted.map(([, v]) => v), backgroundColor: COLORS, borderRadius: 4 }],
    tooltipFmt: fmt.inr,
  }

  const columns: DrillColumn[] = [
    { key: 'po_number', label: 'PO #' },
    { key: 'created_at', label: 'Date', format: fmt.date },
    { key: 'project_name', label: 'Project' },
    { key: 'vendor_name', label: 'Vendor' },
    { key: 'grand_total', label: 'Value', align: 'right', format: fmt.inr },
    { key: 'status', label: 'Status', format: fmt.status },
    { key: 'delivery_date', label: 'Delivery', format: fmt.date },
  ]

  const total = rows.reduce((s, r) => s + Number(r.grand_total ?? 0), 0)
  const subtitle = `${rows.length} purchase orders · Total: ${fmt.inr(total)}`

  const vendorLabel = vendor && vendor !== '—' && vendor !== '-' ? ` — ${vendor}` : ''
  return {
    title: project ? `POs — ${project}` : vendorLabel ? `POs${vendorLabel}` : status ? `POs — ${fmt.status(status)}` : 'All Purchase Orders',
    subtitle,
    chart,
    columns,
    rows,
  }
}

// ─── PR drill ──────────────────────────────────────────────────────────────────
export async function fetchPrDrill(
  period: string,
  { status, project }: { status?: string; project?: string },
): Promise<DrillConfig> {
  const params: Record<string, unknown> = { p_period: period, p_limit: 150 }
  if (status) params.p_status = status
  if (project) params.p_project = project

  const { data, error } = await supabase.rpc('founder_drill_prs', params)
  if (error) throw error

  const rows = (data ?? []) as Record<string, unknown>[]

  const agg: Record<string, number> = {}
  for (const r of rows) {
    const k = String(r.project_name ?? r.project_code ?? 'Unknown')
    agg[k] = (agg[k] ?? 0) + 1
  }
  const sorted = Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 8)
  const COLORS = ['#92400e','#b45309','#d97706','#f59e0b','#fbbf24','#fcd34d','#fde68a','#fffbeb']

  const chart: DrillChart = {
    type: 'bar',
    labels: sorted.map(([k]) => k.length > 22 ? k.slice(0, 20) + '…' : k),
    datasets: [{ data: sorted.map(([, v]) => v), backgroundColor: COLORS, borderRadius: 4 }],
  }

  const columns: DrillColumn[] = [
    { key: 'pr_number', label: 'PR #' },
    { key: 'created_at', label: 'Date', format: fmt.date },
    { key: 'project_name', label: 'Project' },
    { key: 'requested_by', label: 'Requested By' },
    { key: 'status', label: 'Status', format: fmt.status },
    { key: 'priority', label: 'Priority' },
    { key: 'required_by', label: 'Required By', format: fmt.date },
    { key: 'notes', label: 'Notes' },
  ]

  return {
    title: status ? `PRs — ${fmt.status(status)}` : project ? `PRs — ${project}` : 'All Requisitions',
    subtitle: `${rows.length} purchase requisitions`,
    chart,
    columns,
    rows,
  }
}

// ─── Task drill ────────────────────────────────────────────────────────────────
export async function fetchTaskDrill(
  period: string,
  { status, personId, roleGroup }: { status?: string; personId?: string; roleGroup?: string },
): Promise<DrillConfig> {
  const params: Record<string, unknown> = { p_period: period, p_limit: 150 }
  if (status) params.p_status = status
  if (personId) params.p_person_id = personId
  if (roleGroup) params.p_role_group = roleGroup

  const { data, error } = await supabase.rpc('founder_drill_tasks', params)
  if (error) throw error

  const rows = (data ?? []) as Record<string, unknown>[]

  // Status breakdown chart for the drill
  const statusAgg: Record<string, number> = {}
  for (const r of rows) {
    const k = String(r.status ?? 'unknown')
    statusAgg[k] = (statusAgg[k] ?? 0) + 1
  }
  const statusColors: Record<string, string> = {
    completed: '#16a34a', under_review: '#f59e0b',
    submitted: '#6366f1', assigned: '#94a3b8',
  }
  const statusEntries = Object.entries(statusAgg).sort((a, b) => b[1] - a[1])

  const chart: DrillChart = {
    type: 'doughnut',
    labels: statusEntries.map(([k]) => k.replace(/_/g, ' ')),
    datasets: [{
      data: statusEntries.map(([, v]) => v),
      backgroundColor: statusEntries.map(([k]) => statusColors[k] ?? '#9ca3af'),
    }],
  }

  const columns: DrillColumn[] = [
    { key: 'task_date', label: 'Date', format: fmt.date },
    { key: 'title', label: 'Task' },
    { key: 'assigned_name', label: 'Assigned To' },
    { key: 'role', label: 'Role' },
    { key: 'role_group', label: 'Team' },
    { key: 'type_code', label: 'Type' },
    { key: 'status', label: 'Status', format: fmt.status },
    { key: 'submitted_at', label: 'Submitted', format: fmt.dateTime },
    { key: 'on_time', label: 'On Time', align: 'center', format: (v) => v ? '✅' : '—' },
  ]

  const label = status
    ? `Tasks — ${fmt.status(status)}`
    : roleGroup
    ? `Tasks — Team: ${roleGroup}`
    : 'All Tasks'

  return {
    title: label,
    subtitle: `${rows.length} tasks`,
    chart,
    columns,
    rows,
  }
}

// ─── extract readable message from any thrown value ───────────────────────────
function toMsg(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>
    return String(o.message ?? o.details ?? o.hint ?? o.code ?? JSON.stringify(err))
  }
  return String(err ?? 'Unknown error')
}

// ─── hook ──────────────────────────────────────────────────────────────────────
export function useDrillDown() {
  const [state, setState] = useState<DrillState>({ config: null })

  const open = useCallback(async (loader: () => Promise<DrillConfig>) => {
    setState({ config: { title: 'Loading…', columns: [], rows: [], loading: true } })
    try {
      const config = await loader()
      setState({ config })
    } catch (err) {
      setState({ config: { title: 'Error loading data', subtitle: toMsg(err), columns: [], rows: [] } })
    }
  }, [])

  const close = useCallback(() => setState({ config: null }), [])

  return { drillConfig: state.config, openDrill: open, closeDrill: close }
}
