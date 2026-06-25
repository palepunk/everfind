const test = require('node:test');
const assert = require('node:assert/strict');

const { getHouseSyncState } = require('../utils/sync/houseSyncState.ts');

test('local unsynced house with no owner is locally editable for signed-in user', () => {
  const state = getHouseSyncState({
    houses: [{ id: 'house-a', ownerId: null }],
    houseId: 'house-a',
    houseSyncEnabled: false,
    userId: 'user-1',
  });

  assert.equal(state.lifecycleState, 'local_only');
  assert.equal(state.isEditableLocally, true);
  assert.equal(state.shouldUseBackendPermissions, false);
  assert.equal(state.canEnableSync, true);
  assert.equal(state.canDisableSync, false);
});

test('synced houses use backend permissions', () => {
  const state = getHouseSyncState({
    houses: [{ id: 'house-a', ownerId: 'user-1' }],
    houseId: 'house-a',
    houseSyncEnabled: true,
    userId: 'user-1',
  });

  assert.equal(state.lifecycleState, 'synced');
  assert.equal(state.isEditableLocally, false);
  assert.equal(state.shouldUseBackendPermissions, true);
  assert.equal(state.canEnableSync, false);
  assert.equal(state.canDisableSync, true);
});

test('missing local house is treated as remote-only-discovered', () => {
  const state = getHouseSyncState({
    houses: [],
    houseId: 'house-z',
    houseSyncEnabled: false,
    userId: 'user-1',
  });

  assert.equal(state.lifecycleState, 'remote_only_discovered');
  assert.equal(state.isEditableLocally, false);
});

test('enabled local house with no owner is treated as sync-enable-pending', () => {
  const state = getHouseSyncState({
    houses: [{ id: 'house-a', ownerId: null }],
    houseId: 'house-a',
    houseSyncEnabled: true,
    userId: 'user-1',
  });

  assert.equal(state.lifecycleState, 'sync_enable_pending');
  assert.equal(state.shouldParticipateInSync, true);
  assert.equal(state.shouldUseBackendPermissions, true);
});

test('enabled house missing locally during bootstrap is treated as sync-bootstrap-pending', () => {
  const state = getHouseSyncState({
    houses: [],
    houseId: 'house-a',
    houseSyncEnabled: true,
    userId: 'user-1',
    isBootstrapInProgress: true,
  });

  assert.equal(state.lifecycleState, 'sync_bootstrap_pending');
  assert.equal(state.shouldHideMissingRecordAlerts, true);
});

test('account deletion state suppresses missing-record alerts', () => {
  const state = getHouseSyncState({
    houses: [{ id: 'house-a', ownerId: 'user-1' }],
    houseId: 'house-a',
    houseSyncEnabled: true,
    userId: 'user-1',
    isDeletingAccountInProgress: true,
  });

  assert.equal(state.lifecycleState, 'deleting_account_pending_cleanup');
  assert.equal(state.shouldHideMissingRecordAlerts, true);
});
