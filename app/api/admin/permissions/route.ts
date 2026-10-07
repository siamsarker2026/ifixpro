import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  try {
    const { data: modules, error: modError } = await supabaseAdmin
      .from('modules')
      .select('*')
      .order('category')
    
    const { data: permissions, error: permError } = await supabaseAdmin
      .from('role_permissions')
      .select('*')

    if (modError || permError) throw modError || permError

    return NextResponse.json({ modules, permissions })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { role, moduleIds } = await request.json()

    if (!role || !Array.isArray(moduleIds)) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }

    // Clear existing access for this role
    await supabaseAdmin.from('role_permissions').delete().eq('role', role)

    // Insert newly selected modules
    if (moduleIds.length > 0) {
      const rows = moduleIds.map((mId: string) => ({ role, module_id: mId }))
      const { error } = await supabaseAdmin.from('role_permissions').insert(rows)
      if (error) throw error
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}