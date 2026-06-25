import {
  deletePowerSyncRemoteImageIfNeeded,
  uploadPowerSyncImageIfNeeded,
  type PowerSyncImageTable,
} from './imageUpload';
import { getPowerSyncDatabase } from './system';

type PowerSyncDatabase = ReturnType<typeof getPowerSyncDatabase>;

type SqlExecutor = {
  execute(sql: string, parameters?: unknown[]): Promise<unknown>;
};

type PendingImageUpload = {
  table: PowerSyncImageTable;
  houseId: string;
  id: string;
  imagePath: string;
  previousRemotePath?: string | null;
  createdAt: number;
  attempts?: number;
  lastError?: string;
};

type PendingImageDelete = {
  remotePath: string;
  createdAt: number;
  attempts?: number;
  lastError?: string;
};

const PENDING_IMAGE_UPLOAD_PREFIX = 'pending:image-upload:';
const PENDING_IMAGE_DELETE_PREFIX = 'pending:image-delete:';

const pendingImageUploadId = (table: PowerSyncImageTable, id: string) =>
  `${PENDING_IMAGE_UPLOAD_PREFIX}${table}:${id}`;

const pendingImageDeleteId = (remotePath: string) =>
  `${PENDING_IMAGE_DELETE_PREFIX}${remotePath}`;

const remoteImagePath = (path?: string | null) =>
  path && path.startsWith('houses/') ? path : null;

const logPowerSyncImageDebug = (message: string, data?: Record<string, unknown>) => {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.info(message, data);
  }
};

let processingUploads = false;
let processingDeletes = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

const scheduleImageUploadRetry = (database: PowerSyncDatabase, attempts: number) => {
  if (retryTimer) return;
  const delayMs = Math.min(60000, Math.max(5000, attempts * 5000));
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void processPendingPowerSyncImageUploads(database);
    void processPendingPowerSyncImageDeletes(database);
  }, delayMs);
};

const localImageLookup = (table: PowerSyncImageTable) => {
  switch (table) {
    case 'houses':
      return { table: 'local_houses', column: 'image_path', idColumn: 'id' };
    case 'rooms':
      return { table: 'local_rooms', column: 'image_path', idColumn: 'id' };
    case 'containers':
      return { table: 'local_containers', column: 'image_path', idColumn: 'id' };
    case 'boxes':
      return { table: 'local_boxes', column: 'image_path', idColumn: 'id' };
    case 'items':
      return { table: 'local_items', column: 'image_path', idColumn: 'id' };
    case 'item_images':
      return { table: 'local_item_images', column: 'image_path', idColumn: 'id' };
  }
};

const syncedImageUpdateSql = (table: PowerSyncImageTable) => {
  if (table === 'item_images') return 'UPDATE item_images SET remote_path = ? WHERE id = ?';
  return `UPDATE ${table} SET image_path = ? WHERE id = ?`;
};

const updateLocalRemotePath = async (
  tx: SqlExecutor,
  upload: PendingImageUpload,
  remotePath: string | null
) => {
  if (upload.table !== 'item_images') return;
  await tx.execute('UPDATE local_item_images SET remote_path = ? WHERE id = ?', [remotePath, upload.id]);
};

export const enqueuePowerSyncImageUpload = async ({
  table,
  houseId,
  id,
  imagePath,
  previousRemotePath,
  database = getPowerSyncDatabase(),
}: {
  table: PowerSyncImageTable;
  houseId: string;
  id: string;
  imagePath?: string | null;
  previousRemotePath?: string | null;
  database?: PowerSyncDatabase;
}) => {
  if (!imagePath || remoteImagePath(imagePath)) return;

  const upload: PendingImageUpload = {
    table,
    houseId,
    id,
    imagePath,
    previousRemotePath: remoteImagePath(previousRemotePath),
    createdAt: Date.now(),
    attempts: 0,
  };
  await database.writeTransaction(async (tx: SqlExecutor) => {
    await tx.execute(
      'INSERT OR REPLACE INTO local_metadata (id, value, updated_at) VALUES (?, ?, ?)',
      [pendingImageUploadId(table, id), JSON.stringify(upload), upload.createdAt]
    );
  });
  logPowerSyncImageDebug('[PowerSync images] queued image upload', { table, houseId, id });
};

export const processPendingPowerSyncImageUploads = async (
  database: PowerSyncDatabase = getPowerSyncDatabase()
) => {
  if (processingUploads) return;
  processingUploads = true;
  await database.waitForReady();
  try {
    const rows = await database.getAll<{ id: string; value: string }>(
      'SELECT id, value FROM local_metadata WHERE id LIKE ? ORDER BY updated_at ASC',
      [`${PENDING_IMAGE_UPLOAD_PREFIX}%`]
    );

    for (const row of rows) {
      let upload: PendingImageUpload;
      try {
        upload = JSON.parse(row.value) as PendingImageUpload;
      } catch {
        await database.writeTransaction(async (tx: SqlExecutor) => {
          await tx.execute('DELETE FROM local_metadata WHERE id = ?', [row.id]);
        });
        continue;
      }

      try {
        const lookup = localImageLookup(upload.table);
        const currentLocal = await database.getOptional<{ image_path: string | null }>(
          `SELECT ${lookup.column} AS image_path FROM ${lookup.table} WHERE ${lookup.idColumn} = ?`,
          [upload.id]
        );
        if (currentLocal?.image_path !== upload.imagePath) {
          await database.writeTransaction(async (tx: SqlExecutor) => {
            await tx.execute('DELETE FROM local_metadata WHERE id = ?', [row.id]);
          });
          logPowerSyncImageDebug('[PowerSync images] dropping stale image upload', {
            table: upload.table,
            houseId: upload.houseId,
            id: upload.id,
          });
          continue;
        }

        const remotePath = await uploadPowerSyncImageIfNeeded(upload);
        await database.writeTransaction(async (tx: SqlExecutor) => {
          await tx.execute(syncedImageUpdateSql(upload.table), [remotePath, upload.id]);
          await updateLocalRemotePath(tx, upload, remotePath);
          await tx.execute('DELETE FROM local_metadata WHERE id = ?', [row.id]);
        });
        if (upload.previousRemotePath && upload.previousRemotePath !== remotePath) {
          try {
            await deletePowerSyncRemoteImageIfNeeded(upload.previousRemotePath);
            logPowerSyncImageDebug('[PowerSync images] deleted previous remote image', {
              table: upload.table,
              houseId: upload.houseId,
              id: upload.id,
              previousRemotePath: upload.previousRemotePath,
            });
          } catch (deleteError) {
            console.warn('[PowerSync images] Previous remote image cleanup failed', {
              table: upload.table,
              houseId: upload.houseId,
              id: upload.id,
              previousRemotePath: upload.previousRemotePath,
              error: deleteError,
            });
          }
        }
        logPowerSyncImageDebug('[PowerSync images] uploaded image and patched synced row', {
          table: upload.table,
          houseId: upload.houseId,
          id: upload.id,
          remotePath,
        });
      } catch (error) {
        const retryUpload = {
          ...upload,
          attempts: (upload.attempts ?? 0) + 1,
          lastError: error instanceof Error ? error.message : String(error),
        };
        await database.writeTransaction(async (tx: SqlExecutor) => {
          await tx.execute(
            'INSERT OR REPLACE INTO local_metadata (id, value, updated_at) VALUES (?, ?, ?)',
            [row.id, JSON.stringify(retryUpload), Date.now()]
          );
        });
        scheduleImageUploadRetry(database, retryUpload.attempts ?? 1);
        console.warn('[PowerSync images] Pending image upload failed', {
          table: upload.table,
          houseId: upload.houseId,
          id: upload.id,
          error,
        });
      }
    }
  } finally {
    processingUploads = false;
  }
};

export const enqueuePowerSyncImageDelete = async ({
  remotePath,
  database = getPowerSyncDatabase(),
}: {
  remotePath?: string | null;
  database?: PowerSyncDatabase;
}) => {
  const normalizedRemotePath = remoteImagePath(remotePath);
  if (!normalizedRemotePath) return;

  const deletion: PendingImageDelete = {
    remotePath: normalizedRemotePath,
    createdAt: Date.now(),
    attempts: 0,
  };
  await database.writeTransaction(async (tx: SqlExecutor) => {
    await tx.execute(
      'INSERT OR REPLACE INTO local_metadata (id, value, updated_at) VALUES (?, ?, ?)',
      [pendingImageDeleteId(normalizedRemotePath), JSON.stringify(deletion), deletion.createdAt]
    );
  });
  logPowerSyncImageDebug('[PowerSync images] queued remote image delete', { remotePath: normalizedRemotePath });
};

export const processPendingPowerSyncImageDeletes = async (
  database: PowerSyncDatabase = getPowerSyncDatabase()
) => {
  if (processingDeletes) return;
  processingDeletes = true;
  await database.waitForReady();
  try {
    const rows = await database.getAll<{ id: string; value: string }>(
      'SELECT id, value FROM local_metadata WHERE id LIKE ? ORDER BY updated_at ASC',
      [`${PENDING_IMAGE_DELETE_PREFIX}%`]
    );

    for (const row of rows) {
      let deletion: PendingImageDelete;
      try {
        deletion = JSON.parse(row.value) as PendingImageDelete;
      } catch {
        await database.writeTransaction(async (tx: SqlExecutor) => {
          await tx.execute('DELETE FROM local_metadata WHERE id = ?', [row.id]);
        });
        continue;
      }

      try {
        await deletePowerSyncRemoteImageIfNeeded(deletion.remotePath);
        await database.writeTransaction(async (tx: SqlExecutor) => {
          await tx.execute('DELETE FROM local_metadata WHERE id = ?', [row.id]);
        });
        logPowerSyncImageDebug('[PowerSync images] deleted remote image', { remotePath: deletion.remotePath });
      } catch (error) {
        const retryDeletion = {
          ...deletion,
          attempts: (deletion.attempts ?? 0) + 1,
          lastError: error instanceof Error ? error.message : String(error),
        };
        await database.writeTransaction(async (tx: SqlExecutor) => {
          await tx.execute(
            'INSERT OR REPLACE INTO local_metadata (id, value, updated_at) VALUES (?, ?, ?)',
            [row.id, JSON.stringify(retryDeletion), Date.now()]
          );
        });
        scheduleImageUploadRetry(database, retryDeletion.attempts ?? 1);
        console.warn('[PowerSync images] Pending image delete failed', {
          remotePath: deletion.remotePath,
          error,
        });
      }
    }
  } finally {
    processingDeletes = false;
  }
};

export const enqueueAndProcessPowerSyncImageUpload = async ({
  table,
  houseId,
  id,
  imagePath,
  previousRemotePath,
  database = getPowerSyncDatabase(),
}: {
  table: PowerSyncImageTable;
  houseId: string;
  id: string;
  imagePath?: string | null;
  previousRemotePath?: string | null;
  database?: PowerSyncDatabase;
}) => {
  await enqueuePowerSyncImageUpload({ table, houseId, id, imagePath, previousRemotePath, database });
  void processPendingPowerSyncImageUploads(database);
};

export const enqueueAndProcessPowerSyncImageDelete = async ({
  remotePath,
  database = getPowerSyncDatabase(),
}: {
  remotePath?: string | null;
  database?: PowerSyncDatabase;
}) => {
  await enqueuePowerSyncImageDelete({ remotePath, database });
  void processPendingPowerSyncImageDeletes(database);
};

export const __private__ = {
  pendingImageUploadId,
  PENDING_IMAGE_UPLOAD_PREFIX,
  pendingImageDeleteId,
  PENDING_IMAGE_DELETE_PREFIX,
};
