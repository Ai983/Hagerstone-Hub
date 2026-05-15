import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { PasswordChangePage } from './components/PasswordChangeModal'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AdminRoute } from './components/AdminRoute'
import { EmployeesPage } from './pages/admin/EmployeesPage'
import { AddEmployeePage } from './pages/admin/AddEmployeePage'
import { EditEmployeePage } from './pages/admin/EditEmployeePage'

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

          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
