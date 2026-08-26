export type Person = { id: string; name?: string | null; email: string };

export type MembershipRole =
  | 'organization_admin'
  | 'field_supervisor'
  | 'scheduler'
  | 'employee'
  | 'stock_controller'
  | 'quality_inspector'
  | 'finance'
  | 'viewer';

export type Site = {
  id: string;
  name: string;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  postalCode?: string | null;
  timezone?: string;
  latitude?: number | null;
  longitude?: number | null;
  geofenceVerifiedM?: number;
  geofenceNearM?: number;
  geofenceSuspiciousM?: number;
  client: { id: string; displayName: string };
};

export type VersionTask = {
  id: string;
  title: string;
  instructions?: string | null;
  required: boolean;
  evidenceRequired: boolean;
  responseType: string;
  critical?: boolean;
  sortOrder?: number;
};

export type TaskResult = {
  id: string;
  version: number;
  versionTaskId?: string;
  status: 'pending' | 'done' | 'not_applicable' | 'problem';
  note?: string | null;
  response?: unknown;
  versionTask: VersionTask;
  evidence?: Array<{ id: string; kind: string }>;
};

export type TimeEntry = {
  id: string;
  kind: 'visit' | 'driving' | 'office' | 'supplies' | 'break' | 'general';
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
  timezone?: string;
  requiredWorkers?: number;
  dispatchNotes?: string | null;
  completionNotes?: string | null;
  site: Site;
  job?: { id: string; name: string };
  servicePlanVersion?: { tasks: VersionTask[] };
  assignments?: Array<{
    id: string;
    status: 'assigned' | 'notified' | 'seen' | 'acknowledged' | 'declined' | 'removed';
    declineReason?: string | null;
    seenAt?: string | null;
    acknowledgedAt?: string | null;
    declinedAt?: string | null;
    user: Person;
  }>;
  taskResults?: TaskResult[];
  timeEntries?: TimeEntry[];
  incidents?: Array<{ id: string; title: string; severity: string; status: string }>;
  completedAt?: string | null;
  reopenedAt?: string | null;
  reopenReason?: string | null;
  reviews?: Array<{ id: string; decision: string; note?: string | null; createdAt: string; reviewer: Person }>;
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
  membershipRole: MembershipRole;
  organizationId: string;
  timezone: string;
  expiresAt?: string;
  baseUrl: string;
};
