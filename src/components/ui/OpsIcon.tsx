import type { SVGProps } from 'react'

export type OpsIconName =
  | 'activity'
  | 'alert'
  | 'calendar'
  | 'check'
  | 'clock'
  | 'download'
  | 'field'
  | 'filter'
  | 'incident'
  | 'payroll'
  | 'refresh'
  | 'review'
  | 'search'
  | 'spreadsheet'
  | 'user'

export default function OpsIcon({ name, size = 18, ...props }: SVGProps<SVGSVGElement> & { name: OpsIconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }

  const paths: Record<OpsIconName, React.ReactNode> = {
    activity: <><path d="M3 12h4l2.1-6 4 12 2.2-6H21" /></>,
    alert: <><path d="M12 4 3.5 19h17L12 4Z" /><path d="M12 9v4" /><path d="M12 16h.01" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18" /></>,
    check: <><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.2 2.2 4.8-5" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    download: <><path d="M12 3v12" /><path d="m7.5 10.5 4.5 4.5 4.5-4.5" /><path d="M4 20h16" /></>,
    field: <><path d="M4 19V7l5-3 6 3 5-2v12l-5 3-6-3-5 2Z" /><path d="M9 4v13M15 7v13" /></>,
    filter: <><path d="M4 6h16M7 12h10M10 18h4" /></>,
    incident: <><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 17h.01" /></>,
    payroll: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 8h8M8 12h8M8 16h4" /></>,
    refresh: <><path d="M20 6v5h-5" /><path d="M4 18v-5h5" /><path d="M6.5 8A7 7 0 0 1 18 7l2 4M4 13l2 4a7 7 0 0 0 11.5-1" /></>,
    review: <><path d="M5 4h14v16H5z" /><path d="M8 8h8M8 12h5M8 16h3" /></>,
    search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>,
    spreadsheet: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M4 9h16M10 9v12M15 9v12M4 15h16" /></>,
    user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.7-4 3-6 7-6s6.3 2 7 6" /></>,
  }

  return <svg {...common} {...props}>{paths[name]}</svg>
}
