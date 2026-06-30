import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { generateTempPassword } from '../_shared/password.ts'
import { sendWhatsApp } from '../_shared/maytapi.ts'

// Hub login URL sent in the onboarding WhatsApp. Override via HUB_PUBLIC_URL
// once a custom domain is live; defaults to the current Vercel URL.
const HUB_URL = (Deno.env.get('HUB_PUBLIC_URL') ?? 'https://hagerstone-hub.vercel.app') + '/login'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { employee_id, channels } = await req.json()

  const { data: emp, error } = await supabase
    .from('employees')
    .select('*')
    .eq('id', employee_id)
    .single()

  if (error || !emp) {
    return new Response(
      JSON.stringify({ error: 'Employee not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const tempPassword = generateTempPassword()

  // Create or reset Hub auth account
  if (!emp.auth_user_id) {
    // First time: create auth user
    const { data: authData, error: createErr } = await supabase.auth.admin.createUser({
      email: emp.email,
      password: tempPassword,
      email_confirm: true,
    })
    if (createErr) {
      return new Response(
        JSON.stringify({ error: `Auth creation failed: ${createErr.message}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    // Patch email_change to '' — GoTrue crashes on login if this column is NULL
    // (admin.createUser leaves it NULL; GoTrue expects a non-null string).
    await supabase.rpc('fix_auth_email_change', { uid: authData.user.id })
    await supabase
      .from('employees')
      .update({ auth_user_id: authData.user.id, must_change_password: false })
      .eq('id', employee_id)
  } else {
    // Resend: reset password
    await supabase.auth.admin.updateUserById(emp.auth_user_id, { password: tempPassword })
    await supabase
      .from('employees')
      .update({ must_change_password: false })
      .eq('id', employee_id)
  }

  const results: Record<string, string> = {}

  if (channels.includes('whatsapp') && emp.phone) {
    const message = `Hi ${emp.name}, welcome to Hagerstone Hub! 🎉\n\nYour account is ready.\n\nLogin: ${emp.email}\nPassword: ${tempPassword}\n\nOpen Hub: ${HUB_URL}\n\n⚠️ IMPORTANT: Please open the above link in Chrome or Safari browser (not inside WhatsApp).\n\nSign in with the email and password above.\n\n— Hagerstone IT`

    const r = await sendWhatsApp({ phone: emp.phone, message })
    const waStatus = r.ok ? 'sent' : 'failed'
    results.whatsapp = waStatus

    await supabase.from('onboarding_log').insert({
      employee_id,
      channel: 'whatsapp',
      status: waStatus,
      message_preview: message.slice(0, 100),
    })
  }

  // Mark as onboarded
  await supabase
    .from('employees')
    .update({ onboarded_at: new Date().toISOString() })
    .eq('id', employee_id)

  return new Response(
    JSON.stringify({ success: true, results, temp_password: tempPassword }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
