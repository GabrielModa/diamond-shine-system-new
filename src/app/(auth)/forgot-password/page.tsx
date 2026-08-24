'use client'

import { FormEvent, useState } from 'react'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    }).catch(() => null)
    setSubmitting(false)
    setSent(true)
  }

  return (
    <main className="auth-shell auth-shell-single">
      <section className="auth-card">
        <div className="auth-card-header">
          <div className="auth-brand"><span className="brand-mark">💎</span><strong>Diamond Shine</strong></div>
          <h1>Reset your password</h1>
          <p className="muted">Enter your work email and we will send a secure reset link.</p>
        </div>
        {sent ? (
          <div className="toast success" role="status">If the account exists, a reset link has been sent.</div>
        ) : (
          <form onSubmit={submit} className="auth-form">
            <label htmlFor="email">Work email</label>
            <input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            <button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Sending…' : 'Send reset link'}</button>
          </form>
        )}
        <a href="/login">Back to sign in</a>
      </section>
    </main>
  )
}
