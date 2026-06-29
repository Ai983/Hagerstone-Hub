import { SearchableSelect } from '../ui/SearchableSelect'
import type { Employee } from '../../types'

/** Searchable person picker over active employees. Value/onChange are employees.id
 *  (Hub PK) — the same id stored on gie_draft_tasks.suggested_assignee_employee_id. */
export function AssigneeSelect({
  employees, value, onChange,
}: {
  employees: Employee[]
  value: string | null
  onChange: (employeeId: string) => void
}) {
  const options = employees.map((e) => ({ value: e.id, label: e.name, sublabel: e.role }))
  return (
    <SearchableSelect
      options={options}
      value={value ?? ''}
      onChange={onChange}
      placeholder="Pick person"
      emptyText="No match"
      ariaLabel="Assign to"
    />
  )
}
