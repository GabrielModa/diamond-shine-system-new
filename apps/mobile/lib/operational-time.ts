export type OperationalDayRange = { key: string; from: string; to: string };

type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function asDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError('Invalid date value');
  return date;
}

function zonedParts(value: Date | string, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(asDate(value));
  const bag = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return {
    year: Number(bag.year), month: Number(bag.month), day: Number(bag.day),
    hour: Number(bag.hour), minute: Number(bag.minute), second: Number(bag.second),
  };
}

function pad(value: number) { return String(value).padStart(2, '0'); }

export function operationalDateKey(value: Date | string, timeZone = 'Europe/Dublin') {
  const part = zonedParts(value, timeZone);
  return `${part.year}-${pad(part.month)}-${pad(part.day)}`;
}

export function operationalDateTimeInput(value: Date | string, timeZone = 'Europe/Dublin') {
  const part = zonedParts(value, timeZone);
  return `${part.year}-${pad(part.month)}-${pad(part.day)}T${pad(part.hour)}:${pad(part.minute)}`;
}

export function addOperationalDays(key: string, days: number) {
  const [year, month, day] = key.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
}

function zoneOffsetMs(date: Date, timeZone: string) {
  const part = zonedParts(date, timeZone);
  const wallClockAsUtc = Date.UTC(part.year, part.month - 1, part.day, part.hour, part.minute, part.second);
  return wallClockAsUtc - Math.floor(date.getTime() / 1000) * 1000;
}

export function zonedDateTimeToUtc(dateKey: string, time = '00:00', timeZone = 'Europe/Dublin') {
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hour = 0, minute = 0, second = 0] = time.split(':').map(Number);
  const targetWallClock = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = new Date(targetWallClock);
  for (let index = 0; index < 5; index += 1) {
    const next = new Date(targetWallClock - zoneOffsetMs(guess, timeZone));
    if (Math.abs(next.getTime() - guess.getTime()) < 1000) return next;
    guess = next;
  }
  return guess;
}

export function operationalInputToUtc(input: string, timeZone = 'Europe/Dublin') {
  const [dateKey, clock = '00:00'] = input.split('T');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !/^\d{2}:\d{2}(?::\d{2})?$/.test(clock)) return new Date(Number.NaN);
  return zonedDateTimeToUtc(dateKey, clock, timeZone);
}

export function operationalDayRange(value: Date | string, timeZone = 'Europe/Dublin'): OperationalDayRange {
  const key = operationalDateKey(value, timeZone);
  const nextKey = addOperationalDays(key, 1);
  return {
    key,
    from: zonedDateTimeToUtc(key, '00:00', timeZone).toISOString(),
    to: zonedDateTimeToUtc(nextKey, '00:00', timeZone).toISOString(),
  };
}

export function operationalGreeting(value: Date | string, timeZone = 'Europe/Dublin') {
  const hour = zonedParts(value, timeZone).hour;
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function formatOperationalTime(value: Date | string, timeZone = 'Europe/Dublin') {
  return new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone }).format(asDate(value));
}

export function formatOperationalDate(value: Date | string, timeZone = 'Europe/Dublin', options?: Intl.DateTimeFormatOptions) {
  const selected = options ?? { day: 'numeric', month: 'short' };
  const hasTime = Boolean(selected.hour || selected.minute || selected.second);
  return new Intl.DateTimeFormat(hasTime ? 'en-GB' : 'en-IE', { timeZone, ...(hasTime ? { hour12: true } : {}), ...selected }).format(asDate(value));
}

export function formatMinuteOfDay(minutes: number) {
  const normalized = Math.min(1439, Math.max(0, Math.round(minutes)));
  const hour24 = Math.floor(normalized / 60);
  const minute = normalized % 60;
  const hour12 = hour24 % 12 || 12;
  const period = hour24 >= 12 ? 'pm' : 'am';
  return `${hour12}:${pad(minute)} ${period}`;
}
