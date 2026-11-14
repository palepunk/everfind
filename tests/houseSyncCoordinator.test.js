const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

/* global __dirname */

const { loadWithMocks } = require('./helpers/moduleMocks');

const coordinatorPath = path.resolve(__dirname, '../utils/sync/houseSyncCoordinator.ts');

const loadCoordinator = ({ syncedHouseIds = [], calls }) =>
  loadWithMocks(coordinatorPath, {
    '@/utils/sync/settingsMetadata': {
      loadSyncedHouseIds: async () => syncedHouseIds,
    },
    '@/utils/sync/bootstrapState': {},
    '@/utils/powersync/firstSync': {
      uploadPowerSyncHouseForFirstSync: async (houseId, userId) => {
        calls.push({ type: 'powersync-upload', houseId, userId });
      },
    },
    '@/utils/powersync/connectionLifecycle': {
      syncPowerSyncConnectionForSession: async (signedIn) => {
        calls.push({ type: 'powersync-connect', signedIn });
      },
    },
  });

test('enableHouseSyncForUser runs the PowerSync first upload', async () => {
  const calls = [];
  const coordinator = loadCoordinator({ calls });

  await coordinator.enableHouseSyncForUser('house-a', 'user-1');

  assert.deepEqual(calls, [{ type: 'powersync-upload', houseId: 'house-a', userId: 'user-1' }]);
});

test('syncEnabledInventoryForUser connects PowerSync and returns the synced houses', async () => {
  const calls = [];
  const coordinator = loadCoordinator({ syncedHouseIds: ['house-a'], calls });

  const houseIds = await coordinator.syncEnabledInventoryForUser('user-1');

  assert.deepEqual(calls, [{ type: 'powersync-connect', signedIn: true }]);
  assert.deepEqual(houseIds, ['house-a']);
});

test('bootstrapRemoteInventoryForUser connects PowerSync without a bootstrap state', async () => {
  const calls = [];
  const coordinator = loadCoordinator({ syncedHouseIds: ['house-a'], calls });

  const result = await coordinator.bootstrapRemoteInventoryForUser('user-1');

  assert.deepEqual(calls, [{ type: 'powersync-connect', signedIn: true }]);
  assert.deepEqual(result, {
    initialHouseIds: ['house-a'],
    finalHouseIds: ['house-a'],
    bootstrapState: null,
  });
});
