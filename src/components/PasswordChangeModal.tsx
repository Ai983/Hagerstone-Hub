import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { supabase } from '../lib/supabase'
import { toast } from 'sonner'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { useNavigate } from 'react-router-dom'

const schema = z.object({
  new_password: z.string().min(8, 'Password must be at least 8 characters'),
  confirm_password: z.string(),
}).refine(d => d.new_password === d.confirm_password, {
  message: 'Passwords do not match',
  path: ['confirm_password'],
})

type FormData = z.infer<typeof schema>

export function PasswordChangePage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const onSubmit = async (data: FormData) => {
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password: data.new_password })

    if (error) {
      toast.error('Failed to change password. Please try again.')
      setLoading(false)
      return
    }

    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      await supabase
        .from('employees')
        .update({ must_change_password: false })
        .eq('auth_user_id', user.id)
    }

    toast.success('Password changed successfully!')
    navigate('/dashboard')
  }

  return (
    <div className="min-h-screen bg-amber-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-amber-800 rounded-2xl mb-4">
            <span className="text-white text-2xl font-bold">H</span>
          </div>
          <h1 className="text-xl font-semibold text-stone-800">Set your password</h1>
          <p className="text-sm text-stone-500 mt-1">
            This is your first login. Please set a new password.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>New Password</Label>
              <Input type="password" placeholder="At least 8 characters" {...register('new_password')} />
              {errors.new_password && <p className="text-xs text-red-500">{errors.new_password.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Confirm Password</Label>
              <Input type="password" placeholder="Repeat password" {...register('confirm_password')} />
              {errors.confirm_password && <p className="text-xs text-red-500">{errors.confirm_password.message}</p>}
            </div>
            <Button type="submit" className="w-full bg-amber-800 hover:bg-amber-700" disabled={loading}>
              {loading ? 'Saving...' : 'Set Password & Continue'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
