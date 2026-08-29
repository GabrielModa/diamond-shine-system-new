'use client'

import { FormEvent, Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

function SetPasswordForm() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [checking, setChecking] = useState(Boolean(token))
  const [showPasswords, setShowPasswords] = useState(false)

  useEffect(() => {
    if (!token) return
    const controller = new AbortController()
    void fetch(`/api/auth/invite-setup?token=${encodeURIComponent(token)}`, {
      cache: 'no-store',
      signal: controller.signal,
    }).then(async (response) => {
      const body = await response.json().catch(() => null) as { ok?: boolean; error?: string; data?: { stage?: string } } | null
      if (!response.ok || !body?.ok) throw new Error(body?.error ?? 'Could not verify this invitation.')
      if (body.data?.stage === 'profile') {
        window.location.replace(`/complete-profile?token=${encodeURIComponent(token)}`)
        return
      }
      if (body.data?.stage === 'complete') {
        window.location.replace('/login')
        return
      }
      setChecking(false)
    }).catch((error) => {
      if (controller.signal.aborted) return
      setChecking(false)
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not verify this invitation.' })
    })
    return () => controller.abort()
  }, [token])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (password !== confirm) {
      setMessage({ type: 'error', text: 'Passwords do not match.' })
      return
    }
    setSubmitting(true)
    setMessage(null)
    const response = await fetch('/api/auth/set-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, password }),
    }).catch(() => null)

    if (!response?.ok) {
      setSubmitting(false)
      const body = (await response?.json().catch(() => null)) as { error?: string } | null
      setMessage({ type: 'error', text: body?.error ?? 'Could not save your password.' })
      return
    }

    const body = await response.json().catch(() => null) as { data?: { nextUrl?: string; stage?: string } } | null
    const nextUrl = body?.data?.nextUrl ?? `/complete-profile?token=${encodeURIComponent(token)}`
    setMessage({
      type: 'success',
      text: nextUrl.startsWith('/complete-profile')
        ? 'Password saved. Your account is not active yet — finish the profile setup to create access.'
        : 'Password saved. Your account is ready to sign in.',
    })
    window.setTimeout(() => window.location.assign(nextUrl), 250)
  }

  if (checking) {
    return <main className="auth-shell auth-shell-single"><section className="auth-card">Checking secure invitation…</section></main>
  }

  return (
    <main className="auth-shell auth-shell-single">
      <section className="auth-card">
        <div className="auth-card-header">
          <div className="auth-brand"><span className="brand-mark">💎</span><strong>Diamond Shine</strong></div>
          <h1>Set up your account</h1>
          <p className="muted">Step 1 of 5. Create your password first. Your account becomes active only after you finish contact, location and availability setup.</p>
        </div>
        <form onSubmit={submit} className="auth-form">
          <label htmlFor="password">Create password</label>
          <input id="password" type={showPasswords ? 'text' : 'password'} autoComplete="new-password" minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} required />
          <label htmlFor="confirmPassword">Confirm password</label>
          <input id="confirmPassword" type={showPasswords ? 'text' : 'password'} autoComplete="new-password" minLength={12} value={confirm} onChange={(event) => setConfirm(event.target.value)} required />
          <label className="password-toggle"><input type="checkbox" checked={showPasswords} onChange={(event) => setShowPasswords(event.target.checked)} /> Show passwords</label>
          <p className="muted">At least 12 characters with uppercase, lowercase and a number.</p>
          <button type="submit" className="btn-primary" disabled={submitting || !token}>
            {submitting ? 'Saving password…' : 'Continue account setup'}
          </button>
        </form>
        {!token ? <p className="toast error">Invitation token is missing.</p> : null}
        {message ? <p className={`toast ${message.type}`} role="status">{message.text}</p> : null}
      </section>
    </main>
  )
}

export default function SetPasswordPage() {
  return (
    <Suspense fallback={<main className="auth-shell auth-shell-single"><section className="auth-card">Loading secure invitation…</section></main>}>
      <SetPasswordForm />
    </Suspense>
  )
}
