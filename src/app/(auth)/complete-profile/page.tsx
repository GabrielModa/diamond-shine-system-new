'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import EmployeeSelfProfileEditor from '../../../components/workforce/EmployeeSelfProfileEditor'

function CompleteProfile() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''
  if (!token) {
    return <main className="auth-shell auth-shell-single"><section className="auth-card"><h1>Setup link is missing</h1><p className="toast error">Open the secure invitation link from your email again.</p></section></main>
  }
  return <EmployeeSelfProfileEditor mode="onboarding" setupToken={token} />
}

export default function CompleteProfilePage() {
  return <Suspense fallback={<main className="auth-shell auth-shell-single"><section className="auth-card">Loading account setup…</section></main>}>
    <CompleteProfile />
  </Suspense>
}
