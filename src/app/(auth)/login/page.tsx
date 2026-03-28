'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [error, setError] = useState('')

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const formData = new FormData(event.currentTarget)
    const payload = {
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
    }

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      setError('Incorrect email or password')
      return
    }

    router.push('/home')
  }

  return (
    <main className="page-shell">
      <div className="page-header">
        <h1>Login</h1>
        <p className="muted">Use your work email to continue.</p>
      </div>
      <form onSubmit={onSubmit} className="card">
        <input type="email" name="email" placeholder="Email address" />
        <input type="password" name="password" placeholder="Password" />
        <button type="submit">Sign in</button>
      </form>
      {error ? <p className="toast error">{error}</p> : null}
    </main>
  )
}
