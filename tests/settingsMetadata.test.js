const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

/* global __dirname */

const { loadWithMocks } = require('./helpers/moduleMocks');
const { createAsyncStorageMock } = require('./helpers/createAsyncStorageMock');
const { createDatabaseMock } = require('./helpers/createDatabaseMock');
const settingsMetadataPath = path.resolve(__dirname, '../utils/sync/settingsMetadata.ts');

test('settings metadata keeps local houses unsynced until explicitly enabled', async () => {
  const AsyncStorage = createAsyncStorageMock();
  const database = createDatabaseMock({
    houses: [{ id: 'local-house', name: 'Local House' }],
  });

  const settingsMetadata = loadWithMocks(settingsMetadataPath, {
    '@react-native-async-storage/async-storage': AsyncStorage,
    '@/utils/storage/database': { database },
    '@/utils/auth/session': {
      safeGetSession: async () => ({ access_token: 'token' }),
    },
  });

  const syncedHouseIds = await settingsMetadata.loadSyncedHouseIds();
  assert.deepEqual(syncedHouseIds, []);
  assert.equal(AsyncStorage.__state.get('cloudSyncEnabledHouseIdsInitialized'), 'true');
});

test('settings metadata only enables the install default house explicitly', async () => {
  const AsyncStorage = createAsyncStorageMock({
    installDefaultHouseId: 'default-house',
  });
  const database = createDatabaseMock({
    houses: [
      { id: 'default-house', name: 'My Home' },
      { id: 'remote-house', name: 'Remote House' },
    ],
  });

  const settingsMetadata = loadWithMocks(settingsMetadataPath, {
    '@react-native-async-storage/async-storage': AsyncStorage,
    '@/utils/storage/database': { database },
    '@/utils/auth/session': {
      safeGetSession: async () => ({ access_token: 'token' }),
    },
  });

  const autoSyncedHouseIds = await settingsMetadata.loadSyncedHouseIds();
  assert.deepEqual(autoSyncedHouseIds, []);

  await settingsMetadata.ensureHouseSyncEnabled('default-house');
  const syncedHouseIds = await settingsMetadata.loadSyncedHouseIds();
  assert.deepEqual(syncedHouseIds, ['default-house']);
  assert.equal(await AsyncStorage.getItem('installDefaultHouseId'), null);
});

test('settings metadata refuses to enable sync while signed out', async () => {
  const AsyncStorage = createAsyncStorageMock();
  const database = createDatabaseMock({
    houses: [{ id: 'local-house', name: 'Local House' }],
  });

  const settingsMetadata = loadWithMocks(settingsMetadataPath, {
    '@react-native-async-storage/async-storage': AsyncStorage,
    '@/utils/storage/database': { database },
    '@/utils/auth/session': {
      safeGetSession: async () => null,
    },
  });

  await assert.rejects(
    () => settingsMetadata.setHouseSyncEnabled('local-house', true),
    /Sign in to enable sync/
  );
  assert.deepEqual(await settingsMetadata.loadSyncedHouseIds(), []);
});

test('settings metadata refuses global sync enable while signed out', async () => {
  const AsyncStorage = createAsyncStorageMock();
  const database = createDatabaseMock({
    houses: [{ id: 'local-house', name: 'Local House' }],
  });

  const settingsMetadata = loadWithMocks(settingsMetadataPath, {
    '@react-native-async-storage/async-storage': AsyncStorage,
    '@/utils/storage/database': { database },
    '@/utils/auth/session': {
      safeGetSession: async () => null,
    },
  });

  await assert.rejects(
    () => settingsMetadata.saveSyncEnabled(true),
    /Sign in to enable sync/
  );
  assert.deepEqual(await settingsMetadata.loadSyncedHouseIds(), []);
});

test('settings metadata persists manual sync toggles across reloads', async () => {
  const AsyncStorage = createAsyncStorageMock();
  const database = createDatabaseMock({
    houses: [
      { id: 'house-a', name: 'House A' },
      { id: 'house-b', name: 'House B' },
    ],
  });

  let settingsMetadata = loadWithMocks(settingsMetadataPath, {
    '@react-native-async-storage/async-storage': AsyncStorage,
    '@/utils/storage/database': { database },
    '@/utils/auth/session': {
      safeGetSession: async () => ({ access_token: 'token' }),
    },
  });

  await settingsMetadata.setHouseSyncEnabled('house-a', true);
  await settingsMetadata.setHouseSyncEnabled('house-b', false);

  settingsMetadata = loadWithMocks(settingsMetadataPath, {
    '@react-native-async-storage/async-storage': AsyncStorage,
    '@/utils/storage/database': { database },
    '@/utils/auth/session': {
      safeGetSession: async () => ({ access_token: 'token' }),
    },
  });

  const syncedHouseIds = await settingsMetadata.loadSyncedHouseIds();
  const disabledHouseIds = await settingsMetadata.loadSyncDisabledHouseIds();

  assert.deepEqual(syncedHouseIds, ['house-a']);
  assert.deepEqual(disabledHouseIds, ['house-b']);
});
