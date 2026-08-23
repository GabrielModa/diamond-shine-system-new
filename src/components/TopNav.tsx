'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type NavSection = 'control' | 'analytics' | 'admin' | 'workspace'
type NavItem = { label: string; href: string; section: NavSection }

const groups: Array<{ section: NavSection; label: string; description: string }> = [
  { section: 'control', label: 'Run operations', description: 'Dispatch, field execution, time, materials and communication.' },
  { section: 'analytics', label: 'Analytics', description: 'Service performance, quality and operational signals.' },
  { section: 'admin', label: 'Manage business', description: 'Clients, service design, work orders, people and audit.' },
  { section: 'workspace', label: 'My workspace', description: 'Personal requests and follow-up.' },
]

export default function TopNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname()

  const navLinks = (section: NavSection, className = '') => items.filter((item) => item.section === section).map((item) => {
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

  const sectionHasActivePage = (section: NavSection) => items.some((item) => item.section === section && pathname === item.href)

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
        {groups.map((group) => items.some((item) => item.section === group.section) ? <details key={group.section} className={`nav-workspace-menu ${sectionHasActivePage(group.section) ? 'active' : ''}`}>
          <summary>{group.label}<span aria-hidden="true">⌄</span></summary>
          <div className="nav-workspace-panel">
            <p>{group.description}</p>
            {navLinks(group.section, 'nav-workspace-link')}
          </div>
        </details> : null)}
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
          <div className="nav-mobile-links">
            {groups.map((group) => items.some((item) => item.section === group.section) ? <section key={group.section} className="nav-mobile-group"><span className="nav-section-label">{group.label}</span><small>{group.description}</small>{navLinks(group.section)}</section> : null)}
          </div>
          <form className="nav-logout-form" action="/api/auth/logout" method="post">
            <button type="submit" className="nav-logout">Log out</button>
          </form>
        </div>
      </details>
    </nav>
  )
}
