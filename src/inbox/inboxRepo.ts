import AsyncStorage from '@react-native-async-storage/async-storage';
import { Q } from '@/utils/storage/query';
import { map, type Observable } from 'rxjs';

import { database } from '@/utils/storage/database';
import type { InboxEntry } from '@/utils/storage/models';

export type InboxSource = 'siri' | 'test';
export type InboxCaptureImport = { rawText: string; source?: InboxSource; createdAt?: number };

const LAST_DISMISSED_KEY = 'inbox:lastDismissedAt';

const inboxCollection = () => database.collections.get<InboxEntry>('inbox_entries');

export async function getPendingCount(): Promise<number> {
  return inboxCollection().query(Q.where('status', Q.notEq('applied'))).fetchCount();
}

export async function getNewestPendingCreatedAt(): Promise<number | null> {
  const rows = await inboxCollection()
    .query(Q.where('status', Q.notEq('applied')), Q.sortBy('created_at', Q.desc), Q.take(1))
    .fetch();
  return rows[0]?.createdAt ?? null;
}

export function observePendingCount(): Observable<number> {
  return inboxCollection().query(Q.where('status', Q.notEq('applied'))).observeCount();
}

export function observePendingNewestCreatedAt(): Observable<number | null> {
  return inboxCollection()
    .query(Q.where('status', Q.notEq('applied')), Q.sortBy('created_at', Q.desc))
    .observe()
    .pipe(map((rows) => rows[0]?.createdAt ?? null));
}

export async function fetchToReview(): Promise<InboxEntry[]> {
  return inboxCollection()
    .query(Q.where('status', Q.oneOf(['captured', 'parsed'])), Q.sortBy('created_at', Q.desc))
    .fetch();
}

export async function fetchDone(): Promise<InboxEntry[]> {
  return inboxCollection().query(Q.where('status', 'applied'), Q.sortBy('created_at', Q.desc)).fetch();
}

export async function updateInboxEntry(id: string, patch: Partial<Record<string, any>>) {
  await database.write(async () => {
    const entry = await inboxCollection().find(id);
    await entry.update((record: any) => {
      Object.entries(patch).forEach(([key, value]) => {
        record[key] = value;
      });
      record.updatedAt = Date.now();
    });
  });
}

export async function deleteInboxEntry(id: string) {
  await database.write(async () => {
    const entry = await inboxCollection().find(id);
    await entry.destroyPermanently();
  });
}

export async function markApplied(id: string, appliedRefsObj: Record<string, any>) {
  await updateInboxEntry(id, {
    status: 'applied',
    appliedRefsJson: JSON.stringify(appliedRefsObj ?? {}),
    error: null,
  });
}

export async function updateRawText(id: string, newText: string) {
  await updateInboxEntry(id, {
    rawText: newText,
    status: 'captured',
    parsedResultJson: null,
    error: null,
  });
}

export async function setParsedResult(id: string, parsedResultObj: Record<string, any>) {
  await updateInboxEntry(id, {
    status: 'parsed',
    parsedResultJson: JSON.stringify(parsedResultObj ?? {}),
    error: null,
  });
}

export async function inboxAddRawText(rawText: string, source: InboxSource = 'siri'): Promise<string> {
  const now = Date.now();
  const created = await database.write(async () =>
    inboxCollection().create((record: any) => {
      record.createdAt = now;
      record.updatedAt = now;
      record.source = source;
      record.rawText = rawText;
      record.status = 'captured';
      record.parsedResultJson = null;
      record.appliedRefsJson = null;
      record.error = null;
    })
  );
  return created.id;
}

export async function importInboxCaptures(entries: InboxCaptureImport[]): Promise<number> {
  if (!entries.length) {
    return 0;
  }

  let imported = 0;
  await database.write(async () => {
    for (const entry of entries) {
      const rawText = entry.rawText?.trim();
      if (!rawText) {
        continue;
      }

      const createdAt = Number(entry.createdAt);
      const now = Date.now();
      const timestamp = Number.isFinite(createdAt) && createdAt > 0 ? createdAt : now;

      await inboxCollection().create((record: any) => {
        record.createdAt = timestamp;
        record.updatedAt = now;
        record.source = entry.source ?? 'siri';
        record.rawText = rawText;
        record.status = 'captured';
        record.parsedResultJson = null;
        record.appliedRefsJson = null;
        record.error = null;
      });
      imported += 1;
    }
  });

  return imported;
}

export async function getLastDismissedAt(): Promise<number> {
  const raw = await AsyncStorage.getItem(LAST_DISMISSED_KEY);
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function dismissInboxBanner() {
  await AsyncStorage.setItem(LAST_DISMISSED_KEY, String(Date.now()));
}
