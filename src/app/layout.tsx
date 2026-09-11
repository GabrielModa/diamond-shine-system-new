import './globals.css'
import { ReactNode } from 'react'
import type { Metadata } from 'next'
import { Space_Grotesk } from 'next/font/google'

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  display: 'swap',
})

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
      <body className={spaceGrotesk.className}>{children}</body>
    </html>
  )
}
