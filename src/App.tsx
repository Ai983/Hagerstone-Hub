import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { FounderDashboard } from './pages/FounderDashboard'
import { ProjectSpendDashboard } from './pages/founder/ProjectSpendDashboard'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AdminRoute } from './components/AdminRoute'
import { HeadRoute } from './components/HeadRoute'
import { FounderSpendRoute } from './components/FounderSpendRoute'
import { DelSuperRoute } from './components/DelSuperRoute'
import { EmployeesPage } from './pages/admin/EmployeesPage'
import { AddEmployeePage } from './pages/admin/AddEmployeePage'
import { EditEmployeePage } from './pages/admin/EditEmployeePage'
import { ProjectsPage } from './pages/admin/ProjectsPage'
import { MyDayPage } from './pages/delegation/MyDayPage'
import { VerifyQueuePage } from './pages/delegation/VerifyQueuePage'
import { MyPointsPage } from './pages/delegation/MyPointsPage'
import { DelegationOrgPage } from './pages/delegation/DelegationOrgPage'
import { ApprovalsPage } from './pages/ApprovalsPage'
import { LeaderboardPage } from './pages/LeaderboardPage'
import { EmployeePage } from './pages/EmployeePage'
import { LeadershipRoute } from './components/LeadershipRoute'
import { PublicAgeingReport } from './pages/PublicAgeingReport'
import { SnagRoute } from './components/SnagRoute'
import { SnagsPage } from './pages/snags/SnagsPage'
import { SnagFormPage } from './pages/snags/SnagFormPage'

const queryClient = new QueryClient()

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Toaster position="top-right" richColors />
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          {/* Genuinely public — external clients open this from a WhatsApp link
              with no login. Deliberately NOT wrapped in a guard; the per-project
              token in ?t= is the credential, checked by the snag-intake function. */}
          <Route path="/s/snag" element={<SnagFormPage />} />

          <Route path="/r/ageing" element={
            <FounderSpendRoute>
              <PublicAgeingReport />
            </FounderSpendRoute>
          } />

          <Route path="/dashboard" element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          } />

          <Route path="/founder" element={
            <ProtectedRoute>
              <FounderDashboard />
            </ProtectedRoute>
          } />

          <Route path="/founder/spend" element={
            <FounderSpendRoute>
              <ProjectSpendDashboard />
            </FounderSpendRoute>
          } />

          {/* Command Center temporarily disabled — re-enable by re-importing CommandCenterPage
              from './pages/CommandCenterPage' and restoring the DelSuperRoute wrapper */}
          <Route path="/command-center" element={<Navigate to="/" replace />} />

          <Route path="/admin/employees" element={
            <AdminRoute>
              <EmployeesPage />
            </AdminRoute>
          } />
          <Route path="/admin/employees/add" element={
            <AdminRoute>
              <AddEmployeePage />
            </AdminRoute>
          } />
          <Route path="/admin/employees/:id/edit" element={
            <AdminRoute>
              <EditEmployeePage />
            </AdminRoute>
          } />
          <Route path="/admin/projects" element={
            <AdminRoute>
              <ProjectsPage />
            </AdminRoute>
          } />

          <Route path="/delegation/my-day" element={
            <ProtectedRoute>
              <MyDayPage />
            </ProtectedRoute>
          } />

          <Route path="/delegation/verify" element={
            <HeadRoute>
              <VerifyQueuePage />
            </HeadRoute>
          } />

          <Route path="/delegation/my-points" element={
            <ProtectedRoute>
              <MyPointsPage />
            </ProtectedRoute>
          } />

          <Route path="/delegation/org" element={
            <DelSuperRoute>
              <DelegationOrgPage />
            </DelSuperRoute>
          } />

          <Route path="/approvals" element={
            <HeadRoute>
              <ApprovalsPage />
            </HeadRoute>
          } />

          <Route path="/leaderboard" element={
            <LeadershipRoute>
              <LeaderboardPage />
            </LeadershipRoute>
          } />
          <Route path="/snags" element={
            <SnagRoute>
              <SnagsPage />
            </SnagRoute>
          } />

          <Route path="/employee/:id" element={
            <ProtectedRoute>
              <EmployeePage />
            </ProtectedRoute>
          } />

          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
