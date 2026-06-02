import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let password = 'H@'
  for (let i = 0; i < 8; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return password
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Verify caller is admin
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const { data: callerEmployee } = await supabaseAdmin
    .from('employees')
    .select('role')
    .eq('auth_user_id', user.id)
    .single()

  if (callerEmployee?.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Forbidden: Admin only' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const body = await req.json()
  const { name, phone, designation, department, role } = body
  const email = String(body.email ?? '').trim().toLowerCase()

  if (!email) {
    return new Response(JSON.stringify({ error: 'Email is required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Reuse an existing auth identity if this person already signs into CPS/Expense.
  // This keeps ONE login (same email + password) across all modules.
  const { data: existingAuthId } = await supabaseAdmin
    .rpc('auth_user_id_by_email', { p_email: email })

  const linkedExisting = !!existingAuthId
  let authUserId: string
  let tempPassword: string | null = null

  if (linkedExisting) {
    authUserId = existingAuthId as string
  } else {
    tempPassword = generateTempPassword()
    const { data: authData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
    })
    if (createError) {
      return new Response(JSON.stringify({ error: createError.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    authUserId = authData.user.id
  }

  // Guard against double-onboarding into the Hub.
  const { data: dupEmp } = await supabaseAdmin
    .from('employees')
    .select('id')
    .or(`auth_user_id.eq.${authUserId},email.eq.${email}`)
    .maybeSingle()

  if (dupEmp) {
    // Only clean up an auth user we created in THIS request; never delete an
    // existing CPS/Expense identity.
    if (!linkedExisting) {
      await supabaseAdmin.auth.admin.deleteUser(authUserId)
    }
    return new Response(JSON.stringify({ error: 'An employee with this email already exists in the Hub' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Get next employee code
  const { count } = await supabaseAdmin
    .from('employees')
    .select('*', { count: 'exact', head: true })

  const employeeCode = `HAG-${String((count ?? 0) + 1).padStart(3, '0')}`

  // Insert Hub identity. Existing users keep their current password (no forced change).
  const { data: emp, error: empError } = await supabaseAdmin
    .from('employees')
    .insert({
      auth_user_id: authUserId,
      name,
      email,
      phone: phone || null,
      designation: designation || null,
      department: department || null,
      role,
      employee_code: employeeCode,
      must_change_password: false,
    })
    .select()
    .single()

  if (empError) {
    if (!linkedExisting) {
      await supabaseAdmin.auth.admin.deleteUser(authUserId)
    }
    return new Response(JSON.stringify({ error: empError.message }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Module access + cross-schema provisioning is handled by the caller via the
  // sync_module_access RPC, so create and edit share one code path.
  return new Response(
    JSON.stringify({ employee: emp, temp_password: tempPassword, linked_existing: linkedExisting }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
