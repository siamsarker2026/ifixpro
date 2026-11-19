'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sun, Moon, Monitor, User, KeyRound, LogOut } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { applyTheme, getThemeChoice, type ThemeChoice } from '@/lib/theme'

type Msg = { type: 'ok' | 'error'; text: string } | null

function Notice({ msg }: { msg: Msg }) {
  if (!msg) return null
  return (
    <div
      className={`text-xs p-3 rounded-lg border ${
        msg.type === 'ok'
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
          : 'bg-red-50 text-red-700 border-red-200'
      }`}
    >
      {msg.text}
    </div>
  )
}

const cardClass = 'bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-4'
const inputClass = 'w-full border border-gray-300 rounded-lg p-2 text-sm outline-none focus:border-blue-600 bg-white text-gray-900'
const buttonClass =
  'bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50'

export default function AccountPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('')

  // Profile
  const [fullName, setFullName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [nameMsg, setNameMsg] = useState<Msg>(null)

  // Theme
  // Safe to read here: the theme buttons only render after loading, i.e. in the browser
  const [theme, setTheme] = useState<ThemeChoice>(() =>
    typeof window === 'undefined' ? 'system' : getThemeChoice()
  )

  // Password change request (the admin sets the new password)
  const [pwdNote, setPwdNote] = useState('')
  const [pendingSince, setPendingSince] = useState<string | null>(null)
  const [requesting, setRequesting] = useState(false)
  const [pwdMsg, setPwdMsg] = useState<Msg>(null)

  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    ;(async () => {
      const [{ data: { user } }, res, pendingRes] = await Promise.all([
        supabase.auth.getUser(),
        fetch('/api/me/access', { cache: 'no-store' }),
        fetch('/api/password-requests', { cache: 'no-store' }),
      ])
      if (pendingRes.ok) {
        const pending = await pendingRes.json()
        setPendingSince(pending.pendingSince ?? null)
      }
      if (user?.email) setEmail(user.email)
      if (res.ok) {
        const data = await res.json()
        setRole(data.role || '')
        setFullName(data.fullName || '')
      }
      setLoading(false)
    })()
  }, [])

  function chooseTheme(choice: ThemeChoice) {
    setTheme(choice)
    applyTheme(choice)
  }

  async function saveName(e: React.FormEvent) {
    e.preventDefault()
    setSavingName(true)
    setNameMsg(null)
    const res = await fetch('/api/me/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName }),
    })
    const data = await res.json().catch(() => ({}))
    setNameMsg(res.ok ? { type: 'ok', text: 'Name saved. It updates in the sidebar after a page refresh.' } : { type: 'error', text: data.error || 'Could not save your name' })
    setSavingName(false)
  }

  async function requestPasswordChange(e: React.FormEvent) {
    e.preventDefault()
    setRequesting(true)
    setPwdMsg(null)
    const res = await fetch('/api/password-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: pwdNote }),
    })
    const data = await res.json().catch(() => ({}))
    setRequesting(false)
    if (res.ok) {
      setPwdNote('')
      setPendingSince(new Date().toISOString())
      setPwdMsg({ type: 'ok', text: data.message || 'Your request has been sent to the administrator.' })
    } else {
      setPwdMsg({ type: 'error', text: data.error || 'Could not send the request' })
    }
  }

  async function signOutEverywhere() {
    setSigningOut(true)
    await supabase.auth.signOut({ scope: 'global' })
    router.push('/login')
  }

  if (loading) return <div className="text-sm text-gray-500">Loading your account...</div>

  const themeOptions: { value: ThemeChoice; label: string; icon: React.ReactNode }[] = [
    { value: 'light', label: 'Light', icon: <Sun className="w-4 h-4" /> },
    { value: 'dark', label: 'Dark', icon: <Moon className="w-4 h-4" /> },
    { value: 'system', label: 'System', icon: <Monitor className="w-4 h-4" /> },
  ]

  return (
    <div className="max-w-3xl space-y-6 pb-12">
      <div>
        <h2 className="text-xl font-bold text-gray-900">My Account</h2>
        <p className="text-sm text-gray-600">Your profile, password and display preferences.</p>
      </div>

      {/* Profile */}
      <form onSubmit={saveName} className={cardClass}>
        <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wide flex items-center gap-2">
          <User className="w-4 h-4" /> Profile
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs text-gray-500 mb-1">Email</div>
            <div className="text-gray-900 font-medium break-all">{email}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">Role</div>
            <div className="text-gray-900 font-medium capitalize">{role || '—'}</div>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Display name</label>
          <div className="flex gap-2">
            <input
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              maxLength={80}
              required
              className={inputClass}
            />
            <button type="submit" disabled={savingName} className={buttonClass}>
              {savingName ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
        <Notice msg={nameMsg} />
      </form>

      {/* Appearance */}
      <div className={cardClass}>
        <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wide flex items-center gap-2">
          <Sun className="w-4 h-4" /> Appearance
        </h3>
        <p className="text-xs text-gray-500">Saved on this device. System follows your computer&apos;s setting.</p>
        <div className="grid grid-cols-3 gap-2 max-w-md">
          {themeOptions.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => chooseTheme(opt.value)}
              aria-pressed={theme === opt.value}
              className={`flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                theme === opt.value
                  ? 'border-blue-600 ring-2 ring-blue-600/30 text-blue-700'
                  : 'border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {opt.icon} {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Password: changed by the administrator on request */}
      <form onSubmit={requestPasswordChange} className={cardClass}>
        <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wide flex items-center gap-2">
          <KeyRound className="w-4 h-4" /> Password
        </h3>
        <p className="text-xs text-gray-500">
          Passwords are changed by the administrator. Send a request and they will set a new password and let you know.
        </p>
        {pendingSince ? (
          <div className="text-xs p-3 rounded-lg border bg-amber-50 text-amber-800 border-amber-200">
            Request pending since {new Date(pendingSince).toLocaleString()}. The administrator has not handled it yet.
          </div>
        ) : (
          <>
            <textarea
              value={pwdNote}
              onChange={e => setPwdNote(e.target.value)}
              maxLength={300}
              rows={2}
              placeholder="Message for the administrator (optional)"
              className={inputClass}
            />
            <button type="submit" disabled={requesting} className={buttonClass}>
              {requesting ? 'Sending...' : 'Request Password Change'}
            </button>
          </>
        )}
        <Notice msg={pwdMsg} />
      </form>

      {/* Sessions */}
      <div className={cardClass}>
        <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wide flex items-center gap-2">
          <LogOut className="w-4 h-4" /> Sessions
        </h3>
        <p className="text-xs text-gray-500">
          Signs you out on every device and browser, including this one. Use it if you signed in on a shared computer.
        </p>
        <button
          type="button"
          onClick={signOutEverywhere}
          disabled={signingOut}
          className="border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        >
          {signingOut ? 'Signing out...' : 'Sign Out Everywhere'}
        </button>
      </div>
    </div>
  )
}
