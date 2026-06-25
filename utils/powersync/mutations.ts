import * as Crypto from 'expo-crypto';

import {
  loadPowerSyncHouseSyncStates,
  markPowerSyncHousesLocalOnly,
} from './metadata';
import { loadSyncedHouseIds } from '@/utils/sync/settingsMetadata';
import {
  getPowerSyncRepositoryBoxes,
  getPowerSyncRepositoryContainers,
  getPowerSyncRepositoryHouseById,
  getPowerSyncRepositoryItemImages,
  getPowerSyncRepositoryItems,
  getPowerSyncRepositoryRooms,
  type PowerSyncRepositoryBox,
  type PowerSyncRepositoryContainer,
  type PowerSyncRepositoryHouse,
  type PowerSyncRepositoryItem,
  type PowerSyncRepositoryItemImage,
  type PowerSyncRepositoryRoom,
} from './repository';
import { getPowerSyncDatabase } from './system';
import { deletePowerSyncRemoteImageIfNeeded, type PowerSyncImageTable } from './imageUpload';
import { enqueueAndProcessPowerSyncImageDelete, enqueueAndProcessPowerSyncImageUpload } from './imageUploadQueue';

type PowerSyncWriteDatabase = ReturnType<typeof getPowerSyncDatabase>;

type SqlExecutor = {
  execute(sql: string, parameters?: unknown[]): Promise<unknown>;
};

const createId = () => {
  if (typeof Crypto.randomUUID === 'function') return Crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

type TombstoneTable = 'houses' | 'rooms' | 'containers' | 'boxes' | 'items' | 'item_images';

type ImageBearingTable = Exclude<PowerSyncImageTable, 'item_images'>;

const tombstoneId = (table: TombstoneTable, id: string) => `deleted:${table}:${id}`;

const remoteImagePath = (path?: string | null) =>
  path && path.startsWith('houses/') ? path : null;

const logPowerSyncImageDebug = (message: string, data?: Record<string, unknown>) => {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.info(message, data);
  }
};

const isPowerSyncSyncedHouse = async (
  database: PowerSyncWriteDatabase,
  houseId?: string | null
) => {
  if (!houseId) return false;
  const states = await loadPowerSyncHouseSyncStates();
  if (states[houseId] === 'synced') return true;
  const syncedHouseIds = await loadSyncedHouseIds();
  if (syncedHouseIds.includes(houseId)) return true;

  const syncedHouse = await database.getOptional<{ id: string }>(
    'SELECT id FROM houses WHERE id = ?',
    [houseId]
  );
  if (syncedHouse) {
    return true;
  }

  return false;
};

const clearTombstone = async (tx: SqlExecutor, table: TombstoneTable, id: string) => {
  await tx.execute('DELETE FROM local_metadata WHERE id = ?', [tombstoneId(table, id)]);
};

const writeTombstone = async (tx: SqlExecutor, table: TombstoneTable, id: string) => {
  await tx.execute(
    'INSERT OR REPLACE INTO local_metadata (id, value, updated_at) VALUES (?, ?, ?)',
    [tombstoneId(table, id), 'true', Date.now()]
  );
};

const initialSyncedImagePathForMutation = async ({
  database,
  table,
  id,
  imagePath,
  fallbackImagePath,
  shouldSync,
}: {
  database: PowerSyncWriteDatabase;
  table: ImageBearingTable;
  id: string;
  imagePath?: string | null;
  fallbackImagePath?: string | null;
  shouldSync: boolean;
}) => {
  if (!shouldSync) return imagePath !== undefined ? imagePath : fallbackImagePath;
  const currentSyncedRow = await database.getOptional<{ image_path: string | null }>(
    `SELECT image_path FROM ${table} WHERE id = ?`,
    [id]
  );
  if (imagePath !== undefined) {
    if (imagePath === null) return null;
    return remoteImagePath(imagePath) ?? currentSyncedRow?.image_path ?? remoteImagePath(fallbackImagePath) ?? null;
  }

  return currentSyncedRow?.image_path ?? remoteImagePath(fallbackImagePath) ?? fallbackImagePath ?? null;
};

const previousRemoteImagePathForMutation = async ({
  database,
  table,
  id,
  fallbackImagePath,
  shouldSync,
}: {
  database: PowerSyncWriteDatabase;
  table: ImageBearingTable;
  id: string;
  fallbackImagePath?: string | null;
  shouldSync: boolean;
}) => {
  if (!shouldSync) return null;
  const currentSyncedRow = await database.getOptional<{ image_path: string | null }>(
    `SELECT image_path FROM ${table} WHERE id = ?`,
    [id]
  );
  return remoteImagePath(currentSyncedRow?.image_path) ?? remoteImagePath(fallbackImagePath);
};

const scheduleSyncedImageUpload = async ({
  database,
  table,
  houseId,
  id,
  imagePath,
  previousRemotePath,
}: {
  database: PowerSyncWriteDatabase;
  table: ImageBearingTable;
  houseId: string;
  id: string;
  imagePath?: string | null;
  previousRemotePath?: string | null;
}) => {
  if (imagePath === undefined || remoteImagePath(imagePath)) return;
  if (imagePath === null) {
    if (!previousRemotePath) return;
    try {
      await deletePowerSyncRemoteImageIfNeeded(previousRemotePath);
      logPowerSyncImageDebug('[PowerSync images] deleted previous remote image', {
        table,
        houseId,
        id,
        previousRemotePath,
      });
    } catch (error) {
      console.warn('[PowerSync images] Previous remote image cleanup failed', {
        table,
        houseId,
        id,
        previousRemotePath,
        error,
      });
    }
    return;
  }
  try {
    await enqueueAndProcessPowerSyncImageUpload({ table, houseId, id, imagePath, previousRemotePath, database });
  } catch (error) {
    console.warn('[PowerSync images] Failed to enqueue image upload after local write', {
      table,
      houseId,
      id,
      error,
    });
  }
};

const scheduleSyncedItemImageUpload = async ({
  database,
  houseId,
  id,
  imagePath,
  previousRemotePath,
}: {
  database: PowerSyncWriteDatabase;
  houseId: string;
  id: string;
  imagePath?: string | null;
  previousRemotePath?: string | null;
}) => {
  if (imagePath === undefined || remoteImagePath(imagePath)) return;
  if (imagePath === null) {
    if (!previousRemotePath) return;
    try {
      await deletePowerSyncRemoteImageIfNeeded(previousRemotePath);
      logPowerSyncImageDebug('[PowerSync images] deleted previous remote image', {
        table: 'item_images',
        houseId,
        id,
        previousRemotePath,
      });
    } catch (error) {
      console.warn('[PowerSync images] Previous item image cleanup failed', {
        houseId,
        id,
        previousRemotePath,
        error,
      });
    }
    return;
  }
  try {
    await enqueueAndProcessPowerSyncImageUpload({
      table: 'item_images',
      houseId,
      id,
      imagePath,
      previousRemotePath,
      database,
    });
  } catch (error) {
    console.warn('[PowerSync images] Failed to enqueue item image upload after local write', {
      houseId,
      id,
      error,
    });
  }
};

const toHouseResult = (house: PowerSyncRepositoryHouse) => ({
  id: house.id,
  name: house.name ?? '',
  ownerId: house.owner_id,
  address: house.address,
  notes: house.notes,
  imagePath: house.image_path,
});

const toRoomResult = (room: PowerSyncRepositoryRoom) => ({
  id: room.id,
  houseId: room.houseId,
  name: room.name,
  description: room.description,
  imagePath: room.imagePath,
  createdBy: room.createdBy,
  updatedBy: room.updatedBy,
});

const toContainerResult = (container: PowerSyncRepositoryContainer) => ({
  id: container.id,
  houseId: container.houseId,
  roomId: container.roomId,
  name: container.name,
  description: container.description,
  imagePath: container.imagePath,
  createdBy: container.createdBy,
  updatedBy: container.updatedBy,
});

const toBoxResult = (box: PowerSyncRepositoryBox) => ({
  id: box.id,
  houseId: box.houseId,
  parentType: box.parentType,
  parentId: box.parentId,
  name: box.name,
  description: box.description,
  imagePath: box.imagePath,
  tags: box.tags,
  createdBy: box.createdBy,
  updatedBy: box.updatedBy,
});

const toItemResult = (item: PowerSyncRepositoryItem) => ({
  id: item.id,
  houseId: item.houseId,
  parentType: item.parentType,
  parentId: item.parentId,
  name: item.name,
  description: item.description,
  imagePath: item.imagePath,
  tags: item.tags,
  purchasePriceCents: item.purchasePriceCents,
  notes: item.notes,
  createdBy: item.createdBy,
  updatedBy: item.updatedBy,
});

const toItemImageResult = (itemImage: PowerSyncRepositoryItemImage) => ({
  id: itemImage.id,
  itemId: itemImage.itemId,
  houseId: itemImage.houseId,
  imagePath: itemImage.imagePath,
  remotePath: itemImage.remotePath,
  position: itemImage.position,
  createdBy: itemImage.createdBy,
  updatedBy: itemImage.updatedBy,
});

const getLocalItemImageResultById = async (
  database: PowerSyncWriteDatabase,
  itemImageId: string
): Promise<PowerSyncRepositoryItemImage | null> => {
  const row = await database.getOptional<{
    id: string;
    item_id: string;
    house_id: string;
    image_path: string | null;
    remote_path: string | null;
    position: number | null;
    created_by: string | null;
    updated_by: string | null;
  }>(
    `
      SELECT id, item_id, house_id, image_path, remote_path, position, created_by, updated_by
      FROM local_item_images
      WHERE id = ?
    `,
    [itemImageId]
  );
  if (!row) return null;
  return {
    id: row.id,
    itemId: row.item_id,
    houseId: row.house_id,
    imagePath: row.image_path,
    remotePath: row.remote_path,
    position: row.position ?? 0,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
};

const getItemImageResultById = async (
  database: PowerSyncWriteDatabase,
  itemId: string,
  itemImageId: string
) =>
  (await getPowerSyncRepositoryItemImages(database, itemId)).find((candidate) => candidate.id === itemImageId) ??
  (await getLocalItemImageResultById(database, itemImageId));

const resolveHouseIdFromRoom = async (
  database: PowerSyncWriteDatabase,
  roomId?: string | null
) => {
  if (!roomId) return null;
  const room = (await getPowerSyncRepositoryRooms(database)).find((candidate) => candidate.id === roomId);
  return room?.houseId ?? null;
};

export const createPowerSyncLocalHouse = async ({
  name,
  ownerId = null,
  address = null,
  notes = null,
  imagePath = null,
  database = getPowerSyncDatabase(),
}: {
  name: string;
  ownerId?: string | null;
  address?: string | null;
  notes?: string | null;
  imagePath?: string | null;
  database?: PowerSyncWriteDatabase;
}) => {
  const id = createId();
  await database.writeTransaction(async (tx: SqlExecutor) => {
    await clearTombstone(tx, 'houses', id);
    await tx.execute(
      `
        INSERT INTO local_houses
          (id, name, owner_id, address, notes, image_path, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [id, name, ownerId, address, notes, imagePath, ownerId, ownerId]
    );
  });
  await markPowerSyncHousesLocalOnly([id]);

  const house = await getPowerSyncRepositoryHouseById(database, id);
  if (!house) throw new Error('PowerSync house was not created.');
  return toHouseResult(house);
};

export const updatePowerSyncLocalHouse = async ({
  houseId,
  name,
  ownerId,
  address = null,
  notes = null,
  imagePath,
  database = getPowerSyncDatabase(),
}: {
  houseId: string;
  name: string;
  ownerId?: string | null;
  address?: string | null;
  notes?: string | null;
  imagePath?: string | null;
  database?: PowerSyncWriteDatabase;
}) => {
  const existing = await getPowerSyncRepositoryHouseById(database, houseId);
  if (!existing) throw new Error('PowerSync house not found.');
  const nextOwnerId = ownerId !== undefined ? ownerId : existing.owner_id;
  const nextImagePath = imagePath !== undefined ? imagePath : existing.image_path;
  const shouldSync = await isPowerSyncSyncedHouse(database, houseId);
  const previousRemotePath = await previousRemoteImagePathForMutation({
    database,
    table: 'houses',
    id: houseId,
    fallbackImagePath: existing.image_path,
    shouldSync,
  });
  const syncedImagePath = await initialSyncedImagePathForMutation({
    database,
    table: 'houses',
    id: houseId,
    imagePath,
    fallbackImagePath: existing.image_path,
    shouldSync,
  });

  await database.writeTransaction(async (tx: SqlExecutor) => {
    await clearTombstone(tx, 'houses', houseId);
    await tx.execute(
      `
        INSERT OR REPLACE INTO local_houses
          (id, name, owner_id, address, notes, image_path, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        houseId,
        name,
        nextOwnerId,
        address,
        notes,
        nextImagePath,
        existing.source === 'local' ? null : existing.owner_id,
        nextOwnerId,
      ]
    );
    if (shouldSync) {
      await tx.execute(
        `
          INSERT OR REPLACE INTO houses
            (id, name, owner_id, address, notes, image_path, created_by, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [houseId, name, nextOwnerId, address, notes, syncedImagePath, existing.owner_id, nextOwnerId]
      );
    }
  });
  if (!shouldSync) {
    await markPowerSyncHousesLocalOnly([houseId]);
  } else if (imagePath !== undefined) {
    await scheduleSyncedImageUpload({ database, table: 'houses', houseId, id: houseId, imagePath, previousRemotePath });
  }

  const house = await getPowerSyncRepositoryHouseById(database, houseId);
  if (!house) throw new Error('PowerSync house was not updated.');
  return toHouseResult(house);
};

export const deletePowerSyncLocalHouse = async ({
  houseId,
  database = getPowerSyncDatabase(),
}: {
  houseId: string;
  database?: PowerSyncWriteDatabase;
}) => {
  const shouldSync = await isPowerSyncSyncedHouse(database, houseId);
  await database.writeTransaction(async (tx: SqlExecutor) => {
    await tx.execute('DELETE FROM local_item_images WHERE house_id = ?', [houseId]);
    await tx.execute('DELETE FROM local_items WHERE house_id = ?', [houseId]);
    await tx.execute('DELETE FROM local_boxes WHERE house_id = ?', [houseId]);
    await tx.execute('DELETE FROM local_containers WHERE house_id = ?', [houseId]);
    await tx.execute('DELETE FROM local_rooms WHERE house_id = ?', [houseId]);
    await tx.execute('DELETE FROM local_houses WHERE id = ?', [houseId]);
    if (shouldSync) {
      await tx.execute('DELETE FROM houses WHERE id = ?', [houseId]);
    }
    await writeTombstone(tx, 'houses', houseId);
  });
};

export const createPowerSyncLocalRoom = async ({
  houseId,
  name,
  description = null,
  imagePath = null,
  database = getPowerSyncDatabase(),
}: {
  houseId: string;
  name: string;
  description?: string | null;
  imagePath?: string | null;
  database?: PowerSyncWriteDatabase;
}) => {
  const id = createId();
  const shouldSync = await isPowerSyncSyncedHouse(database, houseId);
  const syncedImagePath = shouldSync ? remoteImagePath(imagePath) : imagePath;
  await database.writeTransaction(async (tx: SqlExecutor) => {
    await clearTombstone(tx, 'rooms', id);
    await tx.execute(
      `
        INSERT INTO local_rooms
          (id, house_id, name, description, image_path, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [id, houseId, name, description, imagePath, null, null]
    );
    if (shouldSync) {
      await tx.execute(
        `
          INSERT INTO rooms
            (id, house_id, name, description, image_path, created_by, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [id, houseId, name, description, syncedImagePath, null, null]
      );
    }
  });
  if (shouldSync) {
    await scheduleSyncedImageUpload({ database, table: 'rooms', houseId, id, imagePath });
  }

  const room = (await getPowerSyncRepositoryRooms(database, houseId)).find((candidate) => candidate.id === id);
  if (!room) throw new Error('PowerSync room was not created.');
  return toRoomResult(room);
};

export const updatePowerSyncLocalRoom = async ({
  roomId,
  houseId,
  name,
  description = null,
  imagePath,
  database = getPowerSyncDatabase(),
}: {
  roomId: string;
  houseId?: string;
  name: string;
  description?: string | null;
  imagePath?: string | null;
  database?: PowerSyncWriteDatabase;
}) => {
  const existing = (await getPowerSyncRepositoryRooms(database)).find((room) => room.id === roomId);
  if (!existing) throw new Error('PowerSync room not found.');
  const nextHouseId = houseId ?? existing.houseId;
  const nextImagePath = imagePath !== undefined ? imagePath : existing.imagePath;
  const shouldSync = await isPowerSyncSyncedHouse(database, nextHouseId);
  const previousRemotePath = await previousRemoteImagePathForMutation({
    database,
    table: 'rooms',
    id: roomId,
    fallbackImagePath: existing.imagePath,
    shouldSync,
  });
  const syncedImagePath = await initialSyncedImagePathForMutation({
    database,
    table: 'rooms',
    id: roomId,
    imagePath,
    fallbackImagePath: existing.imagePath,
    shouldSync,
  });

  await database.writeTransaction(async (tx: SqlExecutor) => {
    await clearTombstone(tx, 'rooms', roomId);
    await tx.execute(
      `
        INSERT OR REPLACE INTO local_rooms
          (id, house_id, name, description, image_path, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [roomId, nextHouseId, name, description, nextImagePath, existing.createdBy, existing.updatedBy]
    );
    if (shouldSync) {
      await tx.execute(
        `
          INSERT OR REPLACE INTO rooms
            (id, house_id, name, description, image_path, created_by, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [roomId, nextHouseId, name, description, syncedImagePath, existing.createdBy, existing.updatedBy]
      );
    }
  });
  if (shouldSync && imagePath !== undefined) {
    await scheduleSyncedImageUpload({ database, table: 'rooms', houseId: nextHouseId, id: roomId, imagePath, previousRemotePath });
  }

  const room = (await getPowerSyncRepositoryRooms(database, nextHouseId)).find((candidate) => candidate.id === roomId);
  if (!room) throw new Error('PowerSync room was not updated.');
  return toRoomResult(room);
};

export const deletePowerSyncLocalRoom = async ({
  roomId,
  database = getPowerSyncDatabase(),
}: {
  roomId: string;
  database?: PowerSyncWriteDatabase;
}) => {
  const existing = (await getPowerSyncRepositoryRooms(database)).find((room) => room.id === roomId);
  const shouldSync = await isPowerSyncSyncedHouse(database, existing?.houseId);
  await database.writeTransaction(async (tx: SqlExecutor) => {
    await tx.execute(
      `
        DELETE FROM local_item_images
        WHERE item_id IN (
          SELECT id FROM local_items
          WHERE parent_type = 'room' AND parent_id = ?
             OR parent_type = 'container' AND parent_id IN (SELECT id FROM local_containers WHERE room_id = ?)
             OR parent_type = 'box' AND parent_id IN (
               SELECT id FROM local_boxes
               WHERE parent_type = 'room' AND parent_id = ?
                  OR parent_type = 'container' AND parent_id IN (SELECT id FROM local_containers WHERE room_id = ?)
             )
        )
      `,
      [roomId, roomId, roomId, roomId]
    );
    await tx.execute(
      `
        DELETE FROM local_items
        WHERE parent_type = 'room' AND parent_id = ?
           OR parent_type = 'container' AND parent_id IN (SELECT id FROM local_containers WHERE room_id = ?)
           OR parent_type = 'box' AND parent_id IN (
             SELECT id FROM local_boxes
             WHERE parent_type = 'room' AND parent_id = ?
                OR parent_type = 'container' AND parent_id IN (SELECT id FROM local_containers WHERE room_id = ?)
           )
      `,
      [roomId, roomId, roomId, roomId]
    );
    await tx.execute(
      `
        DELETE FROM local_boxes
        WHERE parent_type = 'room' AND parent_id = ?
           OR parent_type = 'container' AND parent_id IN (SELECT id FROM local_containers WHERE room_id = ?)
      `,
      [roomId, roomId]
    );
    await tx.execute('DELETE FROM local_containers WHERE room_id = ?', [roomId]);
    await tx.execute('DELETE FROM local_rooms WHERE id = ?', [roomId]);
    if (shouldSync) {
      await tx.execute(
        `
          DELETE FROM item_images
          WHERE item_id IN (
            SELECT id FROM items
            WHERE (parent_type = 'room' AND parent_id = ?)
               OR (parent_type = 'container' AND parent_id IN (SELECT id FROM containers WHERE room_id = ?))
               OR (parent_type = 'box' AND parent_id IN (
                 SELECT id FROM boxes
                 WHERE (parent_type = 'room' AND parent_id = ?)
                    OR (parent_type = 'container' AND parent_id IN (SELECT id FROM containers WHERE room_id = ?))
               ))
          )
        `,
        [roomId, roomId, roomId, roomId]
      );
      await tx.execute(
        `
          DELETE FROM items
          WHERE (parent_type = 'room' AND parent_id = ?)
             OR (parent_type = 'container' AND parent_id IN (SELECT id FROM containers WHERE room_id = ?))
             OR (parent_type = 'box' AND parent_id IN (
               SELECT id FROM boxes
               WHERE (parent_type = 'room' AND parent_id = ?)
                  OR (parent_type = 'container' AND parent_id IN (SELECT id FROM containers WHERE room_id = ?))
             ))
        `,
        [roomId, roomId, roomId, roomId]
      );
      await tx.execute(
        `
          DELETE FROM boxes
          WHERE (parent_type = 'room' AND parent_id = ?)
             OR (parent_type = 'container' AND parent_id IN (SELECT id FROM containers WHERE room_id = ?))
        `,
        [roomId, roomId]
      );
      await tx.execute('DELETE FROM containers WHERE room_id = ?', [roomId]);
      await tx.execute('DELETE FROM rooms WHERE id = ?', [roomId]);
    }
    await writeTombstone(tx, 'rooms', roomId);
  });
};

export const createPowerSyncLocalContainer = async ({
  houseId,
  roomId,
  name,
  description = null,
  imagePath = null,
  database = getPowerSyncDatabase(),
}: {
  houseId: string;
  roomId: string;
  name: string;
  description?: string | null;
  imagePath?: string | null;
  database?: PowerSyncWriteDatabase;
}) => {
  const id = createId();
  const resolvedHouseId = houseId || (await resolveHouseIdFromRoom(database, roomId)) || '';
  const shouldSync = await isPowerSyncSyncedHouse(database, resolvedHouseId);
  const syncedImagePath = shouldSync ? remoteImagePath(imagePath) : imagePath;
  await database.writeTransaction(async (tx: SqlExecutor) => {
    await clearTombstone(tx, 'containers', id);
    await tx.execute(
      `
        INSERT INTO local_containers
          (id, house_id, room_id, name, description, image_path, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [id, resolvedHouseId, roomId, name, description, imagePath, null, null]
    );
    if (shouldSync) {
      await tx.execute(
        `
          INSERT INTO containers
            (id, house_id, room_id, name, description, image_path, created_by, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [id, resolvedHouseId, roomId, name, description, syncedImagePath, null, null]
      );
    }
  });
  if (shouldSync) {
    await scheduleSyncedImageUpload({ database, table: 'containers', houseId: resolvedHouseId, id, imagePath });
  }

  const container = (await getPowerSyncRepositoryContainers(database, resolvedHouseId)).find((candidate) => candidate.id === id);
  if (!container) throw new Error('PowerSync container was not created.');
  return toContainerResult(container);
};

export const updatePowerSyncLocalContainer = async ({
  containerId,
  houseId,
  roomId,
  name,
  description = null,
  imagePath,
  database = getPowerSyncDatabase(),
}: {
  containerId: string;
  houseId?: string;
  roomId?: string;
  name: string;
  description?: string | null;
  imagePath?: string | null;
  database?: PowerSyncWriteDatabase;
}) => {
  const existing = (await getPowerSyncRepositoryContainers(database)).find((container) => container.id === containerId);
  if (!existing) throw new Error('PowerSync container not found.');
  const nextRoomId = roomId ?? existing.roomId;
  const nextHouseId = houseId || existing.houseId || (await resolveHouseIdFromRoom(database, nextRoomId)) || '';
  const nextImagePath = imagePath !== undefined ? imagePath : existing.imagePath;
  const shouldSync = await isPowerSyncSyncedHouse(database, nextHouseId);
  const previousRemotePath = await previousRemoteImagePathForMutation({
    database,
    table: 'containers',
    id: containerId,
    fallbackImagePath: existing.imagePath,
    shouldSync,
  });
  const syncedImagePath = await initialSyncedImagePathForMutation({
    database,
    table: 'containers',
    id: containerId,
    imagePath,
    fallbackImagePath: existing.imagePath,
    shouldSync,
  });

  await database.writeTransaction(async (tx: SqlExecutor) => {
    await clearTombstone(tx, 'containers', containerId);
    await tx.execute(
      `
        INSERT OR REPLACE INTO local_containers
          (id, house_id, room_id, name, description, image_path, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [containerId, nextHouseId, nextRoomId, name, description, nextImagePath, existing.createdBy, existing.updatedBy]
    );
    if (shouldSync) {
      await tx.execute(
        `
          INSERT OR REPLACE INTO containers
            (id, house_id, room_id, name, description, image_path, created_by, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [containerId, nextHouseId, nextRoomId, name, description, syncedImagePath, existing.createdBy, existing.updatedBy]
      );
    }
  });
  if (shouldSync && imagePath !== undefined) {
    await scheduleSyncedImageUpload({ database, table: 'containers', houseId: nextHouseId, id: containerId, imagePath, previousRemotePath });
  }

  const container = (await getPowerSyncRepositoryContainers(database, nextHouseId)).find((candidate) => candidate.id === containerId);
  if (!container) throw new Error('PowerSync container was not updated.');
  return toContainerResult(container);
};

export const deletePowerSyncLocalContainer = async ({
  containerId,
  database = getPowerSyncDatabase(),
}: {
  containerId: string;
  database?: PowerSyncWriteDatabase;
}) => {
  const existing = (await getPowerSyncRepositoryContainers(database)).find((container) => container.id === containerId);
  const shouldSync = await isPowerSyncSyncedHouse(database, existing?.houseId);
  await database.writeTransaction(async (tx: SqlExecutor) => {
    await tx.execute(
      `
        DELETE FROM local_item_images
        WHERE item_id IN (
          SELECT id FROM local_items
          WHERE parent_type = 'container' AND parent_id = ?
             OR parent_type = 'box' AND parent_id IN (
               SELECT id FROM local_boxes WHERE parent_type = 'container' AND parent_id = ?
             )
        )
      `,
      [containerId, containerId]
    );
    await tx.execute(
      `
        DELETE FROM local_items
        WHERE parent_type = 'container' AND parent_id = ?
           OR parent_type = 'box' AND parent_id IN (
             SELECT id FROM local_boxes WHERE parent_type = 'container' AND parent_id = ?
           )
      `,
      [containerId, containerId]
    );
    await tx.execute('DELETE FROM local_boxes WHERE parent_type = ? AND parent_id = ?', ['container', containerId]);
    await tx.execute('DELETE FROM local_containers WHERE id = ?', [containerId]);
    if (shouldSync) {
      await tx.execute(
        `
          DELETE FROM item_images
          WHERE item_id IN (
            SELECT id FROM items
            WHERE (parent_type = 'container' AND parent_id = ?)
               OR (parent_type = 'box' AND parent_id IN (
                 SELECT id FROM boxes WHERE parent_type = 'container' AND parent_id = ?
               ))
          )
        `,
        [containerId, containerId]
      );
      await tx.execute(
        `
          DELETE FROM items
          WHERE (parent_type = 'container' AND parent_id = ?)
             OR (parent_type = 'box' AND parent_id IN (
               SELECT id FROM boxes WHERE parent_type = 'container' AND parent_id = ?
             ))
        `,
        [containerId, containerId]
      );
      await tx.execute('DELETE FROM boxes WHERE parent_type = ? AND parent_id = ?', ['container', containerId]);
      await tx.execute('DELETE FROM containers WHERE id = ?', [containerId]);
    }
    await writeTombstone(tx, 'containers', containerId);
  });
};

export const createPowerSyncLocalBox = async ({
  houseId,
  name,
  description = null,
  parentType = null,
  parentId = null,
  imagePath = null,
  tags = '',
  database = getPowerSyncDatabase(),
}: {
  houseId: string;
  name: string;
  description?: string | null;
  parentType?: string | null;
  parentId?: string | null;
  imagePath?: string | null;
  tags?: string;
  database?: PowerSyncWriteDatabase;
}) => {
  const id = createId();
  const shouldSync = await isPowerSyncSyncedHouse(database, houseId);
  const syncedImagePath = shouldSync ? remoteImagePath(imagePath) : imagePath;
  await database.writeTransaction(async (tx: SqlExecutor) => {
    await clearTombstone(tx, 'boxes', id);
    await tx.execute(
      `
        INSERT INTO local_boxes
          (id, house_id, parent_type, parent_id, name, description, image_path, tags, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [id, houseId, parentType, parentId, name, description, imagePath, tags, null, null]
    );
    if (shouldSync) {
      await tx.execute(
        `
          INSERT INTO boxes
            (id, house_id, parent_type, parent_id, name, description, image_path, tags, created_by, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [id, houseId, parentType, parentId, name, description, syncedImagePath, tags, null, null]
      );
    }
  });
  if (shouldSync) {
    await scheduleSyncedImageUpload({ database, table: 'boxes', houseId, id, imagePath });
  }

  const box = (await getPowerSyncRepositoryBoxes(database, houseId)).find((candidate) => candidate.id === id);
  if (!box) throw new Error('PowerSync box was not created.');
  return toBoxResult(box);
};

export const updatePowerSyncLocalBox = async ({
  boxId,
  houseId,
  name,
  description = null,
  parentType,
  parentId,
  imagePath,
  tags,
  database = getPowerSyncDatabase(),
}: {
  boxId: string;
  houseId?: string;
  name: string;
  description?: string | null;
  parentType?: string | null;
  parentId?: string | null;
  imagePath?: string | null;
  tags?: string;
  database?: PowerSyncWriteDatabase;
}) => {
  const existing = (await getPowerSyncRepositoryBoxes(database)).find((box) => box.id === boxId);
  if (!existing) throw new Error('PowerSync box not found.');
  const nextHouseId = houseId ?? existing.houseId;
  const nextParentType = parentType !== undefined ? parentType : existing.parentType;
  const nextParentId = parentId !== undefined ? parentId : existing.parentId;
  const nextImagePath = imagePath !== undefined ? imagePath : existing.imagePath;
  const nextTags = tags !== undefined ? tags : existing.tags;
  const shouldSync = await isPowerSyncSyncedHouse(database, nextHouseId);
  const previousRemotePath = await previousRemoteImagePathForMutation({
    database,
    table: 'boxes',
    id: boxId,
    fallbackImagePath: existing.imagePath,
    shouldSync,
  });
  const syncedImagePath = await initialSyncedImagePathForMutation({
    database,
    table: 'boxes',
    id: boxId,
    imagePath,
    fallbackImagePath: existing.imagePath,
    shouldSync,
  });

  await database.writeTransaction(async (tx: SqlExecutor) => {
    await clearTombstone(tx, 'boxes', boxId);
    await tx.execute(
      `
        INSERT OR REPLACE INTO local_boxes
          (id, house_id, parent_type, parent_id, name, description, image_path, tags, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [boxId, nextHouseId, nextParentType, nextParentId, name, description, nextImagePath, nextTags, existing.createdBy, existing.updatedBy]
    );
    if (shouldSync) {
      await tx.execute(
        `
          INSERT OR REPLACE INTO boxes
            (id, house_id, parent_type, parent_id, name, description, image_path, tags, created_by, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [boxId, nextHouseId, nextParentType, nextParentId, name, description, syncedImagePath, nextTags, existing.createdBy, existing.updatedBy]
      );
    }
  });
  if (shouldSync && imagePath !== undefined) {
    await scheduleSyncedImageUpload({ database, table: 'boxes', houseId: nextHouseId, id: boxId, imagePath, previousRemotePath });
  }

  const box = (await getPowerSyncRepositoryBoxes(database, nextHouseId)).find((candidate) => candidate.id === boxId);
  if (!box) throw new Error('PowerSync box was not updated.');
  return toBoxResult(box);
};

export const deletePowerSyncLocalBox = async ({
  boxId,
  database = getPowerSyncDatabase(),
}: {
  boxId: string;
  database?: PowerSyncWriteDatabase;
}) => {
  const existing = (await getPowerSyncRepositoryBoxes(database)).find((box) => box.id === boxId);
  const shouldSync = await isPowerSyncSyncedHouse(database, existing?.houseId);
  await database.writeTransaction(async (tx: SqlExecutor) => {
    await tx.execute(
      'DELETE FROM local_item_images WHERE item_id IN (SELECT id FROM local_items WHERE parent_type = ? AND parent_id = ?)',
      ['box', boxId]
    );
    await tx.execute('DELETE FROM local_items WHERE parent_type = ? AND parent_id = ?', ['box', boxId]);
    await tx.execute('DELETE FROM local_boxes WHERE id = ?', [boxId]);
    if (shouldSync) {
      await tx.execute(
        'DELETE FROM item_images WHERE item_id IN (SELECT id FROM items WHERE parent_type = ? AND parent_id = ?)',
        ['box', boxId]
      );
      await tx.execute('DELETE FROM items WHERE parent_type = ? AND parent_id = ?', ['box', boxId]);
      await tx.execute('DELETE FROM boxes WHERE id = ?', [boxId]);
    }
    await writeTombstone(tx, 'boxes', boxId);
  });
};

export const createPowerSyncLocalItem = async ({
  houseId,
  name,
  description = null,
  parentType = null,
  parentId = null,
  imagePath = null,
  tags = '',
  purchasePriceCents = null,
  notes = null,
  syncImageStorage = true,
  database = getPowerSyncDatabase(),
}: {
  houseId: string;
  name: string;
  description?: string | null;
  parentType?: string | null;
  parentId?: string | null;
  imagePath?: string | null;
  tags?: string;
  purchasePriceCents?: number | null;
  notes?: string | null;
  syncImageStorage?: boolean;
  database?: PowerSyncWriteDatabase;
}) => {
  const id = createId();
  const shouldSync = await isPowerSyncSyncedHouse(database, houseId);
  const syncedImagePath = shouldSync && syncImageStorage ? remoteImagePath(imagePath) : null;
  await database.writeTransaction(async (tx: SqlExecutor) => {
    await clearTombstone(tx, 'items', id);
    await tx.execute(
      `
        INSERT INTO local_items
          (id, house_id, parent_type, parent_id, name, description, image_path, tags, purchase_price_cents, notes, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [id, houseId, parentType, parentId, name, description, imagePath, tags, purchasePriceCents, notes, null, null]
    );
    if (shouldSync) {
      await tx.execute(
        `
          INSERT INTO items
            (id, house_id, parent_type, parent_id, name, description, image_path, tags, purchase_price_cents, notes, created_by, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [id, houseId, parentType, parentId, name, description, syncedImagePath, tags, purchasePriceCents, notes, null, null]
      );
    }
  });
  if (shouldSync && syncImageStorage) {
    await scheduleSyncedImageUpload({ database, table: 'items', houseId, id, imagePath });
  }

  const item = (await getPowerSyncRepositoryItems(database, houseId)).find((candidate) => candidate.id === id);
  if (!item) throw new Error('PowerSync item was not created.');
  return toItemResult(item);
};

export const updatePowerSyncLocalItem = async ({
  itemId,
  houseId,
  name,
  description = null,
  parentType,
  parentId,
  imagePath,
  tags,
  purchasePriceCents,
  notes,
  syncImageStorage = true,
  database = getPowerSyncDatabase(),
}: {
  itemId: string;
  houseId?: string;
  name: string;
  description?: string | null;
  parentType?: string | null;
  parentId?: string | null;
  imagePath?: string | null;
  tags?: string;
  purchasePriceCents?: number | null;
  notes?: string | null;
  syncImageStorage?: boolean;
  database?: PowerSyncWriteDatabase;
}) => {
  const existing = (await getPowerSyncRepositoryItems(database)).find((item) => item.id === itemId);
  if (!existing) throw new Error('PowerSync item not found.');
  const nextHouseId = houseId ?? existing.houseId;
  const nextParentType = parentType !== undefined ? parentType : existing.parentType;
  const nextParentId = parentId !== undefined ? parentId : existing.parentId;
  const nextImagePath = imagePath !== undefined ? imagePath : existing.imagePath;
  const nextTags = tags !== undefined ? tags : existing.tags;
  const nextPurchasePriceCents = purchasePriceCents !== undefined ? purchasePriceCents : existing.purchasePriceCents;
  const nextNotes = notes !== undefined ? notes : existing.notes;
  const shouldSync = await isPowerSyncSyncedHouse(database, nextHouseId);
  const currentSyncedItemImage = shouldSync
    ? await database.getOptional<{ image_path: string | null }>('SELECT image_path FROM items WHERE id = ?', [itemId])
    : null;
  const previousRemotePath = syncImageStorage
    ? await previousRemoteImagePathForMutation({
        database,
        table: 'items',
        id: itemId,
        fallbackImagePath: existing.imagePath,
        shouldSync,
      })
    : null;
  const syncedImagePath = syncImageStorage
    ? await initialSyncedImagePathForMutation({
        database,
        table: 'items',
        id: itemId,
        imagePath,
        fallbackImagePath: existing.imagePath,
        shouldSync,
      })
    : imagePath !== undefined
    ? remoteImagePath(imagePath)
    : currentSyncedItemImage?.image_path ?? remoteImagePath(existing.remoteImagePath) ?? remoteImagePath(existing.imagePath) ?? null;

  await database.writeTransaction(async (tx: SqlExecutor) => {
    await clearTombstone(tx, 'items', itemId);
    await tx.execute(
      `
        INSERT OR REPLACE INTO local_items
          (id, house_id, parent_type, parent_id, name, description, image_path, tags, purchase_price_cents, notes, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        itemId,
        nextHouseId,
        nextParentType,
        nextParentId,
        name,
        description,
        nextImagePath,
        nextTags,
        nextPurchasePriceCents,
        nextNotes,
        existing.createdBy,
        existing.updatedBy,
      ]
    );
    if (shouldSync) {
      await tx.execute(
        `
          INSERT OR REPLACE INTO items
            (id, house_id, parent_type, parent_id, name, description, image_path, tags, purchase_price_cents, notes, created_by, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          itemId,
          nextHouseId,
          nextParentType,
          nextParentId,
          name,
          description,
          syncedImagePath,
          nextTags,
          nextPurchasePriceCents,
          nextNotes,
          existing.createdBy,
          existing.updatedBy,
        ]
      );
    }
  });
  if (shouldSync && imagePath !== undefined && syncImageStorage) {
    await scheduleSyncedImageUpload({ database, table: 'items', houseId: nextHouseId, id: itemId, imagePath, previousRemotePath });
  }

  const item = (await getPowerSyncRepositoryItems(database, nextHouseId)).find((candidate) => candidate.id === itemId);
  if (!item) throw new Error('PowerSync item was not updated.');
  return toItemResult(item);
};

export const deletePowerSyncLocalItem = async ({
  itemId,
  database = getPowerSyncDatabase(),
}: {
  itemId: string;
  database?: PowerSyncWriteDatabase;
}) => {
  const existing = (await getPowerSyncRepositoryItems(database)).find((item) => item.id === itemId);
  const shouldSync = await isPowerSyncSyncedHouse(database, existing?.houseId);
  const existingImages = await getPowerSyncRepositoryItemImages(database, itemId);
  const previousRemotePaths = shouldSync
    ? existingImages
        .map((image) => remoteImagePath(image.remotePath))
        .filter((remotePath): remotePath is string => Boolean(remotePath))
    : [];
  await database.writeTransaction(async (tx: SqlExecutor) => {
    for (const image of existingImages) {
      await tx.execute('DELETE FROM local_metadata WHERE id = ?', [`pending:image-upload:item_images:${image.id}`]);
    }
    await tx.execute('DELETE FROM local_item_images WHERE item_id = ?', [itemId]);
    await tx.execute('DELETE FROM local_items WHERE id = ?', [itemId]);
    if (shouldSync) {
      await tx.execute('DELETE FROM item_images WHERE item_id = ?', [itemId]);
      await tx.execute('DELETE FROM items WHERE id = ?', [itemId]);
    }
    await writeTombstone(tx, 'items', itemId);
  });
  for (const remotePath of previousRemotePaths) {
    await enqueueAndProcessPowerSyncImageDelete({ remotePath, database });
  }
};

export const createPowerSyncLocalItemImage = async ({
  itemId,
  houseId,
  imagePath,
  remotePath = null,
  position,
  id,
  database = getPowerSyncDatabase(),
}: {
  itemId: string;
  houseId: string;
  imagePath?: string | null;
  remotePath?: string | null;
  position: number;
  id?: string;
  database?: PowerSyncWriteDatabase;
}) => {
  const imageId = id ?? (position === 0 ? `legacy-${itemId}` : createId());
  const shouldSync = await isPowerSyncSyncedHouse(database, houseId);
  const nextRemotePath = shouldSync ? remoteImagePath(remotePath ?? imagePath) : remotePath;
  await database.writeTransaction(async (tx: SqlExecutor) => {
    await clearTombstone(tx, 'item_images', imageId);
    await tx.execute(
      `
        INSERT OR REPLACE INTO local_item_images
          (id, item_id, house_id, image_path, remote_path, position, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [imageId, itemId, houseId, imagePath ?? null, nextRemotePath, position, null, null]
    );
    if (shouldSync) {
      await tx.execute(
        `
          INSERT OR REPLACE INTO item_images
            (id, item_id, house_id, image_path, remote_path, position, created_by, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [imageId, itemId, houseId, imagePath ?? null, nextRemotePath, position, null, null]
      );
    }
  });
  if (shouldSync) {
    await scheduleSyncedItemImageUpload({ database, houseId, id: imageId, imagePath: remotePath ?? imagePath });
  }

  const itemImage = await getItemImageResultById(database, itemId, imageId);
  if (!itemImage) throw new Error('PowerSync item image was not created.');
  return toItemImageResult(itemImage);
};

export const updatePowerSyncLocalItemImage = async ({
  itemImageId,
  imagePath,
  remotePath,
  position,
  database = getPowerSyncDatabase(),
}: {
  itemImageId: string;
  imagePath?: string | null;
  remotePath?: string | null;
  position?: number;
  database?: PowerSyncWriteDatabase;
}) => {
  let existing = (await getPowerSyncRepositoryItemImages(database)).find((itemImage) => itemImage.id === itemImageId);
  if (!existing && itemImageId.startsWith('legacy-')) {
    const fallbackItemId = itemImageId.slice('legacy-'.length);
    const fallbackItem = (await getPowerSyncRepositoryItems(database)).find((item) => item.id === fallbackItemId);
    if (fallbackItem) {
      existing = {
        id: itemImageId,
        itemId: fallbackItem.id,
        houseId: fallbackItem.houseId,
        imagePath: fallbackItem.imagePath,
        remotePath: fallbackItem.remoteImagePath ?? null,
        position: 0,
        createdBy: fallbackItem.createdBy,
        updatedBy: fallbackItem.updatedBy,
      };
    }
  }
  if (!existing) throw new Error('PowerSync item image not found.');
  const nextImagePath = imagePath !== undefined ? imagePath : existing.imagePath;
  const nextPosition = position !== undefined ? position : existing.position;
  const shouldSync = await isPowerSyncSyncedHouse(database, existing.houseId);
  const previousRemotePath = shouldSync ? remoteImagePath(existing.remotePath) : null;
  const nextRemotePath = shouldSync && imagePath !== undefined
    ? remoteImagePath(remotePath ?? nextImagePath)
    : remotePath !== undefined
      ? remotePath
      : existing.remotePath;

  await database.writeTransaction(async (tx: SqlExecutor) => {
    await clearTombstone(tx, 'item_images', itemImageId);
    await tx.execute(
      `
        INSERT OR REPLACE INTO local_item_images
          (id, item_id, house_id, image_path, remote_path, position, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        itemImageId,
        existing.itemId,
        existing.houseId,
        nextImagePath,
        nextRemotePath,
        nextPosition,
        existing.createdBy,
        existing.updatedBy,
      ]
    );
    if (shouldSync) {
      await tx.execute(
        `
          INSERT OR REPLACE INTO item_images
            (id, item_id, house_id, image_path, remote_path, position, created_by, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          itemImageId,
          existing.itemId,
          existing.houseId,
          nextImagePath,
          nextRemotePath,
          nextPosition,
          existing.createdBy,
          existing.updatedBy,
        ]
      );
    }
  });
  if (shouldSync && imagePath !== undefined) {
    await scheduleSyncedItemImageUpload({
      database,
      houseId: existing.houseId,
      id: itemImageId,
      imagePath: remotePath ?? nextImagePath,
      previousRemotePath,
    });
  }

  const itemImage = await getItemImageResultById(database, existing.itemId, itemImageId);
  return toItemImageResult(
    itemImage ?? {
      ...existing,
      imagePath: nextImagePath,
      remotePath: nextRemotePath,
      position: nextPosition,
    }
  );
};

export const deletePowerSyncLocalItemImage = async ({
  itemImageId,
  database = getPowerSyncDatabase(),
}: {
  itemImageId: string;
  database?: PowerSyncWriteDatabase;
}) => {
  const existing = (await getPowerSyncRepositoryItemImages(database)).find((itemImage) => itemImage.id === itemImageId);
  const shouldSync = await isPowerSyncSyncedHouse(database, existing?.houseId);
  const previousRemotePath = shouldSync ? remoteImagePath(existing?.remotePath) : null;
  await database.writeTransaction(async (tx: SqlExecutor) => {
    await tx.execute('DELETE FROM local_metadata WHERE id = ?', [`pending:image-upload:item_images:${itemImageId}`]);
    await tx.execute('DELETE FROM local_item_images WHERE id = ?', [itemImageId]);
    if (shouldSync) {
      await tx.execute('DELETE FROM item_images WHERE id = ?', [itemImageId]);
    }
    await writeTombstone(tx, 'item_images', itemImageId);
  });
  if (previousRemotePath) {
    await enqueueAndProcessPowerSyncImageDelete({ remotePath: previousRemotePath, database });
  }
};
