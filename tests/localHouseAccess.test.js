const test = require('node:test');
const assert = require('node:assert/strict');

const { isLocallyEditableUnsyncedHouse } = require('../utils/collaboration/localHouseAccess.ts');

test('local unsynced house is editable for the signed-in user even without ownerId', () => {
  const result = isLocallyEditableUnsyncedHouse({
    houses: [{ id: 'house-a', ownerId: null }],
    houseId: 'house-a',
    houseSyncEnabled: false,
    userId: 'user-1',
  });

  assert.equal(result, true);
});

test('remote or synced houses do not get local-unsynced edit access automatically', () => {
  assert.equal(
    isLocallyEditableUnsyncedHouse({
      houses: [{ id: 'house-a', ownerId: null }],
      houseId: 'house-a',
      houseSyncEnabled: true,
      userId: 'user-1',
    }),
    false
  );

  assert.equal(
    isLocallyEditableUnsyncedHouse({
      houses: [{ id: 'house-b', ownerId: 'user-2' }],
      houseId: 'house-b',
      houseSyncEnabled: false,
      userId: 'user-1',
    }),
    false
  );
});
