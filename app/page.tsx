'tsx' // (Standard tsx file)
import { supabase } from '@/lib/supabase'

export default async function Home() {
  // Let's test fetching from one of your tables (e.g., checking if technicians or services table exists)
  // We'll just fetch a test query to verify connection
  const { data, error } = await supabase.from('technicians').select('*').limit(1)

  return (
    <main className="p-8 font-sans">
      <h1 className="text-2xl font-bold mb-4">iFix-pro Dashboard Foundation</h1>
      <p className="text-green-600 font-semibold mb-4">✅ Next.js is connected to Supabase!</p>
      
      <div className="bg-gray-100 p-4 rounded shadow">
        <h2 className="font-bold text-lg mb-2">Database Connection Test:</h2>
        {error ? (
          <p className="text-red-500">Error connecting or table missing: {error.message}</p>
        ) : (
          <p className="text-gray-700">Successfully connected to database! Found {data?.length || 0} record(s) in technicians table.</p>
        )}
      </div>
    </main>
  )
}