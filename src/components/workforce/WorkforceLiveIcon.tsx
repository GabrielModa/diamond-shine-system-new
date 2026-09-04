import type { ReactNode, SVGProps } from 'react'

export type WorkforceLiveIconName =
  | 'live'
  | 'calendar'
  | 'refresh'
  | 'alert'
  | 'school'
  | 'search'
  | 'map'
  | 'clock'
  | 'signal'
  | 'location'
  | 'close'
  | 'people'
  | 'available'
  | 'visit'
  | 'back'

const paths: Record<WorkforceLiveIconName, ReactNode> = {
  live: <><circle cx="12" cy="12" r="2.5"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.7 4.7a10.3 10.3 0 0 0 0 14.6M19.3 4.7a10.3 10.3 0 0 1 0 14.6"/></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M7.5 3.5v3M16.5 3.5v3M3.5 9h17"/></>,
  refresh: <><path d="M20 6v5h-5"/><path d="M18.2 9a7.5 7.5 0 1 0 .3 6.5"/></>,
  alert: <><path d="M12 3.5 21 20H3L12 3.5Z"/><path d="M12 9v5M12 17.2v.1"/></>,
  school: <><path d="m3 9 9-5 9 5-9 5-9-5Z"/><path d="M6.5 11.5V16c2.8 2.2 8.2 2.2 11 0v-4.5M21 9v6"/></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4.5 4.5"/></>,
  map: <><path d="m3.5 6 5-2 7 2 5-2v14l-5 2-7-2-5 2V6Z"/><path d="M8.5 4v14M15.5 6v14"/></>,
  clock: <><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></>,
  signal: <><path d="M5 17.5v1M9.5 14v4.5M14 10.5v8M18.5 7v11.5"/></>,
  location: <><path d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11Z"/><circle cx="12" cy="10" r="2"/></>,
  close: <path d="m7 7 10 10M17 7 7 17"/>,
  people: <><circle cx="9" cy="9" r="3"/><circle cx="17" cy="8" r="2.3"/><path d="M3.5 20c.5-4 2.4-6 5.5-6s5 2 5.5 6M14.5 14.5c3.2-.6 5.2 1.2 6 4.5"/></>,
  available: <><circle cx="12" cy="12" r="8.5"/><path d="m8.3 12 2.3 2.3 5.2-5.2"/></>,
  visit: <><rect x="4" y="4.5" width="16" height="15" rx="2"/><path d="M8 2.8v3.4M16 2.8v3.4M4 9h16M8 13h3M8 16h6"/></>,
  back: <path d="m14.5 6-6 6 6 6"/>,
}

export default function WorkforceLiveIcon({ name, ...props }: { name: WorkforceLiveIconName } & SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>
}
