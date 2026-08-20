import './globals.css'
import { ReactNode } from 'react'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: {
    default: 'Diamond Shine Operations Suite',
    template: '%s | Diamond Shine',
  },
  description: 'Operational workspace for supplies, performance feedback, and service delivery.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
