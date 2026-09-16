import type { ReactNode, SVGProps } from 'react'

export type OpsIconName =
  | 'activity'
  | 'alert'
  | 'box'
  | 'bolt'
  | 'calendar'
  | 'check'
  | 'chevronLeft'
  | 'chevronRight'
  | 'clock'
  | 'clockIn'
  | 'clockOut'
  | 'presence'
  | 'expand'
  | 'download'
  | 'field'
  | 'filter'
  | 'flask'
  | 'incident'
  | 'layers'
  | 'map'
  | 'message'
  | 'minus'
  | 'note'
  | 'pin'
  | 'plus'
  | 'payroll'
  | 'refresh'
  | 'review'
  | 'search'
  | 'shield'
  | 'spreadsheet'
  | 'star'
  | 'trend'
  | 'truck'
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

  const paths: Record<OpsIconName, ReactNode> = {
    activity: <><path d="M3 12h4l2.1-6 4 12 2.2-6H21" /></>,
    alert: <><path d="M12 4 3.5 19h17L12 4Z" /><path d="M12 9v4" /><path d="M12 16h.01" /></>,
    box: <><path d="m4 7 8-4 8 4-8 4-8-4Z" /><path d="M4 7v10l8 4 8-4V7M12 11v10" /></>,
    bolt: <><path d="m13 2-8 12h7l-1 8 8-12h-7l1-8Z" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18" /></>,
    check: <><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.2 2.2 4.8-5" /></>,
    chevronLeft: <><path d="m15 18-6-6 6-6" /></>,
    chevronRight: <><path d="m9 18 6-6-6-6" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    clockIn: <><path d="M13 4h6v16h-6" /><path d="M3 12h11" /><path d="m9 8 4 4-4 4" /></>,
    clockOut: <><path d="M11 4H5v16h6" /><path d="M21 12H10" /><path d="m15 8-4 4 4 4" /></>,
    presence: <><circle cx="12" cy="12" r="2.5" /><circle cx="12" cy="12" r="7" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2" /></>,
    expand: <><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5" /><path d="m3 8 5-5M21 8l-5-5M3 16l5 5M21 16l-5 5" /></>,
    download: <><path d="M12 3v12" /><path d="m7.5 10.5 4.5 4.5 4.5-4.5" /><path d="M4 20h16" /></>,
    field: <><path d="M4 19V7l5-3 6 3 5-2v12l-5 3-6-3-5 2Z" /><path d="M9 4v13M15 7v13" /></>,
    filter: <><path d="M4 6h16M7 12h10M10 18h4" /></>,
    flask: <><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3" /><path d="M8 14h8" /></>,
    incident: <><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 17h.01" /></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>,
    map: <><path d="M4 5.5 9 3l6 2.5L20 3v15.5L15 21l-6-2.5L4 21V5.5Z" /><path d="M9 3v15.5M15 5.5V21" /></>,
    minus: <><path d="M5 12h14" /></>,
    note: <><path d="M5 3h10l4 4v14H5z" /><path d="M14 3v5h5M8 12h8M8 16h6" /></>,
    pin: <><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    message: <><path d="M4 5h16v11H9l-5 4V5Z" /><path d="M8 9h8M8 12h5" /></>,
    payroll: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 8h8M8 12h8M8 16h4" /></>,
    refresh: <><path d="M20 6v5h-5" /><path d="M4 18v-5h5" /><path d="M6.5 8A7 7 0 0 1 18 7l2 4M4 13l2 4a7 7 0 0 0 11.5-1" /></>,
    review: <><path d="M5 4h14v16H5z" /><path d="M8 8h8M8 12h5M8 16h3" /></>,
    search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>,
    shield: <><path d="M12 3 5 6v5c0 4.6 2.8 8 7 10 4.2-2 7-5.4 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></>,
    spreadsheet: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M4 9h16M10 9v12M15 9v12M4 15h16" /></>,
    star: <><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z" /></>,
    trend: <><path d="M4 17 9 12l3 3 7-8" /><path d="M14 7h5v5" /></>,
    truck: <><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z" /><circle cx="7" cy="18" r="2" /><circle cx="18" cy="18" r="2" /></>,
    user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.7-4 3-6 7-6s6.3 2 7 6" /></>,
  }

  return <svg {...common} {...props}>{paths[name]}</svg>
}
