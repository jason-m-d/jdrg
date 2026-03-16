'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { Loader2 } from 'lucide-react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = getSupabaseBrowser()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    window.location.href = '/dashboard'
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-[320px] animate-in-fade">
        {/* Mark */}
        <div className="mb-12 text-center">
          <h1 className="text-[28px] font-semibold tracking-tight text-foreground">
            J.DRG
          </h1>
          <div className="w-6 h-px bg-border mx-auto mt-3 mb-3" />
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground/50">
            DeMayo Restaurant Group
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} className="space-y-5">
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/60 font-medium">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jason@hungry.llc"
              required
              className="w-full bg-transparent border border-border px-3 py-2.5 text-[14px] outline-none placeholder:text-muted-foreground/30 focus:border-foreground transition-colors"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/60 font-medium">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full bg-transparent border border-border px-3 py-2.5 text-[14px] outline-none placeholder:text-muted-foreground/30 focus:border-foreground transition-colors"
            />
          </div>

          {error && (
            <p className="text-[12px] text-destructive">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-foreground text-background py-2.5 text-[13px] font-medium tracking-wide disabled:opacity-40 transition-opacity flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                <span>Signing in</span>
              </>
            ) : (
              'Sign In'
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
