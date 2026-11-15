/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadWithMocks } = require('./helpers/moduleMocks');

const repositoryPath = path.resolve(__dirname, '../utils/powersync/repository.ts');

const normalizeSql = (sql) => sql.replace(/\s+/g, ' ').trim();

const createRepositoryModule = ({ powerSyncHouseSyncStates = {}, legacySyncedHouseIds = [], syncedHouseRows = [] } = {}) => {
  const calls = [];
  const queuedDownloads = [];
  const database = {
    calls,
    async waitForReady() {
      calls.push({ method: 'waitForReady' });
    },
    async getOptional(sql) {
      calls.push({ method: 'getOptional', sql });
      const normalized = normalizeSql(sql);
      if (normalized.includes('FROM (SELECT id FROM houses UNION ALL SELECT id FROM local_houses)')) {
        return { count: 2 };
      }
      if (normalized.includes('FROM (SELECT id FROM rooms UNION ALL SELECT id FROM local_rooms)')) {
        return { count: 3 };
      }
      if (normalized.includes('FROM (SELECT id FROM containers UNION ALL SELECT id FROM local_containers)')) {
        return { count: 1 };
      }
      if (normalized.includes('FROM (SELECT id FROM boxes UNION ALL SELECT id FROM local_boxes)')) {
        return { count: 0 };
      }
      if (normalized.includes('FROM (SELECT id FROM items UNION ALL SELECT id FROM local_items)')) {
        return { count: 4 };
      }
      if (normalized.includes('FROM (SELECT id FROM item_images UNION ALL SELECT id FROM local_item_images)')) {
        return { count: 5 };
      }
      if (normalized.includes('FROM (SELECT id FROM inbox_entries UNION ALL SELECT id FROM local_inbox_entries)')) {
        return { count: 0 };
      }
      return null;
    },
    async getAll(sql, params) {
      calls.push({ method: 'getAll', sql, params });
      const normalized = normalizeSql(sql);
      if (normalized.includes('WITH combined_houses AS')) {
        return [
          {
            source: 'local',
            id: 'house-1',
            name: 'Local Home',
            owner_id: null,
            address: null,
            notes: null,
            image_path: 'local.jpg',
            rooms_count: 2,
            containers_count: 1,
            boxes_count: 0,
            items_count: 2,
            item_images_count: 1,
          },
          {
            source: 'local',
            id: 'house-2',
            name: 'Only Local',
            owner_id: null,
            address: null,
            notes: null,
            image_path: null,
            rooms_count: 1,
            containers_count: 0,
            boxes_count: 0,
            items_count: 2,
            item_images_count: 4,
          },
        ];
      }
      if (normalized.includes('purchase_price_cents AS purchasePriceCents')) {
        return [
          {
            id: 'item-1',
            houseId: 'house-1',
            parentType: 'room',
            parentId: 'room-1',
            name: 'Local Item',
            description: null,
            imagePath: 'everfind-images/item-1.jpg',
            remoteImagePath: null,
            tags: '',
            purchasePriceCents: null,
            notes: null,
            createdBy: null,
            updatedBy: null,
          },
        ];
      }
      if (normalized === 'SELECT id FROM houses') {
        return syncedHouseRows;
      }
      if (normalized.includes('WITH combined_rows AS')) {
        return [
          {
            source: 'local',
            type: 'item',
            id: 'item-1',
            house_id: 'house-1',
            parent_type: 'room',
            parent_id: 'room-1',
            name: 'Local Item',
            image_path: 'item.jpg',
            remote_path: null,
          },
        ];
      }
      return [];
    },
  };

  const module = loadWithMocks(repositoryPath, {
    './system': {
      getPowerSyncDatabase: () => database,
    },
    './metadata': {
      loadPowerSyncHouseSyncStates: async () => powerSyncHouseSyncStates,
    },
    '@/utils/sync/settingsMetadata': {
      loadSyncedHouseIds: async () => legacySyncedHouseIds,
    },
    './imageDownloadQueue': {
      enqueueAndProcessPowerSyncRemoteImageDownload: async (download) => {
        queuedDownloads.push(download);
      },
    },
  });

  return { ...module, database, queuedDownloads };
};

test('PowerSync repository counts distinct synced and local IDs', async () => {
  const { getPowerSyncRepositoryCounts, database } = createRepositoryModule();

  const counts = await getPowerSyncRepositoryCounts();

  assert.deepEqual(counts, {
    houses: 2,
    rooms: 3,
    containers: 1,
    boxes: 0,
    items: 4,
    itemImages: 5,
    inboxEntries: 0,
  });
  assert.equal(database.calls.filter((call) => call.method === 'waitForReady').length, 1);
});

test('PowerSync repository house query prefers local rows over synced duplicates', async () => {
  const { getPowerSyncRepositoryHouses, database } = createRepositoryModule();

  const houses = await getPowerSyncRepositoryHouses();

  assert.equal(houses.length, 2);
  assert.equal(houses[0].source, 'local');
  assert.equal(houses[0].id, 'house-1');
  assert.equal(houses[0].name, 'Local Home');

  const query = normalizeSql(database.calls.find((call) => call.method === 'getAll').sql);
  assert.ok(query.includes('min(source_rank)'));
  assert.ok(query.includes('FROM local_houses'));
  assert.ok(query.includes('FROM houses'));
});

test('PowerSync repository inventory sample uses local-preferred combined rows', async () => {
  const { getPowerSyncRepositoryInventorySample, database } = createRepositoryModule();

  const rows = await getPowerSyncRepositoryInventorySample(undefined, 25);

  assert.deepEqual(rows, [
    {
      source: 'local',
      type: 'item',
      id: 'item-1',
      house_id: 'house-1',
      parent_type: 'room',
      parent_id: 'room-1',
      name: 'Local Item',
      image_path: 'item.jpg',
      remote_path: null,
    },
  ]);
  const sampleCall = database.calls.find(
    (call) => call.method === 'getAll' && normalizeSql(call.sql).includes('WITH combined_rows AS')
  );
  assert.deepEqual(sampleCall.params, [25]);
  assert.ok(normalizeSql(sampleCall.sql).includes('candidate.type = combined_rows.type AND candidate.id = combined_rows.id'));
});

test('PowerSync repository inventory house query filters local-preferred rows by house', async () => {
  const { getPowerSyncRepositoryInventoryRowsForHouse, database } = createRepositoryModule();

  const rows = await getPowerSyncRepositoryInventoryRowsForHouse(undefined, 'house-1');

  assert.equal(rows.length, 1);
  const houseCall = database.calls.find(
    (call) => call.method === 'getAll' && normalizeSql(call.sql).includes('WHERE house_id = ?')
  );
  assert.deepEqual(houseCall.params, ['house-1']);
  assert.ok(normalizeSql(houseCall.sql).includes('FROM local_item_images'));
});

test('PowerSync repository container query filters by derived effective house id', async () => {
  const { getPowerSyncRepositoryContainers, database } = createRepositoryModule();

  await getPowerSyncRepositoryContainers(undefined, 'house-1');

  const containerCall = database.calls.find(
    (call) => call.method === 'getAll' && normalizeSql(call.sql).includes('effective_house_id AS houseId')
  );
  assert.deepEqual(containerCall.params, ['house-1']);
  assert.ok(normalizeSql(containerCall.sql).includes('WHERE effective_house_id = ?'));
  assert.ok(normalizeSql(containerCall.sql).includes('SELECT nullif(local_rooms.house_id, \'\')'));
});

test('PowerSync repository row queries prefer synced rows for synced houses', async () => {
  const { getPowerSyncRepositoryRooms, database } = createRepositoryModule({
    powerSyncHouseSyncStates: { 'house-1': 'synced' },
  });

  await getPowerSyncRepositoryRooms(undefined, 'house-1');

  const roomCall = database.calls.find(
    (call) => call.method === 'getAll' && normalizeSql(call.sql).includes('FROM local_rooms')
  );
  const normalized = normalizeSql(roomCall.sql);
  assert.deepEqual(roomCall.params, ['house-1', 'house-1']);
  assert.ok(normalized.includes('synced_house_ids(house_id) AS (VALUES (?))'));
  assert.ok(normalized.includes('CASE WHEN house_id IN (SELECT house_id FROM synced_house_ids) THEN 0 ELSE 1 END AS source_rank FROM rooms'));
  assert.ok(normalized.includes('CASE WHEN house_id IN (SELECT house_id FROM synced_house_ids) THEN 1 ELSE 0 END AS source_rank FROM local_rooms'));
  assert.ok(normalized.includes('NOT (house_id IN (SELECT house_id FROM synced_house_ids) AND source_rank > 0)'));
});

test('PowerSync repository row queries prefer synced rows for legacy sync-enabled houses', async () => {
  const { getPowerSyncRepositoryRooms, database } = createRepositoryModule({
    legacySyncedHouseIds: ['house-1'],
  });

  await getPowerSyncRepositoryRooms(undefined, 'house-1');

  const roomCall = database.calls.find(
    (call) => call.method === 'getAll' && normalizeSql(call.sql).includes('FROM local_rooms')
  );
  assert.deepEqual(roomCall.params, ['house-1', 'house-1']);
  assert.ok(normalizeSql(roomCall.sql).includes('synced_house_ids(house_id) AS (VALUES (?))'));
});

test('PowerSync repository treats migrated local-only houses as local even with legacy sync metadata', async () => {
  const { getPowerSyncRepositoryRooms, database } = createRepositoryModule({
    powerSyncHouseSyncStates: { 'house-1': 'local_only' },
    legacySyncedHouseIds: ['house-1'],
  });

  await getPowerSyncRepositoryRooms(undefined, 'house-1');

  const roomCall = database.calls.find(
    (call) => call.method === 'getAll' && normalizeSql(call.sql).includes('FROM local_rooms')
  );
  const normalized = normalizeSql(roomCall.sql);
  assert.deepEqual(roomCall.params, ['house-1']);
  assert.ok(normalized.includes('synced_house_ids(house_id) AS (VALUES (NULL))'));
});

test('PowerSync repository item image query does not revive local mirror rows for synced houses', async () => {
  const { getPowerSyncRepositoryItemImages, database } = createRepositoryModule({
    legacySyncedHouseIds: ['house-1'],
  });

  await getPowerSyncRepositoryItemImages(undefined, 'item-1');

  const itemImagesCall = database.calls.find(
    (call) => call.method === 'getAll' && normalizeSql(call.sql).includes('FROM local_item_images')
  );
  const normalized = normalizeSql(itemImagesCall.sql);
  assert.deepEqual(itemImagesCall.params, ['house-1', 'item-1']);
  assert.ok(normalized.includes('LEFT JOIN item_images synced ON synced.id = image_ids.id'));
  assert.ok(normalized.includes('LEFT JOIN local_item_images local ON local.id = image_ids.id'));
  assert.ok(normalized.includes('AND synced.id IS NULL'));
  assert.ok(normalized.includes("pending_upload.id = 'pending:image-upload:item_images:' || image_ids.id"));
});

test('PowerSync repository item image query uses local display cache with synced remote metadata', async () => {
  const { getPowerSyncRepositoryItemImages, database } = createRepositoryModule({
    powerSyncHouseSyncStates: { 'house-1': 'synced' },
  });

  await getPowerSyncRepositoryItemImages(undefined, 'item-1');

  const itemImagesCall = database.calls.find(
    (call) => call.method === 'getAll' && normalizeSql(call.sql).includes('FROM local_item_images')
  );
  const normalized = normalizeSql(itemImagesCall.sql);
  assert.ok(normalized.includes('local.image_path AS imagePath'));
  assert.ok(normalized.includes('coalesce(synced.remote_path, local.remote_path) AS remotePath'));
  assert.ok(normalized.includes('coalesce(local.position, synced.position, 0) AS position'));
});

test('PowerSync repository item image query falls back to local item cover image', async () => {
  const { getPowerSyncRepositoryItemImages } = createRepositoryModule();

  const rows = await getPowerSyncRepositoryItemImages(undefined, 'item-1');

  assert.deepEqual(rows, [
    {
      id: 'legacy-item-1',
      itemId: 'item-1',
      houseId: 'house-1',
      imagePath: 'everfind-images/item-1.jpg',
      remotePath: null,
      position: 0,
      createdBy: null,
      updatedBy: null,
    },
  ]);
});

test('PowerSync repository room query only falls back to local image while upload is pending', async () => {
  const { getPowerSyncRepositoryRooms, database } = createRepositoryModule({
    powerSyncHouseSyncStates: { 'house-1': 'synced' },
  });

  await getPowerSyncRepositoryRooms(undefined, 'house-1');

  const roomCall = database.calls.find(
    (call) => call.method === 'getAll' && normalizeSql(call.sql).includes('FROM local_rooms')
  );
  const normalized = normalizeSql(roomCall.sql);
  assert.ok(
    normalized.includes(
      "WHEN source_rank = 0 AND image_path IS NULL AND NOT EXISTS ( SELECT 1 FROM local_metadata pending_upload WHERE pending_upload.id = 'pending:image-upload:rooms:' || preferred_rows.id ) THEN NULL"
    )
  );
  assert.ok(normalized.includes('coalesce( (SELECT local_rooms.image_path FROM local_rooms WHERE local_rooms.id = preferred_rows.id), image_path )'));
});

test('PowerSync repository keeps local fallback while first sync state is not complete', async () => {
  const { getPowerSyncRepositoryRooms, database } = createRepositoryModule({
    powerSyncHouseSyncStates: { 'house-1': 'sync_enable_pending' },
    syncedHouseRows: [{ id: 'house-1' }],
  });

  await getPowerSyncRepositoryRooms(undefined, 'house-1');

  const roomCall = database.calls.find(
    (call) => call.method === 'getAll' && normalizeSql(call.sql).includes('FROM local_rooms')
  );
  const normalized = normalizeSql(roomCall.sql);
  assert.deepEqual(roomCall.params, ['house-1']);
  assert.ok(normalized.includes('synced_house_ids(house_id) AS (VALUES (NULL))'));
  assert.ok(normalized.includes('NOT (house_id IN (SELECT house_id FROM synced_house_ids) AND source_rank > 0)'));
});

test('PowerSync repository row queries leave out rows of tombstoned houses', async () => {
  const repository = createRepositoryModule();
  const hiddenHouse = (column) =>
    `NOT EXISTS (SELECT 1 FROM local_metadata hidden_house WHERE hidden_house.id = 'deleted:houses:' || ${column})`;

  await repository.getPowerSyncRepositoryRooms();
  await repository.getPowerSyncRepositoryContainers();
  await repository.getPowerSyncRepositoryBoxes();
  await repository.getPowerSyncRepositoryItems();
  await repository.getPowerSyncRepositoryItemImages();

  const sqlFor = (marker) =>
    normalizeSql(
      repository.database.calls.find(
        (call) => call.method === 'getAll' && normalizeSql(call.sql).includes(marker)
      ).sql
    );

  assert.ok(sqlFor('FROM local_rooms )').includes(hiddenHouse('house_id')));
  assert.ok(sqlFor('effective_house_id AS houseId').includes(hiddenHouse('effective_house_id')));
  assert.ok(sqlFor('FROM local_boxes )').includes(hiddenHouse('house_id')));
  assert.ok(sqlFor('FROM local_items )').includes(hiddenHouse('house_id')));
  assert.ok(
    sqlFor('LEFT JOIN local_item_images local').includes(hiddenHouse('coalesce(synced.house_id, local.house_id)'))
  );
});
