const test = require('node:test');
const assert = require('node:assert/strict');

const { computeBootstrapSyncState } = require('../utils/sync/bootstrapState.ts');

test('bootstrap state excludes disabled local-only houses from auto discovery', () => {
  const result = computeBootstrapSyncState({
    visibleHouseIds: ['remote-house', 'local-house'],
    storedSyncedHouseIds: ['remote-house'],
    disabledHouseIds: ['local-house'],
    installDefaultHouseId: null,
  });

  assert.deepEqual(result.discoveredHouseIds, ['remote-house']);
  assert.deepEqual(result.missingVisibleNonDefaultHouseIds, []);
  assert.equal(result.shouldRunBootstrap, false);
});

test('bootstrap state discovers newly visible remote houses without overwriting stored synced houses', () => {
  const result = computeBootstrapSyncState({
    visibleHouseIds: ['remote-a', 'remote-b'],
    storedSyncedHouseIds: ['remote-a'],
    disabledHouseIds: [],
    installDefaultHouseId: 'default-house',
  });

  assert.deepEqual(result.discoveredHouseIds, ['remote-a', 'remote-b']);
  assert.deepEqual(result.missingVisibleNonDefaultHouseIds, ['remote-b']);
  assert.equal(result.shouldRunBootstrap, true);
  assert.equal(result.shouldShowBootstrapDialog, false);
});

test('bootstrap state discovers a remote house when only the local default house existed before sign-in', () => {
  const result = computeBootstrapSyncState({
    visibleHouseIds: ['default-house', 'remote-house'],
    storedSyncedHouseIds: [],
    disabledHouseIds: [],
    installDefaultHouseId: 'default-house',
  });

  assert.deepEqual(result.nonDefaultHouseIds, ['remote-house']);
  assert.deepEqual(result.discoveredHouseIds, ['remote-house']);
  assert.equal(result.shouldRunBootstrap, true);
  assert.equal(result.shouldShowBootstrapDialog, true);
});
