const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

/* global __dirname */

const { loadWithMocks } = require('./helpers/moduleMocks');
const { createAsyncStorageMock } = require('./helpers/createAsyncStorageMock');

const coordinatorPath = path.resolve(__dirname, '../utils/sync/houseSyncCoordinator.ts');

test('enableHouseSyncForUser prepares the house before connecting PowerSync when reads are disabled', async () => {
  const calls = [];
  const coordinator = loadWithMocks(coordinatorPath, {
    '@react-native-async-storage/async-storage': createAsyncStorageMock(),
    '@/utils/storage/database': { database: {} },
    '@/utils/sync/settingsMetadata': {
      loadSyncDisabledHouseIds: async () => [],
      loadSyncedHouseIds: async () => [],
      reconcileAutoSyncedHouseIds: async () => {},
    },
    '@/utils/sync/bootstrapState': {
      computeBootstrapSyncState: () => {
        throw new Error('bootstrap should not run in this test');
      },
    },
    '@/utils/sync/inventoryBootstrapState': {
      setInventoryBootstrapInProgress: () => {},
    },
    '@/utils/sync/prepareHouseForSyncEnable': {
      prepareHouseForSyncEnable: async (houseId, userId) => {
        calls.push({ type: 'prepare', houseId, userId });
      },
    },
    '@/utils/powersync/readMode': {
      loadPowerSyncReadModeEnabled: async () => false,
    },
    '@/utils/powersync/firstSync': {
      uploadPowerSyncHouseForFirstSync: async () => {
        throw new Error('PowerSync first sync should not run in this test');
      },
    },
    '@/utils/powersync/connectionLifecycle': {
      syncPowerSyncConnectionForSession: async (signedIn) => {
        calls.push({ type: 'powersync-connect', signedIn });
      },
    },
  });

  await coordinator.enableHouseSyncForUser('house-a', 'user-1');

  assert.deepEqual(calls, [
    { type: 'prepare', houseId: 'house-a', userId: 'user-1' },
    { type: 'powersync-connect', signedIn: true },
  ]);
});

test('enableHouseSyncForUser uses PowerSync first upload when PowerSync reads are enabled', async () => {
  const calls = [];
  const coordinator = loadWithMocks(coordinatorPath, {
    '@react-native-async-storage/async-storage': createAsyncStorageMock(),
    '@/utils/storage/database': { database: {} },
    '@/utils/sync/settingsMetadata': {
      loadSyncDisabledHouseIds: async () => [],
      loadSyncedHouseIds: async () => [],
      reconcileAutoSyncedHouseIds: async () => {},
    },
    '@/utils/sync/bootstrapState': {
      computeBootstrapSyncState: () => {
        throw new Error('bootstrap should not run in this test');
      },
    },
    '@/utils/sync/inventoryBootstrapState': {
      setInventoryBootstrapInProgress: () => {},
    },
    '@/utils/sync/prepareHouseForSyncEnable': {
      prepareHouseForSyncEnable: async () => {
        throw new Error('legacy prepare should not run in this test');
      },
    },
    '@/utils/powersync/readMode': {
      loadPowerSyncReadModeEnabled: async () => true,
    },
    '@/utils/powersync/firstSync': {
      uploadPowerSyncHouseForFirstSync: async (houseId, userId) => {
        calls.push({ type: 'powersync-upload', houseId, userId });
      },
    },
    '@/utils/powersync/connectionLifecycle': {
      syncPowerSyncConnectionForSession: async () => {
        throw new Error('PowerSync connection should not run in this test');
      },
    },
  });

  await coordinator.enableHouseSyncForUser('house-a', 'user-1');

  assert.deepEqual(calls, [{ type: 'powersync-upload', houseId: 'house-a', userId: 'user-1' }]);
});

test('bootstrapRemoteInventoryForUser reconciles discovered houses and connects PowerSync', async () => {
  const connectCalls = [];
  const bootstrapVisibility = [];
  const reconciled = [];
  const AsyncStorage = createAsyncStorageMock({
    installDefaultHouseId: 'local-default',
  });

  const coordinator = loadWithMocks(coordinatorPath, {
    '@react-native-async-storage/async-storage': AsyncStorage,
    '@/utils/storage/database': {
      database: {
        collections: {
          get() {
            return {
              query() {
                return {
                  async fetch() {
                    return [{ id: 'remote-house' }];
                  },
                };
              },
            };
          },
        },
      },
    },
    '@/utils/sync/settingsMetadata': {
      loadSyncDisabledHouseIds: async () => [],
      loadSyncedHouseIds: async () => [],
      reconcileAutoSyncedHouseIds: async (ids) => {
        reconciled.push(ids);
      },
    },
    '@/utils/sync/bootstrapState': {
      computeBootstrapSyncState: ({ visibleHouseIds }) => ({
        nonDefaultHouseIds: visibleHouseIds,
        storedNonDefaultHouseIds: [],
        missingVisibleNonDefaultHouseIds: visibleHouseIds,
        discoveredHouseIds: visibleHouseIds,
        onlyDefaultHouseVisible: false,
        onlyBootstrapHouseEnabled: false,
        shouldShowBootstrapDialog: true,
        shouldRunBootstrap: true,
      }),
    },
    '@/utils/sync/inventoryBootstrapState': {
      setInventoryBootstrapInProgress: (visible) => {
        bootstrapVisibility.push(visible);
      },
    },
    '@/utils/sync/prepareHouseForSyncEnable': {
      prepareHouseForSyncEnable: async () => {},
    },
    '@/utils/powersync/readMode': {
      loadPowerSyncReadModeEnabled: async () => false,
    },
    '@/utils/powersync/firstSync': {
      uploadPowerSyncHouseForFirstSync: async () => {
        throw new Error('PowerSync first sync should not run in this test');
      },
    },
    '@/utils/powersync/connectionLifecycle': {
      syncPowerSyncConnectionForSession: async (signedIn) => {
        connectCalls.push({ signedIn });
      },
    },
  });

  const result = await coordinator.bootstrapRemoteInventoryForUser('user-1', {
    onBootstrapVisibilityChange: (visible) => bootstrapVisibility.push(`ui:${visible}`),
  });

  assert.deepEqual(connectCalls, [{ signedIn: true }, { signedIn: true }]);
  assert.deepEqual(reconciled, [['remote-house']]);
  assert.deepEqual(bootstrapVisibility, [true, 'ui:true', false, 'ui:false']);
  assert.deepEqual(result.finalHouseIds, ['remote-house']);
});

test('PowerSync bootstrap connects instead of running legacy custom inventory sync', async () => {
  const calls = [];
  const coordinator = loadWithMocks(coordinatorPath, {
    '@react-native-async-storage/async-storage': createAsyncStorageMock(),
    '@/utils/storage/database': { database: {} },
    '@/utils/sync/settingsMetadata': {
      loadSyncDisabledHouseIds: async () => [],
      loadSyncedHouseIds: async () => ['house-a'],
      reconcileAutoSyncedHouseIds: async () => {},
    },
    '@/utils/sync/bootstrapState': {
      computeBootstrapSyncState: () => {
        throw new Error('legacy bootstrap should not run in this test');
      },
    },
    '@/utils/sync/inventoryBootstrapState': {
      setInventoryBootstrapInProgress: () => {},
    },
    '@/utils/sync/prepareHouseForSyncEnable': {
      prepareHouseForSyncEnable: async () => {
        throw new Error('legacy prepare should not run in this test');
      },
    },
    '@/utils/powersync/readMode': {
      loadPowerSyncReadModeEnabled: async () => true,
    },
    '@/utils/powersync/firstSync': {
      uploadPowerSyncHouseForFirstSync: async () => {
        throw new Error('first sync should not run in this test');
      },
    },
    '@/utils/powersync/connectionLifecycle': {
      syncPowerSyncConnectionForSession: async (signedIn) => {
        calls.push({ type: 'powersync-connect', signedIn });
      },
    },
  });

  const result = await coordinator.bootstrapRemoteInventoryForUser('user-1');

  assert.deepEqual(calls, [{ type: 'powersync-connect', signedIn: true }]);
  assert.deepEqual(result, {
    initialHouseIds: ['house-a'],
    finalHouseIds: ['house-a'],
    bootstrapState: null,
  });
});
