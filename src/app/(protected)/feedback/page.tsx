'use client'

import { FormEvent, useState } from 'react'

export default function FeedbackPage() {
  const [success, setSuccess] = useState(false)

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSuccess(true)
  }

  return (
    <main>
      <form onSubmit={onSubmit}>
        <select id="employeeName"><option>Maria Silva</option></select>
        <button id="submitBtn" type="submit">Submit</button>
      </form>
      {success ? <div className="toast success">ok</div> : null}
    </main>
  )
}
