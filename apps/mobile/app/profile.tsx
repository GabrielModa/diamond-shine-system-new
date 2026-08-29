import { Button, Card, EmptyState, PageHeader, Screen } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { addOperationalDays, formatMinuteOfDay, formatOperationalDate, operationalDateKey, operationalDateTimeInput, operationalInputToUtc } from '@/lib/operational-time';
import { colors } from '@/lib/theme';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

type FlatWindow = { dayOfWeek: number; startsMinute: number; endsMinute: number };
type FlatRecurring = FlatWindow & { reason: string | null };
type WindowGroup = { id: string; days: number[]; startsMinute: number; endsMinute: number; reason: string };
type Profile = {
  phone: string | null;
  home: { label: string; address: string; latitude: number | null; longitude: number | null };
  travelMode: 'driving' | 'transit' | 'cycling';
  emergencyContact: { name: string; phone: string } | null;
  school: { name: string; address: string; latitude: number | null; longitude: number | null } | null;
  studySchedule: FlatWindow[];
  recurringUnavailability: FlatRecurring[];
};
type Data = {
  user: { name: string | null; email: string };
  profile: Profile | null;
  setupRequired: boolean;
  managerSetupRequired: boolean;
};
type Availability = { id: string; startsAt: string; endsAt: string; reason?: string | null };

type SavedAvailability = Availability & {
  noticeLevel: 'planned' | 'late' | 'urgent';
  affectedAssignments: number;
  managementNotified: boolean;
};

const dayOptions = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']] as const;
const groupId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const minutesToTime = (minutes: number) => formatMinuteOfDay(minutes);
const timeToMinutes = (value: string) => {
  const match = /^(\d{1,2}):(\d{2})\s*(am|pm)?$/i.exec(value.trim());
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const period = match[3]?.toLowerCase();
  if (minutes < 0 || minutes > 59) return null;
  if (period) {
    if (hours < 1 || hours > 12) return null;
    hours %= 12;
    if (period === 'pm') hours += 12;
  } else if (hours < 0 || hours > 23) return null;
  return hours * 60 + minutes;
};
const validPhone = (value: string) => {
  let compact = value.trim().replace(/[\s().-]/g, '');
  if (compact.startsWith('00')) compact = `+${compact.slice(2)}`;
  if (/^0\d{8,10}$/.test(compact)) compact = `+353${compact.slice(1)}`;
  return /^\+[1-9]\d{7,14}$/.test(compact);
};

function groupFlat(rules: Array<FlatWindow | FlatRecurring>, includeReason: boolean) {
  const grouped = new Map<string, WindowGroup>();
  for (const rule of rules) {
    const reason = includeReason && 'reason' in rule ? rule.reason ?? '' : '';
    const key = `${rule.startsMinute}|${rule.endsMinute}|${reason}`;
    const current = grouped.get(key);
    if (current) current.days.push(rule.dayOfWeek);
    else grouped.set(key, { id: groupId(), days: [rule.dayOfWeek], startsMinute: rule.startsMinute, endsMinute: rule.endsMinute, reason });
  }
  return Array.from(grouped.values()).map((group) => ({ ...group, days: [...group.days].sort((a, b) => a - b) }));
}

function expandGroups(groups: WindowGroup[], includeReason: boolean) {
  return groups.flatMap((group) => group.days.map((dayOfWeek) => ({
    dayOfWeek,
    startsMinute: group.startsMinute,
    endsMinute: group.endsMinute,
    ...(includeReason ? { reason: group.reason.trim() || null } : {}),
  })));
}

function groupError(groups: WindowGroup[], label: string) {
  if (groups.some((group) => !group.days.length)) return `${label}: choose at least one day.`;
  if (groups.some((group) => group.endsMinute <= group.startsMinute)) return `${label}: Until must be later than From.`;
  const flat = expandGroups(groups, false);
  for (const [day] of dayOptions) {
    const rules = flat.filter((rule) => rule.dayOfWeek === day).sort((a, b) => a.startsMinute - b.startsMinute);
    for (let i = 1; i < rules.length; i += 1) if (rules[i].startsMinute < rules[i - 1].endsMinute) return `${label}: overlapping times are not allowed.`;
  }
  return null;
}

export default function ProfileScreen() {
  const { session } = useAuth();
  const timezone = session?.timezone ?? 'Europe/Dublin';
  const tomorrow = addOperationalDays(operationalDateKey(new Date(), timezone), 1);
  const [data, setData] = useState<Data | null>(null);
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [travelMode, setTravelMode] = useState<Profile['travelMode']>('transit');
  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [schoolName, setSchoolName] = useState('');
  const [schoolAddress, setSchoolAddress] = useState('');
  const [studyGroups, setStudyGroups] = useState<WindowGroup[]>([]);
  const [recurringGroups, setRecurringGroups] = useState<WindowGroup[]>([]);
  const [entries, setEntries] = useState<Availability[]>([]);
  const [startsAt, setStartsAt] = useState(`${tomorrow}T09:00`);
  const [endsAt, setEndsAt] = useState(`${tomorrow}T17:00`);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  const [message, setMessage] = useState('');

  const applyProfile = useCallback((next: Data) => {
    setData(next);
    setPhone(next.profile?.phone ?? '');
    setAddress(next.profile?.home.address ?? '');
    setTravelMode(next.profile?.travelMode ?? 'transit');
    setEmergencyName(next.profile?.emergencyContact?.name ?? '');
    setEmergencyPhone(next.profile?.emergencyContact?.phone ?? '');
    setSchoolName(next.profile?.school?.name ?? '');
    setSchoolAddress(next.profile?.school?.address ?? '');
    setStudyGroups(groupFlat(next.profile?.studySchedule ?? [], false));
    setRecurringGroups(groupFlat(next.profile?.recurringUnavailability ?? [], true));
  }, []);

  const refresh = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      const [profile, availability] = await Promise.all([
        apiFetch<Data>(session, '/api/workforce/profile'),
        apiFetch<Availability[]>(session, '/api/availability'),
      ]);
      applyProfile(profile);
      setEntries(availability);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load profile.');
    } finally {
      setLoading(false);
    }
  }, [applyProfile, session]);

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  const activeEntries = useMemo(() => entries.filter((entry) => new Date(entry.endsAt).getTime() > Date.now()), [entries]);
  const personalSetupRequired = Boolean(data && (!data.profile || !data.profile.phone || data.profile.home.latitude == null || data.profile.home.longitude == null || (data.profile.school && (data.profile.school.latitude == null || data.profile.school.longitude == null))));

  function toggleDay(kind: 'study' | 'recurring', index: number, day: number) {
    const setter = kind === 'study' ? setStudyGroups : setRecurringGroups;
    setter((current) => current.map((group, groupIndex) => groupIndex !== index ? group : {
      ...group,
      days: group.days.includes(day) ? group.days.filter((value) => value !== day) : [...group.days, day].sort((a, b) => a - b),
    }));
  }

  function updateGroup(kind: 'study' | 'recurring', index: number, patch: Partial<WindowGroup>) {
    const setter = kind === 'study' ? setStudyGroups : setRecurringGroups;
    setter((current) => current.map((group, groupIndex) => groupIndex === index ? { ...group, ...patch } : group));
  }

  function setGroupDays(kind: 'study' | 'recurring', index: number, days: number[]) {
    updateGroup(kind, index, { days: [...days] });
  }

  function updateTime(kind: 'study' | 'recurring', index: number, key: 'startsMinute' | 'endsMinute', value: string) {
    const minutes = timeToMinutes(value);
    if (minutes == null) { setMessage('Use a time like 9:00 am or 1:30 pm.'); return; }
    updateGroup(kind, index, { [key]: minutes });
  }

  async function saveProfile() {
    if (!session) return;
    if (!phone.trim() || !validPhone(phone)) { setMessage('Enter a valid phone number, for example +353871234567.'); return; }
    if (address.trim().length < 5) { setMessage('Enter your full home / operational starting address.'); return; }
    if (Boolean(emergencyName.trim()) !== Boolean(emergencyPhone.trim())) { setMessage('Enter both emergency contact fields or leave both blank.'); return; }
    if (emergencyPhone.trim() && !validPhone(emergencyPhone)) { setMessage('Enter a valid emergency contact phone number.'); return; }
    if (Boolean(schoolName.trim()) !== Boolean(schoolAddress.trim())) { setMessage('Enter both school name and school address, or leave both blank.'); return; }
    if (!schoolName.trim() && studyGroups.length) { setMessage('Add the school location before study hours.'); return; }
    const studyError = groupError(studyGroups, 'Study hours'); if (studyError) { setMessage(studyError); return; }
    const recurringError = groupError(recurringGroups, 'Weekly unavailability'); if (recurringError) { setMessage(recurringError); return; }

    setBusy(true); setMessage('');
    try {
      const next = await apiFetch<Data>(session, '/api/workforce/profile', {
        method: 'PUT',
        body: JSON.stringify({
          phone: phone.trim(),
          home: { address: address.trim() },
          travelMode,
          emergencyContact: emergencyName.trim() && emergencyPhone.trim() ? { name: emergencyName.trim(), phone: emergencyPhone.trim() } : null,
          school: schoolName.trim() && schoolAddress.trim() ? { name: schoolName.trim(), address: schoolAddress.trim() } : null,
          studySchedule: schoolName.trim() ? expandGroups(studyGroups, false) : [],
          recurringUnavailability: expandGroups(recurringGroups, true),
        }),
      });
      applyProfile(next);
      setMessage('Profile saved. Addresses were validated for mapping and your normal weekly restrictions are active for scheduling.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save profile.');
    } finally {
      setBusy(false);
    }
  }

  async function saveTemporary() {
    if (!session) return;
    const start = operationalInputToUtc(startsAt, timezone);
    const end = operationalInputToUtc(endsAt, timezone);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) { setMessage('Temporary unavailability must end after it starts.'); return; }
    setAvailabilityBusy(true); setMessage('');
    try {
      const saved = await apiFetch<SavedAvailability>(session, '/api/availability', {
        method: 'POST', body: JSON.stringify({ startsAt: start.toISOString(), endsAt: end.toISOString(), reason: reason.trim() || null }),
      });
      setReason('');
      const notice = saved.noticeLevel === 'urgent' ? 'Urgent change saved.' : saved.noticeLevel === 'late' ? 'Late-notice change saved.' : 'Planned change saved.';
      const impact = saved.affectedAssignments ? ` ${saved.affectedAssignments} assignment(s) need review.` : '';
      setMessage(`${notice}${impact}${saved.managementNotified ? ' Operations was notified.' : ''} No client visit was cancelled automatically.`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save temporary unavailability.');
    } finally {
      setAvailabilityBusy(false);
    }
  }

  async function removeTemporary(id: string) {
    if (!session) return;
    setAvailabilityBusy(true);
    try { await apiFetch(session, `/api/availability/${id}`, { method: 'DELETE' }); setMessage('Temporary unavailability removed.'); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not remove unavailability.'); }
    finally { setAvailabilityBusy(false); }
  }

  function preset(days: number, durationHours: number) {
    const dateKey = addOperationalDays(operationalDateKey(new Date(), timezone), days);
    const startInput = `${dateKey}T09:00`;
    const startUtc = operationalInputToUtc(startInput, timezone);
    const endUtc = new Date(startUtc.getTime() + durationHours * 3_600_000);
    setStartsAt(startInput);
    setEndsAt(operationalDateTimeInput(endUtc, timezone));
  }

  if (loading && !data) return <Screen><PageHeader eyebrow="My details" title="My profile" subtitle="Loading your operational profile." /><ActivityIndicator color={colors.primary} /></Screen>;
  if (!data) return <Screen><PageHeader eyebrow="My details" title="My profile" subtitle="Could not load your profile." />{message ? <Text style={styles.message}>{message}</Text> : null}</Screen>;

  return <Screen>
    <PageHeader eyebrow="My operational profile" title="My profile" subtitle="Set the real details that affect where and when you can work. Your company sets your name and login email." />
    {message ? <Text style={styles.message}>{message}</Text> : null}
    {personalSetupRequired ? <Card><Text style={styles.title}>Complete your operational profile</Text><Text style={styles.help}>Add a valid phone and mapped home address. Add school or normal-week restrictions when they apply to you.</Text></Card> : null}

    <Card>
      <Text style={styles.title}>Identity & contact</Text>
      <Text style={styles.help}>Name and work email are locked after invitation. Only an administrator can change them.</Text>
      <Text style={styles.label}>Name</Text><Text style={styles.readonly}>{data.user.name ?? '—'}</Text>
      <Text style={styles.label}>Work email</Text><Text style={styles.readonly}>{data.user.email}</Text>
      <Text style={styles.label}>Phone</Text><TextInput style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+353 87 123 4567" />
      <Text style={styles.label}>Emergency contact name (optional)</Text><TextInput style={styles.input} value={emergencyName} onChangeText={setEmergencyName} />
      <Text style={styles.label}>Emergency contact phone (optional)</Text><TextInput style={styles.input} value={emergencyPhone} onChangeText={setEmergencyPhone} keyboardType="phone-pad" />
    </Card>

    <Card>
      <Text style={styles.title}>Home & travel</Text>
      <Text style={styles.help}>Your home / starting address is validated against Google Maps when saved so routing uses real coordinates.</Text>
      <Text style={styles.label}>Home / operational starting address</Text><TextInput style={styles.input} value={address} onChangeText={setAddress} placeholder="Street, city, postcode" />
      <Text style={styles.validation}>{data.profile?.home.latitude != null ? '✓ Validated for mapping' : 'Will be validated when you save'}</Text>
      <Text style={styles.label}>Travel mode</Text>
      <View style={styles.modes}>{(['driving', 'transit', 'cycling'] as const).map((mode) => <Pressable key={mode} onPress={() => setTravelMode(mode)} style={[styles.mode, travelMode === mode && styles.modeActive]}><Text style={[styles.modeText, travelMode === mode && styles.modeTextActive]}>{mode === 'driving' ? 'Drive' : mode === 'transit' ? 'Transit' : 'Cycle'}</Text></Pressable>)}</View>
    </Card>

    <Card>
      <Text style={styles.title}>School & study</Text>
      <Text style={styles.help}>Optional. Study hours are recurring unavailability and block automatic scheduling. One block can cover several days.</Text>
      <Text style={styles.label}>School / study location</Text><TextInput style={styles.input} value={schoolName} onChangeText={setSchoolName} placeholder="College / school name" />
      <Text style={styles.label}>School address</Text><TextInput style={styles.input} value={schoolAddress} onChangeText={setSchoolAddress} placeholder="Street, city, postcode" />
      {schoolAddress.trim() ? <Text style={styles.validation}>{data.profile?.school?.latitude != null ? '✓ Validated for mapping' : 'Will be validated when you save'}</Text> : null}
      {studyGroups.map((group, index) => <View style={styles.windowCard} key={group.id}>
        <Text style={styles.windowTitle}>Study block {index + 1}</Text>
        <View style={styles.presets}><Pressable style={styles.preset} onPress={() => setGroupDays('study', index, [1,2,3,4,5])}><Text style={styles.presetText}>Weekdays</Text></Pressable><Pressable style={styles.preset} onPress={() => setGroupDays('study', index, [6,7])}><Text style={styles.presetText}>Weekend</Text></Pressable><Pressable style={styles.preset} onPress={() => setGroupDays('study', index, [1,2,3,4,5,6,7])}><Text style={styles.presetText}>Every day</Text></Pressable></View>
        <View style={styles.days}>{dayOptions.map(([day, label]) => <Pressable key={day} onPress={() => toggleDay('study', index, day)} style={[styles.day, group.days.includes(day) && styles.dayActive]}><Text style={[styles.dayText, group.days.includes(day) && styles.dayTextActive]}>{label}</Text></Pressable>)}</View>
        <View style={styles.timeRow}><View style={styles.timeField}><Text style={styles.label}>From</Text><TextInput style={styles.input} defaultValue={minutesToTime(group.startsMinute)} onEndEditing={(event) => updateTime('study', index, 'startsMinute', event.nativeEvent.text)} /></View><View style={styles.timeField}><Text style={styles.label}>Until</Text><TextInput style={styles.input} defaultValue={minutesToTime(group.endsMinute)} onEndEditing={(event) => updateTime('study', index, 'endsMinute', event.nativeEvent.text)} /></View></View>
        <Pressable onPress={() => setStudyGroups((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Text style={styles.remove}>Remove block</Text></Pressable>
      </View>)}
      <Pressable disabled={!schoolName.trim() || !schoolAddress.trim()} onPress={() => setStudyGroups((current) => [...current, { id: groupId(), days: [1,2,3,4,5], startsMinute: 540, endsMinute: 750, reason: '' }])} style={[styles.add, (!schoolName.trim() || !schoolAddress.trim()) && styles.addDisabled]}><Text style={styles.addText}>+ Add study block</Text></Pressable>
    </Card>

    <Card>
      <Text style={styles.title}>My normal week</Text>
      <Text style={styles.help}>Add times you are regularly unavailable every week, such as another job or a regular commitment. Select multiple days for the same hours.</Text>
      {recurringGroups.map((group, index) => <View style={styles.windowCard} key={group.id}>
        <Text style={styles.windowTitle}>Unavailable block {index + 1}</Text>
        <View style={styles.presets}><Pressable style={styles.preset} onPress={() => setGroupDays('recurring', index, [1,2,3,4,5])}><Text style={styles.presetText}>Weekdays</Text></Pressable><Pressable style={styles.preset} onPress={() => setGroupDays('recurring', index, [6,7])}><Text style={styles.presetText}>Weekend</Text></Pressable><Pressable style={styles.preset} onPress={() => setGroupDays('recurring', index, [1,2,3,4,5,6,7])}><Text style={styles.presetText}>Every day</Text></Pressable></View>
        <View style={styles.days}>{dayOptions.map(([day, label]) => <Pressable key={day} onPress={() => toggleDay('recurring', index, day)} style={[styles.day, group.days.includes(day) && styles.dayActive]}><Text style={[styles.dayText, group.days.includes(day) && styles.dayTextActive]}>{label}</Text></Pressable>)}</View>
        <View style={styles.timeRow}><View style={styles.timeField}><Text style={styles.label}>From</Text><TextInput style={styles.input} defaultValue={minutesToTime(group.startsMinute)} onEndEditing={(event) => updateTime('recurring', index, 'startsMinute', event.nativeEvent.text)} /></View><View style={styles.timeField}><Text style={styles.label}>Until</Text><TextInput style={styles.input} defaultValue={minutesToTime(group.endsMinute)} onEndEditing={(event) => updateTime('recurring', index, 'endsMinute', event.nativeEvent.text)} /></View></View>
        <Text style={styles.label}>Reason (optional)</Text><TextInput style={styles.input} value={group.reason} onChangeText={(value) => updateGroup('recurring', index, { reason: value })} placeholder="Other job, regular commitment…" />
        <Pressable onPress={() => setRecurringGroups((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Text style={styles.remove}>Remove block</Text></Pressable>
      </View>)}
      <Pressable onPress={() => setRecurringGroups((current) => [...current, { id: groupId(), days: [1,2,3,4,5], startsMinute: 540, endsMinute: 1020, reason: '' }])} style={styles.add}><Text style={styles.addText}>+ Add weekly unavailable block</Text></Pressable>
      <Text style={styles.help}>Later changes are audited and can notify operations. Published visits are never silently cancelled.</Text>
    </Card>

    <Button title="Save my profile & normal week" onPress={() => void saveProfile()} loading={busy} />

    <Card>
      <Text style={styles.title}>Temporary changes</Text>
      <Text style={styles.help}>One-off appointment, trip or day off. 7+ days is planned, under 7 days is late notice, under 24 hours is urgent.</Text>
      <View style={styles.presets}><Pressable style={styles.preset} onPress={() => preset(1, 8)}><Text style={styles.presetText}>Tomorrow · full day</Text></Pressable><Pressable style={styles.preset} onPress={() => preset(7, 8)}><Text style={styles.presetText}>Next week · full day</Text></Pressable></View>
      <Text style={styles.label}>From</Text><TextInput value={startsAt} onChangeText={setStartsAt} autoCapitalize="none" style={styles.input} placeholder="2026-08-29T09:00" />
      <Text style={styles.label}>Until</Text><TextInput value={endsAt} onChangeText={setEndsAt} autoCapitalize="none" style={styles.input} placeholder="2026-08-29T17:00" />
      <Text style={styles.label}>Reason (optional)</Text><TextInput value={reason} onChangeText={setReason} style={[styles.input, styles.reason]} multiline />
      <Button title="Add temporary unavailability" loading={availabilityBusy} onPress={() => void saveTemporary()} />
    </Card>

    <View style={styles.section}><Text style={styles.title}>Current & upcoming temporary changes</Text>{activeEntries.length ? activeEntries.map((entry) => <Card key={entry.id}><View style={styles.entryHead}><View style={styles.entryCopy}><Text style={styles.entryTitle}>{formatOperationalDate(entry.startsAt, timezone, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} → {formatOperationalDate(entry.endsAt, timezone, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Text>{entry.reason ? <Text style={styles.help}>{entry.reason}</Text> : null}</View><Pressable onPress={() => void removeTemporary(entry.id)} disabled={availabilityBusy}><Text style={styles.remove}>Remove</Text></Pressable></View></Card>) : <EmptyState title="Nothing declared" body="No current or upcoming temporary unavailability." />}</View>
  </Screen>;
}

const styles = StyleSheet.create({
  section: { gap: 10 }, title: { color: colors.ink, fontSize: 18, fontWeight: '900' }, windowTitle: { color: colors.ink, fontSize: 14, fontWeight: '900' },
  help: { color: colors.muted, fontSize: 12, lineHeight: 18 }, label: { color: colors.ink, fontSize: 12, fontWeight: '800', marginTop: 4 },
  input: { minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: 11, paddingHorizontal: 12, color: colors.ink, backgroundColor: '#FBFCFD' },
  readonly: { color: colors.muted, minHeight: 34, paddingVertical: 7 }, validation: { color: colors.primaryDark, fontSize: 11, fontWeight: '700' },
  message: { color: colors.primaryDark, backgroundColor: colors.primarySoft, padding: 12, borderRadius: 12, fontWeight: '700' },
  modes: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' }, mode: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: colors.border }, modeActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary }, modeText: { color: colors.ink, fontWeight: '800' }, modeTextActive: { color: colors.primaryDark },
  windowCard: { gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12 }, days: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, day: { borderWidth: 1, borderColor: colors.border, borderRadius: 9, paddingHorizontal: 8, paddingVertical: 7 }, dayActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary }, dayText: { color: colors.ink, fontWeight: '800', fontSize: 11 }, dayTextActive: { color: colors.primaryDark },
  timeRow: { flexDirection: 'row', gap: 8 }, timeField: { flex: 1 }, remove: { color: colors.danger, fontWeight: '800', paddingVertical: 6 }, add: { borderWidth: 1, borderColor: colors.primary, borderRadius: 11, padding: 12, alignItems: 'center' }, addDisabled: { opacity: 0.45 }, addText: { color: colors.primaryDark, fontWeight: '900' },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, preset: { minHeight: 38, paddingHorizontal: 10, justifyContent: 'center', borderRadius: 10, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: '#BFE7D0' }, presetText: { color: colors.primaryDark, fontSize: 11, fontWeight: '800' }, reason: { minHeight: 78, textAlignVertical: 'top', paddingTop: 10 },
  entryHead: { flexDirection: 'row', gap: 8, justifyContent: 'space-between', alignItems: 'flex-start' }, entryCopy: { flex: 1, gap: 4 }, entryTitle: { color: colors.ink, fontWeight: '800', lineHeight: 20 },
});
