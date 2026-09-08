import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const masterSupabase = createClient(
  process.env.NEXT_PUBLIC_MASTER_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_MASTER_SUPABASE_ANON_KEY!
)

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const imei = searchParams.get('imei')

    if (!imei || !imei.trim()) {
      return NextResponse.json({ success: false, error: 'Missing IMEI parameter' }, { status: 400 })
    }

    const cleanImei = imei.trim()

    if (!/^\d{15}$/.test(cleanImei)) {
      return NextResponse.json({ success: false, error: 'Invalid IMEI format' }, { status: 400 })
    }

    // Query Supabase safely using maybeSingle() to prevent single-object coercion crashes
    const { data, error } = await masterSupabase
      .from('device_master')
      .select('imei, model, gb, color')
      .eq('imei', cleanImei)
      .maybeSingle()

    if (error) {
      console.log('SUPABASE QUERY ERROR:', error)
      return NextResponse.json({ success: false, error: `Database error: ${error.message}` }, { status: 404 })
    }

    if (!data) {
      return NextResponse.json({ success: false, error: 'IMEI not found' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      device: {
        imei: data.imei,
        model: data.model,
        gb: data.gb,
        color: data.color,
      },
    })
  } catch (err: any) {
    console.log('SERVER CATCH ERROR:', err)
    return NextResponse.json({ success: false, error: 'Server/database error' }, { status: 500 })
  }
}