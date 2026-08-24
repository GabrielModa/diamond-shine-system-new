'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    const formData = new FormData(event.currentTarget)
    const payload = {
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
    }

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => null)

    if (!res?.ok) {
      const body = (await res?.json().catch(() => null)) as { error?: string } | null
      setError(body?.error ?? 'Unable to sign in. Check your connection and try again.')
      setSubmitting(false)
      return
    }

    router.push('/home')
  }

  return (
    <main className="auth-shell">
      <section className="auth-hero">
        <div className="auth-brand">
          <span className="brand-mark">💎</span>
          <div>
            <div className="brand-title">Diamond Shine</div>
            <div className="brand-sub">Operations Suite</div>
          </div>
        </div>
        <h1>Welcome back</h1>
        <p className="muted">
          Track supplies, performance, and client feedback in one place.
        </p>
        <div className="auth-highlights">
          <div className="highlight-card">
            <div className="highlight-title">Live supplies</div>
            <div className="muted">Stay on top of urgent requests fast.</div>
          </div>
          <div className="highlight-card">
            <div className="highlight-title">Team performance</div>
            <div className="muted">Spot trends and celebrate wins.</div>
          </div>
        </div>
      </section>

      <section className="auth-card">
        <div className="auth-card-brand" aria-label="Diamond Shine Operations Suite">
          <span className="brand-mark" aria-hidden="true">💎</span>
          <div>
            <div className="brand-title">Diamond Shine</div>
            <div className="brand-sub">Operations Suite</div>
          </div>
        </div>
        <div className="auth-card-header">
          <h2>Sign in</h2>
          <p className="muted">Use your work email to continue.</p>
        </div>
        <form onSubmit={onSubmit} className="auth-form">
          <label className="muted" htmlFor="email">Email address</label>
          <input id="email" type="email" name="email" placeholder="you@company.com" autoComplete="email" required />
          <label className="muted" htmlFor="password">Password</label>
          <input id="password" type={showPassword ? 'text' : 'password'} name="password" placeholder="••••••••" autoComplete="current-password" required />
          <label className="password-toggle"><input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} /> Show password</label>
          <a href="/forgot-password">Forgot your password?</a>
          <button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'}</button>
        </form>
        {error ? <p className="toast error" role="alert">{error}</p> : null}
      </section>
    </main>
  )
}
