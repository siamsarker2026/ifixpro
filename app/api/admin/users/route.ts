import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: Request) {
  try {
    const { action, name, email, password, role, userId, isActive } = await request.json()

    if (action === 'create') {
      const { data, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name, role },
      })

      if (authError) throw authError

      if (data.user) {
        const { error: profileError } = await supabaseAdmin
          .from('profiles')
          .upsert({
            id: data.user.id,
            email,
            name: name || '',
            role: role || 'user',
            is_active: true,
          }, { onConflict: 'id' })

        if (profileError) throw profileError
      }

      return NextResponse.json({ success: true, user: data.user })
    }

    if (action === 'update') {
      const updateData: Record<string, any> = {}
      if (role) updateData.role = role
      if (typeof isActive === 'boolean') updateData.is_active = isActive

      const { error: updateError } = await supabaseAdmin
        .from('profiles')
        .update(updateData)
        .eq('id', userId)

      if (updateError) throw updateError

      if (password) {
        const { error: pwdError } = await supabaseAdmin.auth.admin.updateUserById(userId, { password })
        if (pwdError) throw pwdError
      }

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}