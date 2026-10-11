import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

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

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { action, name, email, password, role } = body

    if (action === 'create') {
      console.log('Attempting to create user:', { email, name, role })

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
          email: email,
          full_name: name || email.split('@')[0],
          role: role || 'user',
          is_active: true,
        }, { onConflict: 'id' })

      if (profileError) {
        console.error('❌ Profile Insert Error:', profileError)
        return NextResponse.json({ error: profileError.message }, { status: 400 })
      }

      return NextResponse.json({ success: true, user: authData.user })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (err: any) {
    console.error('❌ Server Internal Catch Error:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}