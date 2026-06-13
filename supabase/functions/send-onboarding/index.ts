import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { generateTempPassword } from '../_shared/password.ts'

const MAYTAPI_PRODUCT_ID = 'b8cce1b9-0f9f-4aef-994c-d232716471f0'
const MAYTAPI_PHONE_ID = '46821'
const MAYTAPI_API_KEY = Deno.env.get('MAYTAPI_API_KEY')!
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
    await supabase
      .from('employees')
      .update({ auth_user_id: authData.user.id, must_change_password: true })
      .eq('id', employee_id)
  } else {
    // Resend: reset password
    await supabase.auth.admin.updateUserById(emp.auth_user_id, { password: tempPassword })
    await supabase
      .from('employees')
      .update({ must_change_password: true })
      .eq('id', employee_id)
  }

  const results: Record<string, string> = {}

  if (channels.includes('whatsapp') && emp.phone) {
    const message = `Hi ${emp.name}, welcome to Hagerstone Hub! 🎉\n\nYour account is ready.\n\nLogin: ${emp.email}\nTemp Password: ${tempPassword}\n\nOpen Hub: ${HUB_URL}\n\n⚠️ IMPORTANT: Please open the above link in Chrome or Safari browser (not inside WhatsApp).\n\nYou will be asked to set a new password on first login.\n\n— Hagerstone IT`

    const phone = emp.phone.replace(/\D/g, '')
    const toNumber = phone.startsWith('91') ? phone : `91${phone}`

    const waRes = await fetch(
      `https://api.maytapi.com/api/${MAYTAPI_PRODUCT_ID}/${MAYTAPI_PHONE_ID}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-maytapi-key': MAYTAPI_API_KEY },
        body: JSON.stringify({ to_number: toNumber, type: 'text', message }),
      }
    )
    const waStatus = waRes.ok ? 'sent' : 'failed'
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
