'use client'

import { FormEvent, Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'

function SetPasswordForm() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (password !== confirm) {
      setMessage({ type: 'error', text: 'Passwords do not match.' })
      return
    }
    setSubmitting(true)
    const response = await fetch('/api/auth/set-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, password }),
    }).catch(() => null)
    setSubmitting(false)

    if (!response?.ok) {
      const body = (await response?.json().catch(() => null)) as { error?: string } | null
      setMessage({ type: 'error', text: body?.error ?? 'Could not create your password.' })
      return
    }
    setMessage({ type: 'success', text: 'Password created. Your account is active — you can now sign in.' })
  }

  return (
    <main className="auth-shell auth-shell-single">
      <section className="auth-card">
        <div className="auth-card-header">
          <div className="auth-brand"><span className="brand-mark">💎</span><strong>Diamond Shine</strong></div>
          <h1>Create your password</h1>
          <p className="muted">Use at least 12 characters with uppercase, lowercase, and a number.</p>
        </div>
        <form onSubmit={submit} className="auth-form">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="new-password" minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} required />
          <label htmlFor="confirmPassword">Confirm password</label>
          <input id="confirmPassword" type="password" autoComplete="new-password" minLength={12} value={confirm} onChange={(event) => setConfirm(event.target.value)} required />
          <button type="submit" className="btn-primary" disabled={submitting || !token}>
            {submitting ? 'Creating password…' : 'Create password'}
          </button>
        </form>
        {!token ? <p className="toast error">Invitation token is missing.</p> : null}
        {message ? <p className={`toast ${message.type}`} role="status">{message.text}</p> : null}
        {message?.type === 'success' ? <div className="auth-form"><p className="muted">Use the same work email and password on the web or in the Diamond Shine mobile app.</p><a href="/login">Continue to sign in</a></div> : null}
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
