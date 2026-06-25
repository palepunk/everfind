const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadWithMocks } = require('./helpers/moduleMocks');
const { createDatabaseMock } = require('./helpers/createDatabaseMock');

const prepareHouseForSyncEnablePath = path.resolve(
  __dirname,
  '../utils/sync/prepareHouseForSyncEnable.ts'
);

test('prepareHouseForSyncEnable assigns owner without using legacy upload queue', async () => {
  const database = createDatabaseMock({
    houses: [{ id: 'house-a', name: 'My Home', ownerId: null }],
  });

  const mod = loadWithMocks(prepareHouseForSyncEnablePath, {
    '@/utils/storage/database': { database },
  });

  const house = await mod.prepareHouseForSyncEnable('house-a', 'user-1');

  assert.equal(house.ownerId, 'user-1');
  assert.equal(database.__stores.houses.get('house-a').ownerId, 'user-1');
});

test('prepareHouseForSyncEnable preserves an existing owner id', async () => {
  const database = createDatabaseMock({
    houses: [{ id: 'house-b', name: 'Shared Home', ownerId: 'owner-2' }],
  });

  const mod = loadWithMocks(prepareHouseForSyncEnablePath, {
    '@/utils/storage/database': { database },
  });

  const house = await mod.prepareHouseForSyncEnable('house-b', 'user-1');

  assert.equal(house.ownerId, 'owner-2');
});
