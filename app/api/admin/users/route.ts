import { createClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { requireUserManager } from '@/lib/requireUserManager'

const VALID_ROLES = ['user', 'operator', 'supervisor', 'manager', 'admin']

// Ensure service role key exists
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

if (!serviceKey) {
  console.error("❌ CRITICAL ERROR: SUPABASE_SERVICE_ROLE_KEY is missing from environment variables!")
}

const supabaseAdmin = createClient(supabaseUrl!, serviceKey!, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

export async function POST(request: NextRequest) {
  const gate = await requireUserManager(request)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  try {
    const body = await request.json()
    const { action, name, email, password, role } = body

    if (action === 'create') {
      if (role && !VALID_ROLES.includes(role)) {
        return NextResponse.json({ error: `Unknown role "${role}"` }, { status: 400 })
      }
      // Only admins may create admins, so a non-admin user manager can't escalate
      if (role === 'admin' && !gate.isAdmin) {
        return NextResponse.json({ error: 'Only an admin can create admin users' }, { status: 403 })
      }
      console.log('Attempting to create user:', { email, role })

      // 1. Create auth user
      const { data: authData, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name, role }
      })

      if (createError) {
        console.error('❌ Supabase Auth Error:', createError)
        return NextResponse.json({ error: createError.message }, { status: 400 })
      }

      console.log('User created in Auth, now upserting profile:', authData.user.id)

      // 2. Upsert profile table
      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .upsert({
          id: authData.user.id,
          uuid: authData.user.id, // other pages look names up by uuid
          email: email,
          full_name: name || email.split('@')[0],
          role: role || 'user',
          is_active: true,
        }, { onConflict: 'id' })

      if (profileError) {
        console.error('❌ Profile Insert Error:', profileError)
        // Roll back the auth user so a failed profile never leaves an orphan login
        const { error: rollbackError } = await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
        if (rollbackError) console.error('❌ Rollback failed, orphan auth user:', authData.user.id, rollbackError.message)
        return NextResponse.json({ error: profileError.message }, { status: 400 })
      }

      return NextResponse.json({ success: true, user: authData.user })
    }

    if (action === 'update') {
      const { userId, isActive } = body
      const newPassword: unknown = body.password
      if (typeof userId !== 'string' || !userId) {
        return NextResponse.json({ error: 'userId is required' }, { status: 400 })
      }
      if (role === undefined && isActive === undefined && newPassword === undefined) {
        return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
      }
      if (role !== undefined && !VALID_ROLES.includes(role)) {
        return NextResponse.json({ error: `Unknown role "${role}"` }, { status: 400 })
      }
      if (isActive !== undefined && typeof isActive !== 'boolean') {
        return NextResponse.json({ error: 'isActive must be true or false' }, { status: 400 })
      }
      if (newPassword !== undefined && (typeof newPassword !== 'string' || newPassword.length < 8)) {
        return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
      }

      const { data: target, error: targetError } = await supabaseAdmin
        .from('profiles')
        .select('role, is_active')
        .eq('id', userId)
        .single()
      if (targetError || !target) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }

      // Non-admins may not touch admin accounts or hand out the admin role
      if (!gate.isAdmin && (target.role === 'admin' || role === 'admin')) {
        return NextResponse.json({ error: 'Only an admin can change admin users' }, { status: 403 })
      }
      // Don't let anyone lock themselves out by accident
      if (userId === gate.userId) {
        if (isActive === false) {
          return NextResponse.json({ error: 'You cannot deactivate your own account' }, { status: 400 })
        }
        if (role !== undefined && role !== target.role) {
          return NextResponse.json({ error: 'You cannot change your own role' }, { status: 400 })
        }
      }

      const profileChanges: Record<string, unknown> = {}
      if (role !== undefined && role !== target.role) profileChanges.role = role
      if (isActive !== undefined && isActive !== target.is_active) profileChanges.is_active = isActive

      if (Object.keys(profileChanges).length > 0) {
        const { error: updateError } = await supabaseAdmin.from('profiles').update(profileChanges).eq('id', userId)
        if (updateError) {
          console.error('❌ Profile Update Error:', updateError.message)
          return NextResponse.json({ error: updateError.message }, { status: 400 })
        }
      }

      // Password, and sign-in block for deactivated users, live in Supabase Auth
      const authChanges: { password?: string; ban_duration?: string } = {}
      if (typeof newPassword === 'string') authChanges.password = newPassword
      if ('is_active' in profileChanges) authChanges.ban_duration = isActive ? 'none' : '876000h'

      if (Object.keys(authChanges).length > 0) {
        const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(userId, authChanges)
        if (authError) {
          console.error('❌ Auth Update Error:', authError.message)
          return NextResponse.json({ error: authError.message }, { status: 400 })
        }
      }

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (err: any) {
    console.error('❌ Server Internal Catch Error:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}