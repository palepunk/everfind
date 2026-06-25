const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

/* global __dirname */

const { loadWithMocks } = require('./helpers/moduleMocks');
const { createAsyncStorageMock } = require('./helpers/createAsyncStorageMock');

const inventorySyncPath = path.resolve(__dirname, '../utils/sync/inventorySync.ts');

const loadInventorySync = (AsyncStorage = createAsyncStorageMock()) =>
  loadWithMocks(inventorySyncPath, {
    '@react-native-async-storage/async-storage': AsyncStorage,
  });

test('legacy inventory cleanup clears stale custom-sync state', async () => {
  const AsyncStorage = createAsyncStorageMock({
    inventorySyncQueue: JSON.stringify([{ table: 'rooms', houseId: 'house-1' }]),
    inventoryLastSyncHouseIds: JSON.stringify(['house-1']),
    inventoryImageDeleteTombstones: '{}',
    inventoryMediaOps: '[]',
    inventoryPermissionRejections: '[]',
    inventoryPendingRemoteImageDownloads: '{}',
  });
  const inventorySync = loadInventorySync(AsyncStorage);

  await inventorySync.clearLegacyInventorySyncState();

  assert.equal(await AsyncStorage.getItem('inventorySyncQueue'), null);
  assert.equal(await AsyncStorage.getItem('inventoryLastSyncHouseIds'), null);
  assert.equal(await AsyncStorage.getItem('inventoryImageDeleteTombstones'), null);
  assert.equal(await AsyncStorage.getItem('inventoryPendingRemoteImageDownloads'), null);
});

test('legacy queue pruning removes stale stored queue entries', async () => {
  const AsyncStorage = createAsyncStorageMock({
    inventorySyncQueue: JSON.stringify([
      { table: 'rooms', houseId: 'house-1' },
      { table: 'items', houseId: 'house-2' },
    ]),
  });
  const inventorySync = loadInventorySync(AsyncStorage);

  await inventorySync.pruneQueuedChangesForHouse('house-1');
  assert.deepEqual(JSON.parse(await AsyncStorage.getItem('inventorySyncQueue')), [
    { table: 'items', houseId: 'house-2' },
  ]);

  await inventorySync.pruneQueueForDisabledHouses(['house-3']);
  assert.equal(await AsyncStorage.getItem('inventorySyncQueue'), null);
});

test('legacy first reconcile marker can be cleared by user', async () => {
  const AsyncStorage = createAsyncStorageMock({
    'inventoryFirstReconcileDone:v2:user-1': 'true',
  });
  const inventorySync = loadInventorySync(AsyncStorage);

  await inventorySync.clearLegacyFirstReconcileMarker('user-1');

  assert.equal(await AsyncStorage.getItem('inventoryFirstReconcileDone:v2:user-1'), null);
});
