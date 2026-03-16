'use client'

import { useState } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { useAuth } from '@/components/auth-provider'
import { Check, Loader2 } from 'lucide-react'

export default function AccountPage() {
  const { user } = useAuth()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }

    setLoading(true)
    setError('')
    setSuccess(false)

    const { error } = await getSupabaseBrowser().auth.updateUser({ password })

    if (error) {
      setError(error.message)
    } else {
      setSuccess(true)
      setPassword('')
      setConfirmPassword('')
    }
    setLoading(false)
  }

  return (
    <div className="max-w-md space-y-8 animate-in-fade">
      <div>
        <h1 className="text-[13px] font-medium uppercase tracking-[0.1em] mb-1">Account</h1>
        <p className="text-[12px] text-muted-foreground/50">{user?.email}</p>
      </div>

      <div className="border border-border">
        <div className="px-5 py-3 border-b border-border">
          <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/50 font-medium">
            Change Password
          </span>
        </div>
        <div className="p-5">
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/50 font-medium">
                New Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-transparent border border-border px-3 py-2 text-[13px] outline-none focus:border-foreground/30 transition-colors"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/50 font-medium">
                Confirm Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full bg-transparent border border-border px-3 py-2 text-[13px] outline-none focus:border-foreground/30 transition-colors"
              />
            </div>
            {error && <p className="text-[12px] text-destructive">{error}</p>}
            {success && (
              <p className="text-[12px] text-green-600 flex items-center gap-1.5">
                <Check className="size-3" /> Password updated
              </p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-[12px] bg-foreground text-background disabled:opacity-30 transition-opacity"
            >
              {loading && <Loader2 className="size-3 animate-spin" />}
              Update Password
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
