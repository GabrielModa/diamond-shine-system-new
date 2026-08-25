export type DemoStudyRule = { dayOfWeek: number; startsMinute: number; endsMinute: number }
export type DemoEmployeeScenario = {
  email: string
  name: string
  home: { address: string; latitude: number; longitude: number }
  school?: { name: string; address: string; latitude: number; longitude: number } | null
  studySchedule: DemoStudyRule[]
  weeklyTargetMinutes: number
  travelMode: 'driving' | 'transit' | 'cycling'
  leave?: 'school_holiday' | 'personal_leave'
  workedHours: Array<{ daysAgo: number; hours: number }>
  tags: string[]
}
export type DemoSiteScenario = {
  externalId: string
  client: string
  site: string
  addressLine1: string
  city: string
  postalCode: string
  latitude: number
  longitude: number
  startMinute: number
  durationMinutes: number
  employeeEmails: string[]
  tags: string[]
}

const weekdays = [1, 2, 3, 4, 5]
const monThu = [1, 2, 3, 4]

export const DEMO_EMPLOYEE_SCENARIOS: DemoEmployeeScenario[] = [
  {
    email: 'employee@ds.ie', name: 'Strikerlift',
    home: { address: 'Phibsborough, Dublin 7', latitude: 53.3597, longitude: -6.2735 },
    school: { name: 'TU Dublin Grangegorman', address: 'Grangegorman Lower, Dublin 7', latitude: 53.3475, longitude: -6.2771 },
    studySchedule: weekdays.map((dayOfWeek) => ({ dayOfWeek, startsMinute: 8 * 60, endsMinute: 13 * 60 })),
    weeklyTargetMinutes: 1800, travelMode: 'transit',
    workedHours: [{ daysAgo: 1, hours: 7 }, { daysAgo: 2, hours: 7 }, { daysAgo: 3, hours: 6 }, { daysAgo: 4, hours: 7 }, { daysAgo: 5, hours: 5 }],
    tags: ['school-morning', 'full-week', 'near-target'],
  },
  {
    email: 'maria@ds.ie', name: 'Maria Silva',
    home: { address: 'Rathmines, Dublin 6', latitude: 53.3242, longitude: -6.2656 },
    school: { name: 'Dublin Business School', address: 'Aungier Street, Dublin 2', latitude: 53.3408, longitude: -6.2641 },
    studySchedule: [1, 3, 5].map((dayOfWeek) => ({ dayOfWeek, startsMinute: 9 * 60, endsMinute: 16 * 60 })),
    weeklyTargetMinutes: 1500, travelMode: 'cycling', leave: 'school_holiday',
    workedHours: [{ daysAgo: 1, hours: 5 }, { daysAgo: 2, hours: 6 }, { daysAgo: 3, hours: 4 }, { daysAgo: 4, hours: 5 }],
    tags: ['school-alternate-days', 'school-holiday', '20h-worked'],
  },
  {
    email: 'john@ds.ie', name: 'John Connor',
    home: { address: 'Drumcondra, Dublin 9', latitude: 53.3668, longitude: -6.2586 },
    school: { name: 'DCU Glasnevin', address: 'Glasnevin, Dublin 9', latitude: 53.3853, longitude: -6.2560 },
    studySchedule: [
      { dayOfWeek: 1, startsMinute: 9 * 60, endsMinute: 12 * 60 },
      { dayOfWeek: 2, startsMinute: 14 * 60, endsMinute: 18 * 60 },
      { dayOfWeek: 4, startsMinute: 10 * 60, endsMinute: 16 * 60 },
    ],
    weeklyTargetMinutes: 1800, travelMode: 'transit',
    workedHours: [{ daysAgo: 1, hours: 8 }, { daysAgo: 2, hours: 8 }, { daysAgo: 3, hours: 8 }, { daysAgo: 4, hours: 7 }],
    tags: ['school-mixed', 'over-30h'],
  },
  {
    email: 'emma@ds.ie', name: 'Emma Wilson',
    home: { address: 'Clontarf, Dublin 3', latitude: 53.3639, longitude: -6.1938 },
    school: { name: 'Trinity College Dublin', address: 'College Green, Dublin 2', latitude: 53.3438, longitude: -6.2546 },
    studySchedule: monThu.map((dayOfWeek) => ({ dayOfWeek, startsMinute: 14 * 60, endsMinute: 18 * 60 })),
    weeklyTargetMinutes: 1800, travelMode: 'cycling',
    workedHours: [{ daysAgo: 1, hours: 3 }, { daysAgo: 2, hours: 4 }, { daysAgo: 3, hours: 5 }],
    tags: ['school-afternoon', 'mon-thu', 'low-hours'],
  },
  {
    email: 'michael@ds.ie', name: 'Michael Brown',
    home: { address: 'Stoneybatter, Dublin 7', latitude: 53.3488, longitude: -6.2926 },
    school: { name: 'National College of Ireland', address: 'Mayor Street Lower, IFSC', latitude: 53.3490, longitude: -6.2456 },
    studySchedule: [2, 4].map((dayOfWeek) => ({ dayOfWeek, startsMinute: 18 * 60, endsMinute: 21 * 60 + 30 })),
    weeklyTargetMinutes: 1200, travelMode: 'driving', leave: 'personal_leave',
    workedHours: [],
    tags: ['school-evening', 'personal-leave', 'zero-hours'],
  },
  {
    email: 'gabriel.moda@ds.ie', name: 'Gabriel Nunes Moda',
    home: { address: 'Dundrum, Dublin 14', latitude: 53.2897, longitude: -6.2437 },
    school: null, studySchedule: [], weeklyTargetMinutes: 2100, travelMode: 'driving',
    workedHours: [{ daysAgo: 1, hours: 2 }, { daysAgo: 2, hours: 2 }],
    tags: ['no-school', 'large-capacity'],
  },
  {
    email: 'aoife@ds.ie', name: 'Aoife Byrne',
    home: { address: 'Swords, Co. Dublin', latitude: 53.4597, longitude: -6.2181 },
    school: null, studySchedule: [], weeklyTargetMinutes: 1800, travelMode: 'driving',
    workedHours: [{ daysAgo: 1, hours: 6 }, { daysAgo: 2, hours: 6 }, { daysAgo: 3, hours: 6 }, { daysAgo: 4, hours: 6 }, { daysAgo: 5, hours: 6 }],
    tags: ['no-school', '30h-worked', 'north-dublin'],
  },
  {
    email: 'liam@ds.ie', name: 'Liam Murphy',
    home: { address: 'Cabra, Dublin 7', latitude: 53.3661, longitude: -6.2948 },
    school: { name: 'TU Dublin Bolton Street', address: 'Bolton Street, Dublin 1', latitude: 53.3517, longitude: -6.2692 },
    studySchedule: weekdays.map((dayOfWeek) => ({ dayOfWeek, startsMinute: 8 * 60, endsMinute: 12 * 60 })),
    weeklyTargetMinutes: 1500, travelMode: 'transit',
    workedHours: [{ daysAgo: 1, hours: 4 }, { daysAgo: 2, hours: 4 }, { daysAgo: 3, hours: 4 }],
    tags: ['school-morning', 'evening-availability', '12h-worked'],
  },
  {
    email: 'niamh@ds.ie', name: 'Niamh Kelly',
    home: { address: 'Ranelagh, Dublin 6', latitude: 53.3254, longitude: -6.2569 },
    school: { name: 'UCD Belfield', address: 'Belfield, Dublin 4', latitude: 53.3067, longitude: -6.2217 },
    studySchedule: monThu.map((dayOfWeek) => ({ dayOfWeek, startsMinute: 13 * 60, endsMinute: 17 * 60 })),
    weeklyTargetMinutes: 1800, travelMode: 'cycling',
    workedHours: [{ daysAgo: 1, hours: 5 }, { daysAgo: 2, hours: 5 }, { daysAgo: 3, hours: 5 }, { daysAgo: 4, hours: 5 }],
    tags: ['school-afternoon', 'morning-availability', '20h-worked'],
  },
  {
    email: 'omar@ds.ie', name: 'Omar Hassan',
    home: { address: 'Ballymun, Dublin 11', latitude: 53.3960, longitude: -6.2644 },
    school: { name: 'Dublin City University', address: 'Glasnevin, Dublin 9', latitude: 53.3853, longitude: -6.2560 },
    studySchedule: [2, 4].map((dayOfWeek) => ({ dayOfWeek, startsMinute: 18 * 60, endsMinute: 22 * 60 })),
    weeklyTargetMinutes: 1800, travelMode: 'transit',
    workedHours: [{ daysAgo: 1, hours: 7 }, { daysAgo: 2, hours: 6 }, { daysAgo: 3, hours: 7 }],
    tags: ['school-evening', '20h-worked'],
  },
  {
    email: 'sofia@ds.ie', name: 'Sofia Costa',
    home: { address: 'Dún Laoghaire, Co. Dublin', latitude: 53.2944, longitude: -6.1339 },
    school: { name: 'IADT', address: 'Kill Avenue, Dún Laoghaire', latitude: 53.2798, longitude: -6.1512 },
    studySchedule: [1, 3, 5].map((dayOfWeek) => ({ dayOfWeek, startsMinute: 10 * 60, endsMinute: 15 * 60 })),
    weeklyTargetMinutes: 1500, travelMode: 'transit',
    workedHours: [{ daysAgo: 1, hours: 5 }, { daysAgo: 3, hours: 5 }],
    tags: ['school-alternate-days', '10h-worked', 'south-dublin'],
  },
  {
    email: 'daniel@ds.ie', name: 'Daniel Okafor',
    home: { address: 'Blanchardstown, Dublin 15', latitude: 53.3890, longitude: -6.3897 },
    school: null, studySchedule: [], weeklyTargetMinutes: 1800, travelMode: 'driving', leave: 'personal_leave',
    workedHours: [{ daysAgo: 5, hours: 8 }],
    tags: ['no-school', 'personal-leave'],
  },
  {
    email: 'priya@ds.ie', name: 'Priya Shah',
    home: { address: 'Blackrock, Co. Dublin', latitude: 53.3015, longitude: -6.1778 },
    school: { name: 'UCD Belfield', address: 'Belfield, Dublin 4', latitude: 53.3067, longitude: -6.2217 },
    studySchedule: weekdays.map((dayOfWeek) => ({ dayOfWeek, startsMinute: 9 * 60, endsMinute: 16 * 60 })),
    weeklyTargetMinutes: 1200, travelMode: 'cycling', leave: 'school_holiday',
    workedHours: [{ daysAgo: 1, hours: 6 }, { daysAgo: 2, hours: 6 }],
    tags: ['school-full-day', 'school-holiday', 'home-fallback'],
  },
  {
    email: 'lucas@ds.ie', name: 'Lucas Ferreira',
    home: { address: 'Tallaght, Dublin 24', latitude: 53.2878, longitude: -6.3411 },
    school: null, studySchedule: [], weeklyTargetMinutes: 1500, travelMode: 'driving',
    workedHours: [{ daysAgo: 1, hours: 7 }, { daysAgo: 2, hours: 7 }, { daysAgo: 3, hours: 7 }, { daysAgo: 4, hours: 7 }],
    tags: ['no-school', 'over-target', '28h-worked'],
  },
  {
    email: 'aisha@ds.ie', name: 'Aisha Khan',
    home: { address: 'Donnybrook, Dublin 4', latitude: 53.3215, longitude: -6.2367 },
    school: { name: 'Scenario Test College', address: 'Pearse Street, Dublin 2', latitude: 53.3434, longitude: -6.2484 },
    studySchedule: [1,2,3,4,5,6,7].map((dayOfWeek) => ({ dayOfWeek, startsMinute: 0, endsMinute: 1440 })),
    weeklyTargetMinutes: 1800, travelMode: 'transit',
    workedHours: [{ daysAgo: 1, hours: 6 }, { daysAgo: 2, hours: 6 }, { daysAgo: 3, hours: 6 }, { daysAgo: 4, hours: 6 }, { daysAgo: 5, hours: 6 }],
    tags: ['always-school-test', '30h-worked'],
  },
]

export const DEMO_SITE_SCENARIOS: DemoSiteScenario[] = [
  { externalId:'scenario-merrion-dental', client:'Merrion Dental Group', site:'Ranelagh Clinic', addressLine1:'26 Ranelagh Road', city:'Dublin', postalCode:'D06 D2P4', latitude:53.3264, longitude:-6.2562, startMinute:6*60+30, durationMinutes:150, employeeEmails:['niamh@ds.ie','maria@ds.ie'], tags:['early-morning','healthcare'] },
  { externalId:'scenario-northstar', client:'Northstar Property', site:'Sandyford Offices', addressLine1:'Central Park, Leopardstown', city:'Dublin', postalCode:'D18', latitude:53.2774, longitude:-6.2057, startMinute:18*60, durationMinutes:180, employeeEmails:['gabriel.moda@ds.ie','lucas@ds.ie'], tags:['evening','large-office'] },
  { externalId:'scenario-cedar-hotel', client:'Cedar Hotels', site:'Docklands Hotel', addressLine1:'North Wall Quay', city:'Dublin', postalCode:'D01', latitude:53.3487, longitude:-6.2407, startMinute:11*60, durationMinutes:240, employeeEmails:['liam@ds.ie','aisha@ds.ie'], tags:['daytime','hospitality'] },
  { externalId:'scenario-dublin-arts', client:'Dublin Arts Collective', site:'Temple Bar Gallery', addressLine1:'Meeting House Square', city:'Dublin', postalCode:'D02', latitude:53.3454, longitude:-6.2660, startMinute:20*60, durationMinutes:120, employeeEmails:['omar@ds.ie','employee@ds.ie'], tags:['late-evening','public-space'] },
  { externalId:'scenario-phoenix-logistics', client:'Phoenix Logistics', site:'Ballymount Hub', addressLine1:'Ballymount Industrial Estate', city:'Dublin', postalCode:'D12', latitude:53.3090, longitude:-6.3500, startMinute:5*60+30, durationMinutes:180, employeeEmails:['daniel@ds.ie','lucas@ds.ie'], tags:['very-early','industrial'] },
  { externalId:'scenario-riverstone', client:'Riverstone Education', site:'Rathmines Campus', addressLine1:'Upper Rathmines Road', city:'Dublin', postalCode:'D06', latitude:53.3229, longitude:-6.2648, startMinute:16*60+30, durationMinutes:150, employeeEmails:['sofia@ds.ie','emma@ds.ie'], tags:['afternoon','education'] },
  { externalId:'scenario-beacon-fitness', client:'Beacon Fitness', site:'Ballsbridge Club', addressLine1:'Shelbourne Road', city:'Dublin', postalCode:'D04', latitude:53.3317, longitude:-6.2315, startMinute:21*60, durationMinutes:120, employeeEmails:['aoife@ds.ie','john@ds.ie'], tags:['night','fitness'] },
]
