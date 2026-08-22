export type Person = { id: string; name?: string | null; email: string };

export type Site = {
  id: string;
  name: string;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  postalCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  geofenceVerifiedM?: number;
  geofenceNearM?: number;
  geofenceSuspiciousM?: number;
  client: { id: string; displayName: string };
};

export type TaskResult = {
  id: string;
  version: number;
  status: 'pending' | 'done' | 'not_applicable' | 'problem';
  note?: string | null;
  response?: unknown;
  versionTask: {
    id: string;
    title: string;
    instructions?: string | null;
    required: boolean;
    evidenceRequired: boolean;
    responseType: string;
  };
  evidence?: Array<{ id: string; kind: string }>;
};

export type TimeEntry = {
  id: string;
  status: string;
  startedAt: string;
  endedAt?: string | null;
  durationSeconds?: number | null;
};

export type Visit = {
  id: string;
  status: string;
  scheduledStart: string;
  scheduledEnd: string;
  dispatchNotes?: string | null;
  completionNotes?: string | null;
  site: Site;
  job?: { id: string; name: string };
  assignments?: Array<{ user: Person }>;
  taskResults?: TaskResult[];
  timeEntries?: TimeEntry[];
  incidents?: Array<{ id: string; title: string; severity: string; status: string }>;
};

export type Notice = {
  id: string;
  type: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  title: string;
  body: string;
  publishedAt: string;
  requiresAcknowledgement: boolean;
  createdBy: Person;
  site?: Site | null;
  recipients: Array<{ seenAt?: string | null; acknowledgedAt?: string | null }>;
};

export type Session = {
  accessToken: string;
  email: string;
  name?: string | null;
  role: string;
  organizationId: string;
  expiresAt?: string;
  baseUrl: string;
};
