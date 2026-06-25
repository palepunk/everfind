import { getPowerSyncDatabase } from './system';
import { loadPowerSyncHouseSyncStates } from './metadata';
import { loadSyncedHouseIds } from '@/utils/sync/settingsMetadata';
import { enqueueAndProcessPowerSyncRemoteImageDownload } from './imageDownloadQueue';

type PowerSyncReadDatabase = ReturnType<typeof getPowerSyncDatabase>;

export type PowerSyncRepositoryCounts = {
  houses: number;
  rooms: number;
  containers: number;
  boxes: number;
  items: number;
  itemImages: number;
  inboxEntries: number;
};

export type PowerSyncRepositoryHouse = {
  source: 'local' | 'synced';
  id: string;
  name: string | null;
  owner_id: string | null;
  address: string | null;
  notes: string | null;
  image_path: string | null;
  remoteImagePath?: string | null;
  rooms_count: number;
  containers_count: number;
  boxes_count: number;
  items_count: number;
  item_images_count: number;
};

export type PowerSyncRepositoryInventoryRow = {
  source: 'local' | 'synced';
  type: 'room' | 'container' | 'box' | 'item' | 'item_image';
  id: string;
  house_id: string | null;
  parent_type?: string | null;
  parent_id?: string | null;
  name?: string | null;
  image_path?: string | null;
  remote_path?: string | null;
};

export type PowerSyncRepositoryRoom = {
  id: string;
  houseId: string;
  name: string;
  description: string | null;
  imagePath: string | null;
  remoteImagePath?: string | null;
  createdBy: string | null;
  updatedBy: string | null;
};

export type PowerSyncRepositoryContainer = {
  id: string;
  houseId: string;
  roomId: string;
  name: string;
  description: string | null;
  imagePath: string | null;
  remoteImagePath?: string | null;
  createdBy: string | null;
  updatedBy: string | null;
};

export type PowerSyncRepositoryBox = {
  id: string;
  houseId: string;
  parentType: string | null;
  parentId: string | null;
  name: string;
  description: string | null;
  imagePath: string | null;
  remoteImagePath?: string | null;
  tags: string;
  createdBy: string | null;
  updatedBy: string | null;
};

export type PowerSyncRepositoryItem = {
  id: string;
  houseId: string;
  parentType: string | null;
  parentId: string | null;
  name: string;
  description: string | null;
  imagePath: string | null;
  remoteImagePath?: string | null;
  tags: string;
  purchasePriceCents: number | null;
  notes: string | null;
  createdBy: string | null;
  updatedBy: string | null;
};

export type PowerSyncRepositoryItemImage = {
  id: string;
  itemId: string;
  houseId: string;
  imagePath: string | null;
  remotePath: string | null;
  position: number;
  createdBy: string | null;
  updatedBy: string | null;
};

type RemoteImageDownloadRow = {
  id: string;
  houseId?: string | null;
  house_id?: string | null;
  imagePath?: string | null;
  image_path?: string | null;
  remoteImagePath?: string | null;
  remotePath?: string | null;
};

const getCount = async (database: PowerSyncReadDatabase, sql: string) => {
  const row = await database.getOptional<{ count: number }>(sql);
  return row?.count ?? 0;
};

const optionalHouseFilter = (houseId?: string) => ({
  clause: houseId ? 'WHERE house_id = ?' : '',
  params: houseId ? [houseId] : [],
});

type TombstoneTable = 'houses' | 'rooms' | 'containers' | 'boxes' | 'items' | 'item_images';

const notDeleted = (table: TombstoneTable, idColumn = 'id') =>
  `NOT EXISTS (SELECT 1 FROM local_metadata deleted WHERE deleted.id = 'deleted:${table}:' || ${idColumn})`;

const loadSyncedPowerSyncHouseIds = async (database: PowerSyncReadDatabase) => {
  const [states, legacySyncedHouseIds] = await Promise.all([
    loadPowerSyncHouseSyncStates(),
    loadSyncedHouseIds(),
  ]);
  const syncedHouseRows = await database.getAll<{ id: string }>('SELECT id FROM houses');
  const canUseSyncedRowsForHouse = (houseId: string) => {
    const state = states[houseId];
    return !state || state === 'synced';
  };
  return Array.from(
    new Set([
      ...syncedHouseRows.map((house) => house.id).filter((houseId) => houseId && canUseSyncedRowsForHouse(houseId)),
      ...Object.entries(states)
        .filter(([, state]) => state === 'synced')
        .map(([houseId]) => houseId),
      ...legacySyncedHouseIds.filter((houseId) => canUseSyncedRowsForHouse(houseId)),
    ])
  );
};

const sourceRankCase = (houseIdColumn = 'house_id') =>
  `CASE WHEN ${houseIdColumn} IN (SELECT house_id FROM synced_house_ids) THEN 0 ELSE 1 END`;

const localSourceRankCase = (houseIdColumn = 'house_id') =>
  `CASE WHEN ${houseIdColumn} IN (SELECT house_id FROM synced_house_ids) THEN 1 ELSE 0 END`;

const syncedHouseIdsCte = (syncedHouseIds: string[]) =>
  `synced_house_ids(house_id) AS (VALUES ${syncedHouseIds.length ? syncedHouseIds.map(() => '(?)').join(', ') : '(NULL)'})`;

const noLocalFallbackForSyncedHouse = (houseIdColumn = 'house_id') =>
  `NOT (${houseIdColumn} IN (SELECT house_id FROM synced_house_ids) AND source_rank > 0)`;

const pendingItemImageUploadFallback =
  `EXISTS (
    SELECT 1
    FROM local_metadata pending_upload
    WHERE pending_upload.id = 'pending:image-upload:item_images:' || image_ids.id
  )`;

const pendingImageUploadFallback = (table: 'rooms' | 'containers' | 'boxes' | 'items') =>
  `EXISTS (
    SELECT 1
    FROM local_metadata pending_upload
    WHERE pending_upload.id = 'pending:image-upload:${table}:' || preferred_rows.id
  )`;

const queueRemoteImageDownloads = (
  database: PowerSyncReadDatabase,
  table: 'houses' | 'rooms' | 'containers' | 'boxes' | 'items' | 'item_images',
  rows: RemoteImageDownloadRow[]
) => {
  for (const row of rows) {
    const remotePath = table === 'item_images' ? row.remotePath : row.remoteImagePath;
    if (!remotePath?.startsWith('houses/')) continue;
    const houseId = row.houseId ?? row.house_id;
    if (!houseId) continue;
    void enqueueAndProcessPowerSyncRemoteImageDownload({
      database,
      table,
      houseId,
      id: row.id,
      remotePath,
      localPath: row.imagePath ?? row.image_path ?? null,
    });
  }
};

export const getPowerSyncRepositoryCounts = async (
  database: PowerSyncReadDatabase = getPowerSyncDatabase()
): Promise<PowerSyncRepositoryCounts> => {
  await database.waitForReady();

  return {
    houses: await getCount(
      database,
      `SELECT count(DISTINCT id) as count FROM (SELECT id FROM houses UNION ALL SELECT id FROM local_houses) WHERE ${notDeleted('houses')}`
    ),
    rooms: await getCount(
      database,
      `SELECT count(DISTINCT id) as count FROM (SELECT id FROM rooms UNION ALL SELECT id FROM local_rooms) WHERE ${notDeleted('rooms')}`
    ),
    containers: await getCount(
      database,
      `SELECT count(DISTINCT id) as count FROM (SELECT id FROM containers UNION ALL SELECT id FROM local_containers) WHERE ${notDeleted('containers')}`
    ),
    boxes: await getCount(
      database,
      `SELECT count(DISTINCT id) as count FROM (SELECT id FROM boxes UNION ALL SELECT id FROM local_boxes) WHERE ${notDeleted('boxes')}`
    ),
    items: await getCount(
      database,
      `SELECT count(DISTINCT id) as count FROM (SELECT id FROM items UNION ALL SELECT id FROM local_items) WHERE ${notDeleted('items')}`
    ),
    itemImages: await getCount(
      database,
      `SELECT count(DISTINCT id) as count FROM (SELECT id FROM item_images UNION ALL SELECT id FROM local_item_images) WHERE ${notDeleted('item_images')}`
    ),
    inboxEntries: await getCount(
      database,
      'SELECT count(DISTINCT id) as count FROM (SELECT id FROM inbox_entries UNION ALL SELECT id FROM local_inbox_entries)'
    ),
  };
};

export const getPowerSyncRepositoryHouses = async (
  database: PowerSyncReadDatabase = getPowerSyncDatabase()
): Promise<PowerSyncRepositoryHouse[]> => {
  await database.waitForReady();

  const rows = await database.getAll<PowerSyncRepositoryHouse>(`
    WITH combined_houses AS (
      SELECT
        'synced' AS source,
        id,
        name,
        owner_id,
        address,
        notes,
        image_path,
        1 AS source_rank
      FROM houses
      UNION ALL
      SELECT
        'local' AS source,
        id,
        name,
        owner_id,
        address,
        notes,
        image_path,
        0 AS source_rank
      FROM local_houses
    ),
    preferred_houses AS (
      SELECT *
      FROM combined_houses
      WHERE source_rank = (
        SELECT min(source_rank)
        FROM combined_houses candidate
        WHERE candidate.id = combined_houses.id
      )
    )
    SELECT
      h.source,
      h.id,
      h.name,
      h.owner_id,
      h.address,
      h.notes,
      CASE
        WHEN h.source = 'synced' AND h.image_path IS NULL THEN NULL
        ELSE coalesce(
          (SELECT local_houses.image_path FROM local_houses WHERE local_houses.id = h.id),
          h.image_path
        )
      END AS image_path,
      h.image_path AS remoteImagePath,
      ((SELECT count(DISTINCT id) FROM (SELECT id FROM rooms WHERE house_id = h.id UNION ALL SELECT id FROM local_rooms WHERE house_id = h.id))) AS rooms_count,
      ((SELECT count(DISTINCT id) FROM (SELECT id FROM containers WHERE house_id = h.id UNION ALL SELECT id FROM local_containers WHERE house_id = h.id) WHERE ${notDeleted('containers')})) AS containers_count,
      ((SELECT count(DISTINCT id) FROM (SELECT id FROM boxes WHERE house_id = h.id UNION ALL SELECT id FROM local_boxes WHERE house_id = h.id) WHERE ${notDeleted('boxes')})) AS boxes_count,
      ((SELECT count(DISTINCT id) FROM (SELECT id FROM items WHERE house_id = h.id UNION ALL SELECT id FROM local_items WHERE house_id = h.id) WHERE ${notDeleted('items')})) AS items_count,
      ((SELECT count(DISTINCT id) FROM (SELECT id FROM item_images WHERE house_id = h.id UNION ALL SELECT id FROM local_item_images WHERE house_id = h.id) WHERE ${notDeleted('item_images')})) AS item_images_count
    FROM preferred_houses h
    WHERE ${notDeleted('houses', 'h.id')}
    ORDER BY lower(coalesce(h.name, '')), h.id
  `);
  queueRemoteImageDownloads(database, 'houses', rows);
  return rows;
};

export const getPowerSyncRepositoryInventorySample = async (
  database: PowerSyncReadDatabase = getPowerSyncDatabase(),
  limit = 50
): Promise<PowerSyncRepositoryInventoryRow[]> => {
  await database.waitForReady();

  return database.getAll<PowerSyncRepositoryInventoryRow>(
    `
      WITH combined_rows AS (
        SELECT 'synced' AS source, 'room' AS type, id, house_id, NULL AS parent_type, NULL AS parent_id, name, image_path, NULL AS remote_path, 1 AS source_rank
        FROM rooms
        UNION ALL
        SELECT 'local' AS source, 'room' AS type, id, house_id, NULL AS parent_type, NULL AS parent_id, name, image_path, NULL AS remote_path, 0 AS source_rank
        FROM local_rooms
        UNION ALL
        SELECT 'synced' AS source, 'container' AS type, id, house_id, NULL AS parent_type, room_id AS parent_id, name, image_path, NULL AS remote_path, 1 AS source_rank
        FROM containers
        UNION ALL
        SELECT 'local' AS source, 'container' AS type, id, house_id, NULL AS parent_type, room_id AS parent_id, name, image_path, NULL AS remote_path, 0 AS source_rank
        FROM local_containers
        UNION ALL
        SELECT 'synced' AS source, 'box' AS type, id, house_id, parent_type, parent_id, name, image_path, NULL AS remote_path, 1 AS source_rank
        FROM boxes
        UNION ALL
        SELECT 'local' AS source, 'box' AS type, id, house_id, parent_type, parent_id, name, image_path, NULL AS remote_path, 0 AS source_rank
        FROM local_boxes
        UNION ALL
        SELECT 'synced' AS source, 'item' AS type, id, house_id, parent_type, parent_id, name, image_path, NULL AS remote_path, 1 AS source_rank
        FROM items
        UNION ALL
        SELECT 'local' AS source, 'item' AS type, id, house_id, parent_type, parent_id, name, image_path, NULL AS remote_path, 0 AS source_rank
        FROM local_items
        UNION ALL
        SELECT 'synced' AS source, 'item_image' AS type, id, house_id, NULL AS parent_type, item_id AS parent_id, NULL AS name, image_path, remote_path, 1 AS source_rank
        FROM item_images
        UNION ALL
        SELECT 'local' AS source, 'item_image' AS type, id, house_id, NULL AS parent_type, item_id AS parent_id, NULL AS name, image_path, remote_path, 0 AS source_rank
        FROM local_item_images
      ),
      preferred_rows AS (
        SELECT *
        FROM combined_rows
        WHERE source_rank = (
          SELECT min(source_rank)
          FROM combined_rows candidate
          WHERE candidate.type = combined_rows.type AND candidate.id = combined_rows.id
        )
      )
      SELECT source, type, id, house_id, parent_type, parent_id, name, image_path, remote_path
      FROM preferred_rows
      WHERE (type <> 'room' OR ${notDeleted('rooms')})
        AND (type <> 'container' OR ${notDeleted('containers')})
        AND (type <> 'box' OR ${notDeleted('boxes')})
        AND (type <> 'item' OR ${notDeleted('items')})
      ORDER BY source, type, name, id
      LIMIT ?
    `,
    [limit]
  );
};

export const getPowerSyncRepositoryInventoryRowsForHouse = async (
  database: PowerSyncReadDatabase = getPowerSyncDatabase(),
  houseId: string
): Promise<PowerSyncRepositoryInventoryRow[]> => {
  await database.waitForReady();

  return database.getAll<PowerSyncRepositoryInventoryRow>(
    `
      WITH combined_rows AS (
        SELECT 'synced' AS source, 'room' AS type, id, house_id, NULL AS parent_type, NULL AS parent_id, name, image_path, NULL AS remote_path, 1 AS source_rank
        FROM rooms
        UNION ALL
        SELECT 'local' AS source, 'room' AS type, id, house_id, NULL AS parent_type, NULL AS parent_id, name, image_path, NULL AS remote_path, 0 AS source_rank
        FROM local_rooms
        UNION ALL
        SELECT 'synced' AS source, 'container' AS type, id, house_id, NULL AS parent_type, room_id AS parent_id, name, image_path, NULL AS remote_path, 1 AS source_rank
        FROM containers
        UNION ALL
        SELECT 'local' AS source, 'container' AS type, id, house_id, NULL AS parent_type, room_id AS parent_id, name, image_path, NULL AS remote_path, 0 AS source_rank
        FROM local_containers
        UNION ALL
        SELECT 'synced' AS source, 'box' AS type, id, house_id, parent_type, parent_id, name, image_path, NULL AS remote_path, 1 AS source_rank
        FROM boxes
        UNION ALL
        SELECT 'local' AS source, 'box' AS type, id, house_id, parent_type, parent_id, name, image_path, NULL AS remote_path, 0 AS source_rank
        FROM local_boxes
        UNION ALL
        SELECT 'synced' AS source, 'item' AS type, id, house_id, parent_type, parent_id, name, image_path, NULL AS remote_path, 1 AS source_rank
        FROM items
        UNION ALL
        SELECT 'local' AS source, 'item' AS type, id, house_id, parent_type, parent_id, name, image_path, NULL AS remote_path, 0 AS source_rank
        FROM local_items
        UNION ALL
        SELECT 'synced' AS source, 'item_image' AS type, id, house_id, NULL AS parent_type, item_id AS parent_id, NULL AS name, image_path, remote_path, 1 AS source_rank
        FROM item_images
        UNION ALL
        SELECT 'local' AS source, 'item_image' AS type, id, house_id, NULL AS parent_type, item_id AS parent_id, NULL AS name, image_path, remote_path, 0 AS source_rank
        FROM local_item_images
      ),
      preferred_rows AS (
        SELECT *
        FROM combined_rows
        WHERE source_rank = (
          SELECT min(source_rank)
          FROM combined_rows candidate
          WHERE candidate.type = combined_rows.type AND candidate.id = combined_rows.id
        )
      )
      SELECT source, type, id, house_id, parent_type, parent_id, name, image_path, remote_path
      FROM preferred_rows
      WHERE house_id = ?
        AND (type <> 'room' OR ${notDeleted('rooms')})
        AND (type <> 'container' OR ${notDeleted('containers')})
        AND (type <> 'box' OR ${notDeleted('boxes')})
        AND (type <> 'item' OR ${notDeleted('items')})
      ORDER BY type, name, id
    `,
    [houseId]
  );
};

export const getPowerSyncRepositoryRooms = async (
  database: PowerSyncReadDatabase = getPowerSyncDatabase(),
  houseId?: string
): Promise<PowerSyncRepositoryRoom[]> => {
  await database.waitForReady();
  const filter = optionalHouseFilter(houseId);
  const syncedHouseIds = await loadSyncedPowerSyncHouseIds(database);

  const rows = await database.getAll<PowerSyncRepositoryRoom>(
    `
      WITH ${syncedHouseIdsCte(syncedHouseIds)},
      combined_rows AS (
        SELECT id, house_id, name, description, image_path, created_by, updated_by, ${sourceRankCase()} AS source_rank FROM rooms
        UNION ALL
        SELECT id, house_id, name, description, image_path, created_by, updated_by, ${localSourceRankCase()} AS source_rank FROM local_rooms
      ),
      preferred_rows AS (
        SELECT *
        FROM combined_rows
        WHERE source_rank = (
          SELECT min(source_rank)
          FROM combined_rows candidate
          WHERE candidate.id = combined_rows.id
        )
      )
      SELECT
        id,
        house_id AS houseId,
        name,
        description,
        CASE
          WHEN source_rank = 0 AND image_path IS NULL AND NOT ${pendingImageUploadFallback('rooms')} THEN NULL
          ELSE coalesce(
            (SELECT local_rooms.image_path FROM local_rooms WHERE local_rooms.id = preferred_rows.id),
            image_path
          )
        END AS imagePath,
        image_path AS remoteImagePath,
        created_by AS createdBy,
        updated_by AS updatedBy
      FROM preferred_rows
      ${filter.clause}
      ${filter.clause ? 'AND' : 'WHERE'} ${notDeleted('rooms')}
        AND ${noLocalFallbackForSyncedHouse()}
      ORDER BY lower(coalesce(name, '')), id
    `,
    [...syncedHouseIds, ...filter.params]
  );
  queueRemoteImageDownloads(database, 'rooms', rows);
  return rows;
};

export const getPowerSyncRepositoryContainers = async (
  database: PowerSyncReadDatabase = getPowerSyncDatabase(),
  houseId?: string
): Promise<PowerSyncRepositoryContainer[]> => {
  await database.waitForReady();
  const syncedHouseIds = await loadSyncedPowerSyncHouseIds(database);
  const filterClause = houseId ? 'WHERE effective_house_id = ?' : '';
  const filterParams = houseId ? [houseId] : [];

  const rows = await database.getAll<PowerSyncRepositoryContainer>(
    `
      WITH ${syncedHouseIdsCte(syncedHouseIds)},
      combined_rows AS (
        SELECT id, house_id, room_id, name, description, image_path, created_by, updated_by, ${sourceRankCase()} AS source_rank FROM containers
        UNION ALL
        SELECT id, house_id, room_id, name, description, image_path, created_by, updated_by, ${localSourceRankCase()} AS source_rank FROM local_containers
      ),
      preferred_rows AS (
        SELECT
          *,
          coalesce(
            nullif(house_id, ''),
            (SELECT nullif(local_rooms.house_id, '') FROM local_rooms WHERE local_rooms.id = combined_rows.room_id),
            (SELECT nullif(rooms.house_id, '') FROM rooms WHERE rooms.id = combined_rows.room_id)
          ) AS effective_house_id
        FROM combined_rows
        WHERE source_rank = (
          SELECT min(source_rank)
          FROM combined_rows candidate
          WHERE candidate.id = combined_rows.id
        )
      )
      SELECT
        id,
        effective_house_id AS houseId,
        room_id AS roomId,
        name,
        description,
        CASE
          WHEN source_rank = 0 AND image_path IS NULL AND NOT ${pendingImageUploadFallback('containers')} THEN NULL
          ELSE coalesce(
            (SELECT local_containers.image_path FROM local_containers WHERE local_containers.id = preferred_rows.id),
            image_path
          )
        END AS imagePath,
        image_path AS remoteImagePath,
        created_by AS createdBy,
        updated_by AS updatedBy
      FROM preferred_rows
      ${filterClause}
      ${filterClause ? 'AND' : 'WHERE'} ${notDeleted('containers')}
        AND ${noLocalFallbackForSyncedHouse('effective_house_id')}
      ORDER BY lower(coalesce(name, '')), id
    `,
    [...syncedHouseIds, ...filterParams]
  );
  queueRemoteImageDownloads(database, 'containers', rows);
  return rows;
};

export const getPowerSyncRepositoryBoxes = async (
  database: PowerSyncReadDatabase = getPowerSyncDatabase(),
  houseId?: string
): Promise<PowerSyncRepositoryBox[]> => {
  await database.waitForReady();
  const filter = optionalHouseFilter(houseId);
  const syncedHouseIds = await loadSyncedPowerSyncHouseIds(database);

  const rows = await database.getAll<PowerSyncRepositoryBox>(
    `
      WITH ${syncedHouseIdsCte(syncedHouseIds)},
      combined_rows AS (
        SELECT id, house_id, parent_type, parent_id, name, description, image_path, tags, created_by, updated_by, ${sourceRankCase()} AS source_rank FROM boxes
        UNION ALL
        SELECT id, house_id, parent_type, parent_id, name, description, image_path, tags, created_by, updated_by, ${localSourceRankCase()} AS source_rank FROM local_boxes
      ),
      preferred_rows AS (
        SELECT *
        FROM combined_rows
        WHERE source_rank = (
          SELECT min(source_rank)
          FROM combined_rows candidate
          WHERE candidate.id = combined_rows.id
        )
      )
      SELECT
        id,
        house_id AS houseId,
        parent_type AS parentType,
        parent_id AS parentId,
        name,
        description,
        CASE
          WHEN source_rank = 0 AND image_path IS NULL AND NOT ${pendingImageUploadFallback('boxes')} THEN NULL
          ELSE coalesce(
            (SELECT local_boxes.image_path FROM local_boxes WHERE local_boxes.id = preferred_rows.id),
            image_path
          )
        END AS imagePath,
        image_path AS remoteImagePath,
        coalesce(tags, '') AS tags,
        created_by AS createdBy,
        updated_by AS updatedBy
      FROM preferred_rows
      ${filter.clause}
      ${filter.clause ? 'AND' : 'WHERE'} ${notDeleted('boxes')}
        AND ${noLocalFallbackForSyncedHouse()}
      ORDER BY lower(coalesce(name, '')), id
    `,
    [...syncedHouseIds, ...filter.params]
  );
  queueRemoteImageDownloads(database, 'boxes', rows);
  return rows;
};

export const getPowerSyncRepositoryItems = async (
  database: PowerSyncReadDatabase = getPowerSyncDatabase(),
  houseId?: string
): Promise<PowerSyncRepositoryItem[]> => {
  await database.waitForReady();
  const filter = optionalHouseFilter(houseId);
  const syncedHouseIds = await loadSyncedPowerSyncHouseIds(database);

  const rows = await database.getAll<PowerSyncRepositoryItem>(
    `
      WITH ${syncedHouseIdsCte(syncedHouseIds)},
      combined_rows AS (
        SELECT id, house_id, parent_type, parent_id, name, description, image_path, tags, purchase_price_cents, notes, created_by, updated_by, ${sourceRankCase()} AS source_rank FROM items
        UNION ALL
        SELECT id, house_id, parent_type, parent_id, name, description, image_path, tags, purchase_price_cents, notes, created_by, updated_by, ${localSourceRankCase()} AS source_rank FROM local_items
      ),
      preferred_rows AS (
        SELECT *
        FROM combined_rows
        WHERE source_rank = (
          SELECT min(source_rank)
          FROM combined_rows candidate
          WHERE candidate.id = combined_rows.id
        )
      )
      SELECT
        id,
        house_id AS houseId,
        parent_type AS parentType,
        parent_id AS parentId,
        name,
        description,
        CASE
          WHEN source_rank = 0 AND image_path IS NULL AND NOT ${pendingImageUploadFallback('items')} THEN NULL
          ELSE coalesce(
            (SELECT local_items.image_path FROM local_items WHERE local_items.id = preferred_rows.id),
            image_path
          )
        END AS imagePath,
        image_path AS remoteImagePath,
        coalesce(tags, '') AS tags,
        purchase_price_cents AS purchasePriceCents,
        notes,
        created_by AS createdBy,
        updated_by AS updatedBy
      FROM preferred_rows
      ${filter.clause}
      ${filter.clause ? 'AND' : 'WHERE'} ${notDeleted('items')}
        AND ${noLocalFallbackForSyncedHouse()}
      ORDER BY lower(coalesce(name, '')), id
    `,
    [...syncedHouseIds, ...filter.params]
  );
  queueRemoteImageDownloads(database, 'items', rows);
  return rows;
};

export const getPowerSyncRepositoryItemImages = async (
  database: PowerSyncReadDatabase = getPowerSyncDatabase(),
  itemId?: string
): Promise<PowerSyncRepositoryItemImage[]> => {
  await database.waitForReady();
  const syncedHouseIds = await loadSyncedPowerSyncHouseIds(database);
  const filterClause = itemId ? 'AND coalesce(synced.item_id, local.item_id) = ?' : '';
  const params = itemId ? [itemId] : [];

  const rows = await database.getAll<PowerSyncRepositoryItemImage>(
    `
      WITH ${syncedHouseIdsCte(syncedHouseIds)},
      image_ids AS (
        SELECT id FROM item_images
        UNION
        SELECT id FROM local_item_images
      )
      SELECT
        image_ids.id AS id,
        coalesce(synced.item_id, local.item_id) AS itemId,
        coalesce(synced.house_id, local.house_id) AS houseId,
        local.image_path AS imagePath,
        coalesce(synced.remote_path, local.remote_path) AS remotePath,
        coalesce(local.position, synced.position, 0) AS position,
        coalesce(synced.created_by, local.created_by) AS createdBy,
        coalesce(synced.updated_by, local.updated_by) AS updatedBy
      FROM image_ids
      LEFT JOIN item_images synced ON synced.id = image_ids.id
      LEFT JOIN local_item_images local ON local.id = image_ids.id
      WHERE ${notDeleted('item_images', 'image_ids.id')}
        AND NOT (
          coalesce(synced.house_id, local.house_id) IN (SELECT house_id FROM synced_house_ids)
          AND synced.id IS NULL
          AND NOT ${pendingItemImageUploadFallback}
        )
      ${filterClause}
      ORDER BY position, id
    `,
    [...syncedHouseIds, ...params]
  );
  queueRemoteImageDownloads(database, 'item_images', rows);
  if (!itemId || rows.some((row) => Boolean(row.imagePath))) {
    return rows;
  }

  const item = (await getPowerSyncRepositoryItems(database)).find((candidate) => candidate.id === itemId);
  if (!item?.imagePath) {
    return rows;
  }

  return [
    {
      id: `legacy-${item.id}`,
      itemId: item.id,
      houseId: item.houseId,
      imagePath: item.imagePath,
      remotePath: item.remoteImagePath ?? null,
      position: 0,
      createdBy: item.createdBy,
      updatedBy: item.updatedBy,
    },
    ...rows,
  ];
};

export const getPowerSyncRepositoryHouseById = async (
  database: PowerSyncReadDatabase = getPowerSyncDatabase(),
  houseId: string
) => {
  const houses = await getPowerSyncRepositoryHouses(database);
  return houses.find((house) => house.id === houseId) ?? null;
};
