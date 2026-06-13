import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { toast } from 'sonner'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'

const loginSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
})

type LoginForm = z.infer<typeof loginSchema>

export function LoginPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)

  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  })

  const onSubmit = async (data: LoginForm) => {
    setLoading(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: data.email.trim(),
        password: data.password,
      })

      if (error) {
        // Distinguish a genuine bad-credential error from everything else
        // (network/CORS/timeout/rate-limit/server). Showing one catch-all
        // "Invalid email or password" message for every failure has caused
        // real outages to be misdiagnosed as "users typed the wrong password".
        const isBadCreds =
          error.status === 400 &&
          /invalid login credentials/i.test(error.message)

        if (isBadCreds) {
          toast.error('Invalid email or password')
        } else if (error.status === 429) {
          toast.error('Too many attempts — please wait a minute and try again.')
        } else {
          toast.error(
            `Sign-in failed (${error.status ?? 'network'}): ${error.message}. ` +
              'If this keeps happening, check your internet connection and device clock.'
          )
        }
        // Always log the real error so support can read it from the console.
        console.error('[login] sign-in error:', {
          status: error.status,
          name: error.name,
          message: error.message,
        })
        setLoading(false)
        return
      }

      navigate('/dashboard')
    } catch (err) {
      // signInWithPassword threw before reaching the server: almost always a
      // network/DNS/firewall problem (e.g. office WiFi blocking *.supabase.co)
      // or the device being offline — NOT a wrong password.
      toast.error(
        'Could not reach the sign-in server. Check your internet connection ' +
          '(try mobile data) and try again.'
      )
      console.error('[login] network/transport error:', err)
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{
        background: 'radial-gradient(ellipse at 30% 20%, #fef3c7 0%, #fffbf0 50%, #fde68a 100%)',
      }}
    >
      {/* Background dot pattern */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(180,120,30,0.07) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 32, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full max-w-sm"
      >
        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          className="text-center mb-8"
        >
          <motion.div
            whileHover={{ scale: 1.06, rotate: [-2, 2, 0] }}
            transition={{ duration: 0.3 }}
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4"
            style={{
              background: 'linear-gradient(135deg, #92400e 0%, #b45309 100%)',
              boxShadow: '0 8px 28px rgba(146,64,14,0.40), 0 2px 8px rgba(0,0,0,0.12)',
            }}
          >
            <span className="text-white text-2xl font-bold tracking-tight">H</span>
          </motion.div>
          <h1 className="text-2xl font-semibold text-stone-800 tracking-tight">Hagerstone Hub</h1>
          <p className="text-sm text-stone-400 mt-1">Sign in to access your modules</p>
        </motion.div>

        {/* Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="bg-white/80 backdrop-blur-sm rounded-2xl border border-amber-100 p-6"
          style={{ boxShadow: '0 8px 40px rgba(146,64,14,0.13), 0 2px 8px rgba(0,0,0,0.06)' }}
        >
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-stone-600 text-xs font-medium">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@hagerstone.com"
                className="bg-stone-50/80 border-stone-200 focus:border-amber-400 focus:ring-amber-200"
                {...register('email')}
              />
              {errors.email && <p className="text-xs text-red-500">{errors.email.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-stone-600 text-xs font-medium">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                className="bg-stone-50/80 border-stone-200 focus:border-amber-400 focus:ring-amber-200"
                {...register('password')}
              />
              {errors.password && <p className="text-xs text-red-500">{errors.password.message}</p>}
            </div>

            <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}>
              <Button
                type="submit"
                className="w-full text-white font-medium"
                disabled={loading}
                style={{
                  background: loading
                    ? '#a16207'
                    : 'linear-gradient(135deg, #92400e 0%, #b45309 100%)',
                  boxShadow: '0 4px 16px rgba(146,64,14,0.30)',
                }}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Signing in...
                  </span>
                ) : 'Sign in'}
              </Button>
            </motion.div>
          </form>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="text-center text-xs text-stone-400 mt-5"
        >
          Forgot your password? Contact IT:{' '}
          <a href="mailto:admin@hagerstone.com" className="text-amber-700 hover:underline">
            admin@hagerstone.com
          </a>
        </motion.p>
      </motion.div>
    </div>
  )
}
