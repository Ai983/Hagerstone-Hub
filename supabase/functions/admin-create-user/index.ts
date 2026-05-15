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

  const { name, email, phone, designation, department, role, module_access } = await req.json()

  const tempPassword = generateTempPassword()

  // Create auth user
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

  // Get next employee code
  const { count } = await supabaseAdmin
    .from('employees')
    .select('*', { count: 'exact', head: true })

  const employeeCode = `HAG-${String((count ?? 0) + 1).padStart(3, '0')}`

  // Insert employee record
  const { data: emp, error: empError } = await supabaseAdmin
    .from('employees')
    .insert({
      auth_user_id: authData.user.id,
      name,
      email,
      phone: phone || null,
      designation: designation || null,
      department: department || null,
      role,
      employee_code: employeeCode,
      must_change_password: true,
    })
    .select()
    .single()

  if (empError) {
    // Rollback auth user
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
    return new Response(JSON.stringify({ error: empError.message }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Insert module access
  if (module_access && module_access.length > 0) {
    await supabaseAdmin.from('employee_module_access').insert(
      module_access.map((moduleId: string) => ({
        employee_id: emp.id,
        module_id: moduleId,
        can_access: true,
      }))
    )
  }

  return new Response(
    JSON.stringify({ employee: emp, temp_password: tempPassword }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
