import type { ModuleConfig } from '../types'

export const MODULE_REGISTRY: ModuleConfig[] = [
  {
    id: 'attendance',
    name: 'Attendance',
    description: 'Daily check-in · Check-out · Attendance tracking · Leave records',
    url: 'https://hr-hiring-automation.vercel.app/attend.html',
    color: 'bg-orange-50',
    borderColor: 'border-orange-400',
    icon: '🕐',
    sso: true,
  },
  {
    id: 'finance_employee',
    name: 'Finance — Employee',
    description: 'Submit imprest requests · Track expenses · View payment status',
    // NOTE: reverted to the vercel.app URL until SSO ships. The hagerstone.com
    // domains are live, but pointing tiles at them before cookie-based SSO means
    // users logged in on the old Hub URL hit a login screen on every tile click.
    // Restore to https://m.finance.hagerstone.com as part of the SSO cutover.
    // See SSO_SINGLE_LOGIN_PLAN.md §8 risk #1.
    url: 'https://expense-automation-mobile.vercel.app',
    color: 'bg-teal-50',
    borderColor: 'border-teal-400',
    icon: '💰',
  },
  {
    id: 'finance_admin',
    name: 'Finance — Admin',
    description: 'Imprest approvals · Expense management · PO payments · Admin reports',
    // Reverted until SSO ships — see note above and SSO_SINGLE_LOGIN_PLAN.md §8.
    // Restore to https://finance.hagerstone.com at cutover.
    url: 'https://expense-automation-three.vercel.app',
    color: 'bg-emerald-50',
    borderColor: 'border-emerald-500',
    icon: '💼',
  },
  {
    id: 'cps',
    name: 'Procurement (CPS)',
    description: 'PR → RFQ → Quote → PO → GRN · Supplier management · Audit trail',
    // Reverted until SSO ships — see note above and SSO_SINGLE_LOGIN_PLAN.md §8.
    // Restore to https://cps.hagerstone.com at cutover.
    url: 'https://hagerstone-cps.vercel.app',
    color: 'bg-purple-50',
    borderColor: 'border-purple-400',
    icon: '📦',
  },
  {
    id: 'hireflow',
    name: 'HireFlow (HR)',
    description: 'Hiring pipeline · AI screening · Interviews · Onboarding',
    url: 'https://hr-hiring-automation.vercel.app',
    color: 'bg-blue-50',
    borderColor: 'border-blue-400',
    icon: '👥',
    sso: true,
  },
  {
    id: 'lcs',
    name: 'Labour & Contractor (LCS)',
    description: 'Contractors & daily-wage labour · Capture → AI verify → confirm → pay · Retention & audit',
    // TODO: confirm/replace with the real LCS Vercel URL after first deploy.
    url: 'https://hagerstone-lcs.vercel.app',
    color: 'bg-amber-50',
    borderColor: 'border-amber-500',
    icon: '👷',
  },
  {
    id: 'marketing',
    name: 'Marketing (ERP)',
    description: 'Campaigns · Client proposals · Lead tracking · Brand assets · Performance reports',
    url: 'https://hagerstone-marketing-erp.vercel.app/login',
    color: 'bg-pink-50',
    borderColor: 'border-pink-400',
    icon: '📣',
  },
  {
    id: 'scraper',
    name: 'Data Scraper',
    description: 'Web scraping · Data extraction',
    url: 'https://scraper-application-v2.vercel.app/',
    color: 'bg-indigo-50',
    borderColor: 'border-indigo-400',
    icon: '🔍',
  },
]

export const getModule = (id: string) => MODULE_REGISTRY.find(m => m.id === id)
