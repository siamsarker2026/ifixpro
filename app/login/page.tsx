'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<'login' | 'forgot'>('login')
  const [infoMsg, setInfoMsg] = useState('')
  const [note, setNote] = useState('')

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setErrorMsg('')
    setInfoMsg('')
    try {
      // Goes to the administrator, who sets the new password
      const res = await fetch('/api/password-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, note }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setInfoMsg(data.message || 'Your request has been sent to the administrator.')
        setNote('')
      } else {
        setErrorMsg(data.error || 'Could not send the request')
      }
    } catch {
      setErrorMsg('Could not send the request')
    } finally {
      setLoading(false)
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setErrorMsg('')

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setErrorMsg(error.message)
      setLoading(false)
    } else {
      router.push('/dashboard')
      router.refresh()
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md space-y-6 bg-white p-8 rounded-2xl shadow-sm border border-gray-200">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">iFix Pro</h1>
          <p className="text-sm text-gray-500 mt-1">Sign in to your account</p>
        </div>

        {errorMsg && (
          <div className="p-3 bg-red-50 text-red-700 rounded-lg text-xs border border-red-200">
            {errorMsg}
          </div>
        )}

        {infoMsg && (
          <div className="p-3 bg-emerald-50 text-emerald-700 rounded-lg text-xs border border-emerald-200">
            {infoMsg}
          </div>
        )}

        {mode === 'forgot' ? (
          <form onSubmit={handleForgot} className="space-y-4">
            <p className="text-xs text-gray-600">Enter your email to ask the administrator to set a new password for you.</p>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-white text-gray-900 border border-gray-300 p-2.5 rounded-lg text-sm outline-none focus:border-blue-600"
              placeholder="you@example.com"
            />
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={300}
              rows={2}
              className="w-full bg-white text-gray-900 border border-gray-300 p-2.5 rounded-lg text-sm outline-none focus:border-blue-600"
              placeholder="Message for the administrator (optional)"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white p-2.5 rounded-lg font-medium text-sm transition-colors disabled:opacity-50"
            >
              {loading ? 'Sending...' : 'Request Password Reset'}
            </button>
            <button
              type="button"
              onClick={() => { setMode('login'); setErrorMsg(''); setInfoMsg('') }}
              className="w-full text-xs text-gray-500 hover:underline"
            >
              ← Back to sign in
            </button>
          </form>
        ) : (
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Email Address</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-white text-gray-900 border border-gray-300 p-2.5 rounded-lg text-sm outline-none focus:border-blue-600"
              placeholder="admin@ifixpro.com"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Password</label>
            {/* Added relative positioning to parent container */}
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white text-gray-900 border border-gray-300 p-2.5 pr-16 rounded-lg text-sm outline-none focus:border-blue-600"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 px-2.5 py-1 rounded-md transition-colors"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <div className="flex justify-between items-center text-xs text-gray-500">
            <button
              type="button"
              onClick={() => { setMode('forgot'); setErrorMsg(''); setInfoMsg('') }}
              className="cursor-pointer hover:underline"
            >
              Forgot password?
            </button>
          </div> 

          <button         
            type="submit"
            disabled={loading}
            className="w-full bg-slate-900 hover:bg-slate-800 text-white p-2.5 rounded-lg font-medium text-sm transition-colors disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
        )}
      </div>
    </div>
  )
}