/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadWithMocks } = require('./helpers/moduleMocks');
const { createAsyncStorageMock } = require('./helpers/createAsyncStorageMock');

const migrationPath = path.resolve(__dirname, '../utils/powersync/legacyWatermelonMigration.ts');

const createLegacyDatabase = (tables) => ({
  collections: {
    get(tableName) {
      return {
        query() {
          return {
            async fetch() {
              return tables[tableName] ?? [];
            },
          };
        },
      };
    },
  },
});

const createPowerSyncDatabaseMock = ({ localCounts = {} } = {}) => {
  const statements = [];
  const completedBatches = [];
  return {
    statements,
    completedBatches,
    async getOptional(sql) {
      const match = sql.match(/FROM\s+(local_\w+)/i);
      if (!match) return null;
      return { count: localCounts[match[1]] ?? 0 };
    },
    async writeTransaction(callback) {
      return await callback({
        async execute(sql, params) {
          statements.push({ sql, params });
          return { rowsAffected: 1 };
        },
      });
    },
    async getCrudBatch() {
      if (completedBatches.length > 0) return null;
      return {
        async complete() {
          completedBatches.push(true);
        },
      };
    },
  };
};

test('legacy Watermelon migration copies local rows and marks houses local-only', async () => {
  const AsyncStorage = createAsyncStorageMock({
    activeHouseId: 'house-1',
    installDefaultHouseId: 'house-1',
  });
  const powerSyncDatabase = createPowerSyncDatabaseMock();

  const { migrateLegacyWatermelonDataToPowerSync } = loadWithMocks(migrationPath, {
    '@react-native-async-storage/async-storage': AsyncStorage,
  });

  const result = await migrateLegacyWatermelonDataToPowerSync({
    legacyDatabase: createLegacyDatabase({
      houses: [
        {
          id: 'house-1',
          name: 'My Home',
          ownerId: null,
          address: null,
          notes: 'local note',
          imagePath: 'everfind-images/house.jpg',
        },
      ],
      rooms: [{ id: 'room-1', houseId: 'house-1', name: 'Kitchen' }],
      containers: [],
      boxes: [],
      items: [
        {
          id: 'item-1',
          houseId: 'house-1',
          parentType: 'room',
          parentId: 'room-1',
          name: 'Kettle',
          tags: 'kitchen',
          purchasePriceCents: 1299,
        },
      ],
      item_images: [
        {
          id: 'legacy-item-1',
          itemId: 'item-1',
          houseId: 'house-1',
          imagePath: 'everfind-images/item.jpg',
          remotePath: null,
          position: 0,
        },
      ],
      inbox_entries: [],
    }),
    powerSyncDatabase,
    storage: AsyncStorage,
    now: () => 12345,
  });

  assert.equal(result.migrated, true);
  assert.equal(result.rowCounts.houses, 1);
  assert.equal(result.rowCounts.items, 1);

  assert.ok(
    powerSyncDatabase.statements.some(
      (statement) =>
        statement.sql.startsWith('INSERT OR REPLACE INTO local_houses') &&
        statement.params.includes('house-1') &&
        statement.params.includes('everfind-images/house.jpg')
    )
  );
  assert.ok(
    powerSyncDatabase.statements.some(
      (statement) =>
        statement.sql.startsWith('INSERT OR REPLACE INTO local_item_images') &&
        statement.params.includes('legacy-item-1') &&
        statement.params.includes('everfind-images/item.jpg')
    )
  );
  assert.equal(powerSyncDatabase.completedBatches.length, 1);

  const houseStates = JSON.parse(await AsyncStorage.getItem('powersyncHouseSyncStateByHouseId:v1'));
  assert.deepEqual(houseStates, { 'house-1': 'local_only' });

  const status = JSON.parse(await AsyncStorage.getItem('powersyncLocalDataMigration:v2'));
  assert.equal(status.state, 'completed');
});

test('legacy Watermelon migration is idempotent after completion', async () => {
  const AsyncStorage = createAsyncStorageMock({
    'powersyncLocalDataMigration:v2': JSON.stringify({
      state: 'completed',
      rowCounts: { houses: 1 },
    }),
  });
  const powerSyncDatabase = createPowerSyncDatabaseMock({
    localCounts: {
      local_houses: 1,
    },
  });

  const { migrateLegacyWatermelonDataToPowerSync } = loadWithMocks(migrationPath, {
    '@react-native-async-storage/async-storage': AsyncStorage,
  });

  const result = await migrateLegacyWatermelonDataToPowerSync({
    legacyDatabase: createLegacyDatabase({ houses: [{ id: 'house-1', name: 'My Home' }] }),
    powerSyncDatabase,
    storage: AsyncStorage,
  });

  assert.equal(result.migrated, false);
  assert.deepEqual(result.rowCounts, { houses: 1 });
  assert.equal(powerSyncDatabase.statements.length, 0);
});

test('legacy Watermelon migration repairs a completed marker with missing local mirror rows once', async () => {
  const AsyncStorage = createAsyncStorageMock({
    'powersyncLocalDataMigration:v2': JSON.stringify({
      state: 'completed',
      rowCounts: { houses: 2, rooms: 0, containers: 0, boxes: 0, items: 0, item_images: 0, inbox_entries: 0 },
    }),
  });
  const powerSyncDatabase = createPowerSyncDatabaseMock({
    localCounts: {
      local_houses: 2,
      local_rooms: 0,
      local_containers: 0,
      local_boxes: 0,
      local_items: 0,
      local_item_images: 0,
      local_inbox_entries: 0,
    },
  });

  const { migrateLegacyWatermelonDataToPowerSync } = loadWithMocks(migrationPath, {
    '@react-native-async-storage/async-storage': AsyncStorage,
  });

  const result = await migrateLegacyWatermelonDataToPowerSync({
    legacyDatabase: createLegacyDatabase({
      houses: [{ id: 'house-1', name: 'My Home' }, { id: 'house-2', name: 'Second Home' }],
      rooms: [{ id: 'room-1', houseId: 'house-1', name: 'Kitchen' }],
      containers: [{ id: 'container-1', houseId: 'house-1', roomId: 'room-1', name: 'Cabinet' }],
      boxes: [],
      items: [{ id: 'item-1', houseId: 'house-1', parentType: 'room', parentId: 'room-1', name: 'Kettle' }],
      item_images: [],
      inbox_entries: [],
    }),
    powerSyncDatabase,
    storage: AsyncStorage,
    now: () => 45678,
  });

  assert.equal(result.migrated, true);
  assert.equal(result.rowCounts.houses, 2);
  assert.equal(result.rowCounts.rooms, 1);
  assert.equal(result.rowCounts.containers, 1);
  assert.equal(result.rowCounts.items, 1);

  const deleteStatements = powerSyncDatabase.statements
    .map((statement) => statement.sql)
    .filter((sql) => sql.startsWith('DELETE FROM local_'));
  assert.deepEqual(deleteStatements, [
    'DELETE FROM local_inbox_entries',
    'DELETE FROM local_item_images',
    'DELETE FROM local_items',
    'DELETE FROM local_boxes',
    'DELETE FROM local_containers',
    'DELETE FROM local_rooms',
    'DELETE FROM local_houses',
  ]);
  assert.ok(
    powerSyncDatabase.statements.some(
      (statement) =>
        statement.sql.startsWith('INSERT OR REPLACE INTO local_rooms') &&
        statement.params.includes('room-1')
    )
  );
  assert.ok(
    powerSyncDatabase.statements.some(
      (statement) =>
        statement.sql.startsWith('INSERT OR REPLACE INTO local_containers') &&
        statement.params.includes('container-1')
    )
  );

  const repairMarker = JSON.parse(await AsyncStorage.getItem('powersyncLocalDataMigrationRepair:v1'));
  assert.equal(repairMarker.reason, 'local_mirror_missing_legacy_rows');

  const status = JSON.parse(await AsyncStorage.getItem('powersyncLocalDataMigration:v2'));
  assert.equal(status.state, 'completed');
  assert.equal(status.rowCounts.rooms, 1);
});

test('diagnostic local-only refresh clears and repopulates local mirror tables', async () => {
  const AsyncStorage = createAsyncStorageMock();
  const powerSyncDatabase = createPowerSyncDatabaseMock();

  const { refreshPowerSyncLocalOnlyDataFromWatermelon } = loadWithMocks(migrationPath, {
    '@react-native-async-storage/async-storage': AsyncStorage,
  });

  const result = await refreshPowerSyncLocalOnlyDataFromWatermelon({
    legacyDatabase: createLegacyDatabase({
      houses: [{ id: 'house-2', name: 'Second Home' }],
      rooms: [{ id: 'room-2', houseId: 'house-2', name: 'Office' }],
      containers: [],
      boxes: [{ id: 'box-2', houseId: 'house-2', name: 'Cables' }],
      items: [],
      item_images: [],
      inbox_entries: [],
    }),
    powerSyncDatabase,
    storage: AsyncStorage,
  });

  assert.equal(result.refreshed, true);
  assert.equal(result.rowCounts.houses, 1);
  assert.equal(result.rowCounts.boxes, 1);

  const deleteStatements = powerSyncDatabase.statements
    .map((statement) => statement.sql)
    .filter((sql) => sql.startsWith('DELETE FROM local_'));
  assert.deepEqual(deleteStatements, [
    'DELETE FROM local_inbox_entries',
    'DELETE FROM local_item_images',
    'DELETE FROM local_items',
    'DELETE FROM local_boxes',
    'DELETE FROM local_containers',
    'DELETE FROM local_rooms',
    'DELETE FROM local_houses',
  ]);
  assert.ok(
    powerSyncDatabase.statements.some(
      (statement) =>
        statement.sql.startsWith('INSERT OR REPLACE INTO local_houses') &&
        statement.params.includes('house-2')
    )
  );
  assert.ok(
    powerSyncDatabase.statements.some(
      (statement) =>
        statement.sql.startsWith('INSERT OR REPLACE INTO local_boxes') &&
        statement.params.includes('box-2')
    )
  );
  assert.equal(powerSyncDatabase.completedBatches.length, 1);

  const houseStates = JSON.parse(await AsyncStorage.getItem('powersyncHouseSyncStateByHouseId:v1'));
  assert.deepEqual(houseStates, { 'house-2': 'local_only' });
});
