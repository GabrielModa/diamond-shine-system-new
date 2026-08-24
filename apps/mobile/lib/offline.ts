import * as SQLite from 'expo-sqlite';
import { apiFetch } from './api';
import type { Session, Visit } from './types';

export type OfflineOperation = {
  clientMutationId: string;
  type: 'visit.start' | 'visit.task.update' | 'visit.evidence.create' | 'visit.incident.create' | 'material.stock.count' | 'time.start' | 'time.stop' | 'visit.complete';
  entityId: string;
  clientCreatedAt: string;
  payload: Record<string, unknown>;
};

export type LocalTimer = {
  visitId: string;
  startMutationId: string;
  startedAt: string;
};

let database: Promise<SQLite.SQLiteDatabase> | null = null;
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
  return value;
}

export function mutationId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function cacheVisits(visits: Visit[]) {
  const connection = await db();
  await connection.withTransactionAsync(async () => {
    for (const visit of visits) {
      await connection.runAsync('INSERT OR REPLACE INTO cached_visits (id, payload, updated_at) VALUES (?, ?, ?)', visit.id, JSON.stringify(visit), new Date().toISOString());
    }
  });
}

export async function cachedVisits() {
  const connection = await db();
  const rows = await connection.getAllAsync<{ payload: string }>('SELECT payload FROM cached_visits ORDER BY updated_at DESC');
  return rows.map((row) => JSON.parse(row.payload) as Visit);
}

export async function cachedVisit(id: string) {
  const connection = await db();
  const row = await connection.getFirstAsync<{ payload: string }>('SELECT payload FROM cached_visits WHERE id = ?', id);
  return row ? JSON.parse(row.payload) as Visit : null;
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

export async function enqueue(operation: OfflineOperation) {
  const connection = await db();
  await connection.runAsync('INSERT OR REPLACE INTO mutation_queue (id, payload, created_at) VALUES (?, ?, ?)', operation.clientMutationId, JSON.stringify(operation), operation.clientCreatedAt);
}

export async function pendingCount() {
  const connection = await db();
  const row = await connection.getFirstAsync<{ count: number }>('SELECT (SELECT COUNT(*) FROM mutation_queue) + (SELECT COUNT(*) FROM evidence_queue) AS count');
  return row?.count ?? 0;
}

export async function queueEvidence(input: { id: string; visitId: string; taskResultId?: string | null; uri: string; mimeType?: string; phase?: string }) {
  const connection = await db();
  await connection.runAsync('INSERT OR REPLACE INTO evidence_queue (id, visit_id, task_result_id, uri, mime_type, phase, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', input.id, input.visitId, input.taskResultId ?? null, input.uri, input.mimeType ?? 'image/jpeg', input.phase ?? 'task', new Date().toISOString());
}

export async function setLocalTimer(timer: LocalTimer) {
  const connection = await db();
  await connection.runAsync(
    'INSERT OR REPLACE INTO local_timers (visit_id, start_mutation_id, started_at) VALUES (?, ?, ?)',
    timer.visitId,
    timer.startMutationId,
    timer.startedAt,
  );
}

export async function getLocalTimer(visitId: string) {
  const connection = await db();
  const row = await connection.getFirstAsync<{ visit_id: string; start_mutation_id: string; started_at: string }>(
    'SELECT visit_id, start_mutation_id, started_at FROM local_timers WHERE visit_id = ?',
    visitId,
  );
  return row ? { visitId: row.visit_id, startMutationId: row.start_mutation_id, startedAt: row.started_at } satisfies LocalTimer : null;
}

export async function getGenericLocalTimer() {
  const connection = await db();
  const row = await connection.getFirstAsync<{ visit_id: string; start_mutation_id: string; started_at: string }>(
    "SELECT visit_id, start_mutation_id, started_at FROM local_timers WHERE visit_id LIKE 'general:%' LIMIT 1",
  );
  return row ? { visitId: row.visit_id, startMutationId: row.start_mutation_id, startedAt: row.started_at } satisfies LocalTimer : null;
}

export async function clearLocalTimer(visitId: string) {
  const connection = await db();
  await connection.runAsync('DELETE FROM local_timers WHERE visit_id = ?', visitId);
}

async function syncEvidence(session: Session) {
  const connection = await db();
  const rows = await connection.getAllAsync<{ id: string; visit_id: string; task_result_id?: string | null; uri: string; mime_type: string; phase: string }>('SELECT id, visit_id, task_result_id, uri, mime_type, phase FROM evidence_queue ORDER BY created_at ASC LIMIT 20');
  let processed = 0;
  for (const row of rows) {
    try {
      const form = new FormData();
      form.append('file', { uri: row.uri, name: `${row.id}.jpg`, type: row.mime_type } as unknown as Blob);
      if (row.task_result_id) form.append('taskResultId', row.task_result_id);
      form.append('phase', row.phase); form.append('visibility', 'client_safe');
      await apiFetch(session, `/api/visits/${row.visit_id}/evidence-upload`, { method: 'POST', body: form });
      await connection.runAsync('DELETE FROM evidence_queue WHERE id = ?', row.id); processed += 1;
    } catch (cause) {
      await connection.runAsync('UPDATE evidence_queue SET attempts = attempts + 1, last_error = ? WHERE id = ?', cause instanceof Error ? cause.message : 'UPLOAD_FAILED', row.id);
    }
  }
  return processed;
}

export async function syncPending(session: Session, deviceId: string) {
  const connection = await db();
  const uploaded = await syncEvidence(session);
  const rows = await connection.getAllAsync<{ id: string; payload: string }>('SELECT id, payload FROM mutation_queue ORDER BY created_at ASC LIMIT 100');
  if (!rows.length) return { processed: uploaded, remaining: await pendingCount() };
  const operations = rows.map((row) => JSON.parse(row.payload) as OfflineOperation);
  const result = await apiFetch<{ results: Array<{ clientMutationId: string; status: string; error?: string }> }>(session, '/api/sync', {
    method: 'POST', body: JSON.stringify({ deviceId, operations }),
  });
  for (const item of result.results) {
    if (item.status === 'processed' || item.status === 'duplicate') {
      await connection.runAsync('DELETE FROM mutation_queue WHERE id = ?', item.clientMutationId);
    } else {
      await connection.runAsync('UPDATE mutation_queue SET attempts = attempts + 1, last_error = ? WHERE id = ?', item.error ?? item.status, item.clientMutationId);
    }
  }
  return { processed: uploaded + result.results.filter((item) => item.status === 'processed' || item.status === 'duplicate').length, remaining: await pendingCount() };
}
