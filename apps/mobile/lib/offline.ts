import * as SQLite from 'expo-sqlite';
import { apiFetch, apiFetchSyncBatch } from './api';
import { persistEvidenceFile, removeEvidenceFile } from './evidence-storage';
import { secureGet, secureSet } from './secure-storage';
import type { Session, TaskResult, VersionTask, Visit } from './types';

export type OfflineOperation = {
  clientMutationId: string;
  type: 'visit.start' | 'visit.task.update' | 'visit.evidence.create' | 'visit.incident.create' | 'material.stock.count' | 'time.start' | 'time.stop' | 'visit.complete';
  entityId: string;
  clientCreatedAt: string;
  payload: Record<string, unknown>;
};
export type LocalTimer = { visitId: string; startMutationId: string; startedAt: string };
export type SyncIssue = { clientMutationId: string; status: 'failed' | 'conflicted'; error?: string };
export type SyncResult = { processed: number; remaining: number; issues: SyncIssue[] };

const WORKSPACE_OWNER_KEY = 'diamond-shine-offline-owner-v1';
let database: Promise<SQLite.SQLiteDatabase> | null = null;
let syncInFlight: Promise<SyncResult> | null = null;

async function db() {
  database ??= SQLite.openDatabaseAsync('diamond-shine-field.db');
  const value = await database;
  await value.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS cached_visits (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS cached_stock (site_id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS mutation_queue (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT);
    CREATE TABLE IF NOT EXISTS evidence_queue (id TEXT PRIMARY KEY NOT NULL, visit_id TEXT NOT NULL, task_result_id TEXT, uri TEXT NOT NULL, mime_type TEXT NOT NULL, phase TEXT NOT NULL, created_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT);
    CREATE TABLE IF NOT EXISTS local_timers (visit_id TEXT PRIMARY KEY NOT NULL, start_mutation_id TEXT NOT NULL, started_at TEXT NOT NULL);
  `);
  const evidenceColumns = await value.getAllAsync<{ name: string }>('PRAGMA table_info(evidence_queue)');
  if (!evidenceColumns.some((column) => column.name === 'version_task_id')) {
    await value.execAsync('ALTER TABLE evidence_queue ADD COLUMN version_task_id TEXT;');
  }
  return value;
}

export function mutationId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeTaskResult(visitId: string, task: VersionTask, existing?: TaskResult): TaskResult {
  if (existing) return { ...existing, versionTaskId: existing.versionTaskId ?? task.id, versionTask: existing.versionTask ?? task };
  return {
    id: `local:${visitId}:${task.id}`,
    version: 1,
    versionTaskId: task.id,
    status: 'pending',
    note: null,
    response: null,
    versionTask: task,
    evidence: [],
  };
}

export function prepareVisitForOffline(visit: Visit): Visit {
  const versionTasks = visit.servicePlanVersion?.tasks ?? [];
  if (!versionTasks.length) return visit;
  const existing = new Map((visit.taskResults ?? []).map((result) => [result.versionTaskId ?? result.versionTask?.id, result]));
  return {
    ...visit,
    taskResults: versionTasks.map((task) => normalizeTaskResult(visit.id, task, existing.get(task.id))),
  };
}

/** Server sync is an operational snapshot. Replace it atomically so cancelled/removed work cannot linger offline. */
export async function cacheVisits(visits: Visit[]) {
  const connection = await db();
  await connection.withTransactionAsync(async () => {
    await connection.runAsync('DELETE FROM cached_visits');
    const updatedAt = new Date().toISOString();
    for (const raw of visits) {
      const visit = prepareVisitForOffline(raw);
      await connection.runAsync('INSERT INTO cached_visits (id, payload, updated_at) VALUES (?, ?, ?)', visit.id, JSON.stringify(visit), updatedAt);
    }
  });
}

export async function updateCachedVisit(visit: Visit) {
  const connection = await db();
  const prepared = prepareVisitForOffline(visit);
  await connection.runAsync('INSERT OR REPLACE INTO cached_visits (id, payload, updated_at) VALUES (?, ?, ?)', prepared.id, JSON.stringify(prepared), new Date().toISOString());
}

export async function cachedVisits() {
  const connection = await db();
  const rows = await connection.getAllAsync<{ payload: string }>('SELECT payload FROM cached_visits ORDER BY updated_at DESC');
  return rows.map((row) => prepareVisitForOffline(JSON.parse(row.payload) as Visit));
}

export async function cachedVisit(id: string) {
  const connection = await db();
  const row = await connection.getFirstAsync<{ payload: string }>('SELECT payload FROM cached_visits WHERE id = ?', id);
  return row ? prepareVisitForOffline(JSON.parse(row.payload) as Visit) : null;
}

export async function cacheStock<T>(siteId: string, items: T[]) {
  const connection = await db();
  await connection.runAsync('INSERT OR REPLACE INTO cached_stock (site_id, payload, updated_at) VALUES (?, ?, ?)', siteId, JSON.stringify(items), new Date().toISOString());
}

export async function cachedStock<T>(siteId: string) {
  const connection = await db();
  const row = await connection.getFirstAsync<{ payload: string }>('SELECT payload FROM cached_stock WHERE site_id = ?', siteId);
  return row ? JSON.parse(row.payload) as T[] : [];
}

async function coalesce(operation: OfflineOperation) {
  const connection = await db();
  const rows = await connection.getAllAsync<{ id: string; payload: string }>('SELECT id, payload FROM mutation_queue');
  for (const row of rows) {
    const pending = JSON.parse(row.payload) as OfflineOperation;
    const sameEntitySingleton = pending.entityId === operation.entityId
      && pending.type === operation.type
      && ['visit.start', 'visit.complete', 'material.stock.count'].includes(operation.type);
    const sameTask = pending.type === 'visit.task.update'
      && operation.type === 'visit.task.update'
      && pending.entityId === operation.entityId
      && pending.payload.versionTaskId === operation.payload.versionTaskId;
    if (sameEntitySingleton || sameTask) await connection.runAsync('DELETE FROM mutation_queue WHERE id = ?', row.id);
  }
}

export async function enqueue(operation: OfflineOperation) {
  await coalesce(operation);
  const connection = await db();
  await connection.runAsync('INSERT OR REPLACE INTO mutation_queue (id, payload, created_at) VALUES (?, ?, ?)', operation.clientMutationId, JSON.stringify(operation), operation.clientCreatedAt);
}

export async function hasPendingOperation(type: OfflineOperation['type'], entityId: string) {
  const connection = await db();
  const rows = await connection.getAllAsync<{ payload: string }>('SELECT payload FROM mutation_queue');
  return rows.some((row) => {
    const operation = JSON.parse(row.payload) as OfflineOperation;
    return operation.type === type && operation.entityId === entityId;
  });
}

export async function pendingCount() {
  const connection = await db();
  const row = await connection.getFirstAsync<{ count: number }>('SELECT (SELECT COUNT(*) FROM mutation_queue) + (SELECT COUNT(*) FROM evidence_queue) AS count');
  return row?.count ?? 0;
}

export async function pendingIssueCount() {
  const connection = await db();
  const row = await connection.getFirstAsync<{ count: number }>("SELECT (SELECT COUNT(*) FROM mutation_queue WHERE last_error IS NOT NULL) + (SELECT COUNT(*) FROM evidence_queue WHERE last_error IS NOT NULL) AS count");
  return row?.count ?? 0;
}

export async function clearOfflineWorkspace() {
  const connection = await db();
  const evidence = await connection.getAllAsync<{ uri: string }>('SELECT uri FROM evidence_queue');
  for (const item of evidence) await removeEvidenceFile(item.uri);
  await connection.withTransactionAsync(async () => {
    await connection.runAsync('DELETE FROM cached_visits');
    await connection.runAsync('DELETE FROM cached_stock');
    await connection.runAsync('DELETE FROM mutation_queue');
    await connection.runAsync('DELETE FROM evidence_queue');
    await connection.runAsync('DELETE FROM local_timers');
  });
}

export class OfflineWorkspaceBusyError extends Error {
  constructor(public pending: number) {
    super(`This device has ${pending} unsynced change${pending === 1 ? '' : 's'} from another account. Sign back into that account and sync before switching users.`);
    this.name = 'OfflineWorkspaceBusyError';
  }
}

export async function claimOfflineWorkspace(owner: string) {
  const previous = await secureGet(WORKSPACE_OWNER_KEY);
  if (!previous) {
    await secureSet(WORKSPACE_OWNER_KEY, owner);
    return;
  }
  if (previous === owner) return;
  const pending = await pendingCount();
  if (pending > 0) throw new OfflineWorkspaceBusyError(pending);
  await clearOfflineWorkspace();
  await secureSet(WORKSPACE_OWNER_KEY, owner);
}

export async function queueEvidence(input: { id: string; visitId: string; taskResultId?: string | null; versionTaskId?: string | null; uri: string; mimeType?: string; phase?: string }) {
  const connection = await db();
  const mimeType = input.mimeType ?? 'image/jpeg';
  const durableUri = await persistEvidenceFile(input.uri, input.id, mimeType);
  try {
    await connection.runAsync(
      'INSERT OR REPLACE INTO evidence_queue (id, visit_id, task_result_id, version_task_id, uri, mime_type, phase, created_at, attempts, last_error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)',
      input.id,
      input.visitId,
      input.taskResultId ?? null,
      input.versionTaskId ?? null,
      durableUri,
      mimeType,
      input.phase ?? 'task',
      new Date().toISOString(),
    );
  } catch (error) {
    await removeEvidenceFile(durableUri);
    throw error;
  }
}

export async function setLocalTimer(timer: LocalTimer) {
  const connection = await db();
  const existing = await getAnyLocalTimer();
  if (existing && existing.visitId !== timer.visitId) {
    throw new Error('Another timer is already running on this device. Stop it before starting new work.');
  }
  await connection.runAsync('INSERT OR REPLACE INTO local_timers (visit_id, start_mutation_id, started_at) VALUES (?, ?, ?)', timer.visitId, timer.startMutationId, timer.startedAt);
}

export async function getLocalTimer(visitId: string) {
  const connection = await db();
  const row = await connection.getFirstAsync<{ visit_id: string; start_mutation_id: string; started_at: string }>('SELECT visit_id, start_mutation_id, started_at FROM local_timers WHERE visit_id = ?', visitId);
  return row ? { visitId: row.visit_id, startMutationId: row.start_mutation_id, startedAt: row.started_at } satisfies LocalTimer : null;
}

export async function getAnyLocalTimer() {
  const connection = await db();
  const row = await connection.getFirstAsync<{ visit_id: string; start_mutation_id: string; started_at: string }>('SELECT visit_id, start_mutation_id, started_at FROM local_timers ORDER BY started_at ASC LIMIT 1');
  return row ? { visitId: row.visit_id, startMutationId: row.start_mutation_id, startedAt: row.started_at } satisfies LocalTimer : null;
}

export async function getGenericLocalTimer() {
  const timer = await getAnyLocalTimer();
  return timer?.visitId.startsWith('general:') ? timer : null;
}

export async function clearLocalTimer(visitId: string) {
  const connection = await db();
  await connection.runAsync('DELETE FROM local_timers WHERE visit_id = ?', visitId);
}

type SyncItem = { clientMutationId: string; status: 'processed' | 'duplicate' | 'failed' | 'conflicted'; error?: string };

async function syncOperationBatch(session: Session, deviceId: string, operations: OfflineOperation[]) {
  if (!operations.length) return { processed: 0, issues: [] as SyncIssue[] };
  const connection = await db();
  const result = await apiFetchSyncBatch<{ results: SyncItem[] }>(session, '/api/sync', {
    method: 'POST',
    body: JSON.stringify({ deviceId, operations }),
  });
  let processed = 0;
  const issues: SyncIssue[] = [];
  for (const item of result.results) {
    if (item.status === 'processed' || item.status === 'duplicate') {
      await connection.runAsync('DELETE FROM mutation_queue WHERE id = ?', item.clientMutationId);
      processed += 1;
    } else {
      await connection.runAsync('UPDATE mutation_queue SET attempts = attempts + 1, last_error = ? WHERE id = ?', item.error ?? item.status, item.clientMutationId);
      issues.push({ clientMutationId: item.clientMutationId, status: item.status, error: item.error });
    }
  }
  return { processed, issues };
}

async function syncEvidence(session: Session) {
  const connection = await db();
  const rows = await connection.getAllAsync<{ id: string; visit_id: string; task_result_id?: string | null; version_task_id?: string | null; uri: string; mime_type: string; phase: string }>(
    'SELECT id, visit_id, task_result_id, version_task_id, uri, mime_type, phase FROM evidence_queue ORDER BY created_at ASC LIMIT 20',
  );
  let processed = 0;
  const issues: SyncIssue[] = [];
  for (const row of rows) {
    try {
      const form = new FormData();
      form.append('file', { uri: row.uri, name: `${row.id}.jpg`, type: row.mime_type } as unknown as Blob);
      if (row.task_result_id && !row.task_result_id.startsWith('local:')) form.append('taskResultId', row.task_result_id);
      else if (row.version_task_id) form.append('versionTaskId', row.version_task_id);
      form.append('phase', row.phase);
      form.append('visibility', 'client_safe');
      await apiFetch(session, `/api/visits/${row.visit_id}/evidence-upload`, { method: 'POST', body: form });
      await connection.runAsync('DELETE FROM evidence_queue WHERE id = ?', row.id);
      await removeEvidenceFile(row.uri);
      processed += 1;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'UPLOAD_FAILED';
      await connection.runAsync('UPDATE evidence_queue SET attempts = attempts + 1, last_error = ? WHERE id = ?', message, row.id);
      issues.push({ clientMutationId: row.id, status: 'failed', error: message });
    }
  }
  return { processed, issues };
}

async function syncPendingInner(session: Session, deviceId: string): Promise<SyncResult> {
  const connection = await db();
  const rows = await connection.getAllAsync<{ payload: string }>('SELECT payload FROM mutation_queue ORDER BY created_at ASC LIMIT 100');
  const operations = rows.map((row) => JSON.parse(row.payload) as OfflineOperation);
  const beforeEvidence = operations.filter((operation) => operation.type !== 'visit.complete');
  const completions = operations.filter((operation) => operation.type === 'visit.complete');

  const first = await syncOperationBatch(session, deviceId, beforeEvidence);
  const evidence = await syncEvidence(session);
  const last = await syncOperationBatch(session, deviceId, completions);
  return {
    processed: first.processed + evidence.processed + last.processed,
    remaining: await pendingCount(),
    issues: [...first.issues, ...evidence.issues, ...last.issues],
  };
}

export async function syncPending(session: Session, deviceId: string): Promise<SyncResult> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = syncPendingInner(session, deviceId);
  try {
    return await syncInFlight;
  } finally {
    syncInFlight = null;
  }
}
