/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadWithMocks } = require('./helpers/moduleMocks');

const exportableHousesPath = path.resolve(__dirname, '../utils/export/exportableHouses.ts');

test('PowerSync local houses are exportable even when signed in', async () => {
  const { getExportableHouses } = loadWithMocks(exportableHousesPath, {
    '../collaboration/houseSharing': {
      getHouseCollaboration: async () => ({
        my_role: 'viewer',
        permissions: { can_admin: false },
      }),
    },
    '../powersync/repository': {
      getPowerSyncRepositoryHouses: async () => [
        {
          source: 'local',
          id: 'local-house',
          name: 'Local House',
          owner_id: 'someone-else',
        },
        {
          source: 'synced',
          id: 'synced-house',
          name: 'Synced House',
          owner_id: 'someone-else',
        },
      ],
    },
  });

  const houses = await getExportableHouses('signed-in-user');

  assert.deepEqual(houses, [{ id: 'local-house', name: 'Local House', access: 'local' }]);
});
