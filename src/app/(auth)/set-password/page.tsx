'use client'

import { FormEvent, useState } from 'react'

export default function SetPasswordPage({ searchParams }: { searchParams: { token?: string } }) {
  const token = searchParams.token ?? ''
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
    setMessage({ type: 'success', text: 'Password created. Your account may still require administrator approval.' })
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
          <input id="password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          <label htmlFor="confirmPassword">Confirm password</label>
          <input id="confirmPassword" type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required />
          <button type="submit" className="btn-primary" disabled={submitting || !token}>
            {submitting ? 'Creating password…' : 'Create password'}
          </button>
        </form>
        {!token ? <p className="toast error">Invitation token is missing.</p> : null}
        {message ? <p className={`toast ${message.type}`} role="status">{message.text}</p> : null}
        {message?.type === 'success' ? <a href="/login">Continue to sign in</a> : null}
      </section>
    </main>
  )
}
