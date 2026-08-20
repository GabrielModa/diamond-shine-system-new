'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type NavItem = { label: string; href: string }

export default function TopNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname()

  const navLinks = (className = '') => items.map((item) => {
    const isActive = pathname === item.href

    return (
      <Link
        key={item.href}
        href={item.href}
        className={`${isActive ? 'nav-link active' : 'nav-link'} ${className}`.trim()}
        aria-current={isActive ? 'page' : undefined}
      >
        {item.label}
      </Link>
    )
  })

  return (
    <nav className="top-nav" aria-label="Primary navigation">
      <div className="nav-brand">
        <span className="brand-mark" aria-hidden="true">💎</span>
        <div>
          <div className="brand-title">Diamond Shine</div>
          <div className="brand-sub">Operations Suite</div>
        </div>
      </div>
      <div className="nav-links nav-desktop">
        {navLinks()}
      </div>
      <form className="nav-logout-form nav-desktop" action="/api/auth/logout" method="post">
        <button type="submit" className="nav-logout">Log out</button>
      </form>
      <details className="nav-mobile-menu">
        <summary aria-label="Open navigation menu">
          <span>Menu</span>
          <span aria-hidden="true">☰</span>
        </summary>
        <div className="nav-mobile-panel">
          <div className="nav-mobile-links">{navLinks()}</div>
          <form className="nav-logout-form" action="/api/auth/logout" method="post">
            <button type="submit" className="nav-logout">Log out</button>
          </form>
        </div>
      </details>
    </nav>
  )
}
