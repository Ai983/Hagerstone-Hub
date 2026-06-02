import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { FounderDashboard } from './pages/FounderDashboard'
import { PasswordChangePage } from './components/PasswordChangeModal'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AdminRoute } from './components/AdminRoute'
import { HeadRoute } from './components/HeadRoute'
import { EmployeesPage } from './pages/admin/EmployeesPage'
import { AddEmployeePage } from './pages/admin/AddEmployeePage'
import { EditEmployeePage } from './pages/admin/EditEmployeePage'
import { MyDayPage } from './pages/delegation/MyDayPage'
import { VerifyQueuePage } from './pages/delegation/VerifyQueuePage'
import { MyPointsPage } from './pages/delegation/MyPointsPage'

const queryClient = new QueryClient()

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Toaster position="top-right" richColors />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/change-password" element={<PasswordChangePage />} />

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

          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
