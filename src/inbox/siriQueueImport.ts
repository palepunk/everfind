import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import type { InboxSource } from './inboxRepo';
import { importInboxCaptures } from './inboxRepo';

type SiriQueueRow = {
  rawText?: unknown;
  source?: unknown;
  createdAt?: unknown;
};

const APP_GROUP_IDENTIFIER = 'group.online.everfind.app.inbox';
const QUEUE_FILE_NAME = 'everfind_inbox_capture.jsonl';

function getQueueFile(): File | null {
  if (Platform.OS !== 'ios') {
    return null;
  }

  const sharedContainer = Paths.appleSharedContainers?.[APP_GROUP_IDENTIFIER];
  if (!sharedContainer) {
    return null;
  }

  return new File(sharedContainer, QUEUE_FILE_NAME);
}

export async function importPendingSiriQueue(): Promise<number> {
  const queueFile = getQueueFile();
  if (!queueFile) {
    if (__DEV__) {
      console.log('[SiriImport] app group container unavailable.', {
        appGroupIdentifier: APP_GROUP_IDENTIFIER,
        availableContainers: Object.keys(Paths.appleSharedContainers ?? {}),
      });
    }
    return 0;
  }

  if (__DEV__) {
    console.log('[SiriImport] queue debug', {
      appGroupIdentifier: APP_GROUP_IDENTIFIER,
      filePath: queueFile.uri,
      exists: queueFile.exists,
      size: queueFile.size,
    });
  }

  if (!queueFile.exists || queueFile.size <= 0) {
    return 0;
  }

  let content = '';
  try {
    content = await queueFile.text();
  } catch (error) {
    console.warn('[SiriImport] failed reading queue file', error);
    return 0;
  }

  const rows: SiriQueueRow[] = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as SiriQueueRow;
      } catch {
        return null;
      }
    })
    .filter((row): row is SiriQueueRow => Boolean(row));

  if (__DEV__) {
    console.log(`[SiriImport] consume returned ${Array.isArray(rows) ? rows.length : 0} row(s).`);
    if (Array.isArray(rows) && rows.length > 0) {
      console.log('[SiriImport] first rows', rows.slice(0, 3));
    }
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return 0;
  }

  const captures = rows
    .map((row) => ({
      rawText: typeof row?.rawText === 'string' ? row.rawText : '',
      source: (row?.source === 'test' ? 'test' : 'siri') as InboxSource,
      createdAt: typeof row?.createdAt === 'number' ? row.createdAt : Date.now(),
    }))
    .filter((row) => row.rawText.trim().length > 0);

  if (captures.length === 0) {
    if (__DEV__) {
      console.log('[SiriImport] no valid captures after normalization; clearing queue.');
    }
    queueFile.write('');
    return 0;
  }

  const imported = await importInboxCaptures(captures);
  if (__DEV__) {
    console.log(`[SiriImport] imported ${imported} capture(s); clearing queue.`);
  }
  queueFile.write('');
  return imported;
}
