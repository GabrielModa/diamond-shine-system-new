'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type NavItem = { label: string; href: string }

export default function TopNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname()

  return (
    <nav className="top-nav">
      <div className="nav-brand">
        <span className="brand-mark">💎</span>
        <div>
          <div className="brand-title">Diamond Shine</div>
          <div className="brand-sub">Operations Suite</div>
        </div>
      </div>
      <div className="nav-links">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={pathname === item.href ? 'nav-link active' : 'nav-link'}
          >
            {item.label}
          </Link>
        ))}
      </div>
      <form action="/api/auth/logout" method="post">
        <button type="submit" className="nav-logout">Log out</button>
      </form>
    </nav>
  )
}
