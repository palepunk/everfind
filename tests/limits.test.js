const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadWithMocks } = require('./helpers/moduleMocks');
const { createDatabaseMock } = require('./helpers/createDatabaseMock');

const limitsPath = path.resolve(__dirname, '../utils/limits.ts');

const loadLimitsWithLocalData = (initialData) =>
  loadWithMocks(limitsPath, {
    './storage/database': { database: createDatabaseMock(initialData) },
    './storage/models': {},
    './itemImages': {
      getItemImageCount: async () => 999,
    },
    './powersync/readMode': {
      loadPowerSyncReadModeEnabled: async () => false,
    },
    './powersync/repository': {
      getPowerSyncRepositoryBoxes: async () => [],
      getPowerSyncRepositoryContainers: async () => [],
      getPowerSyncRepositoryHouses: async () => [],
      getPowerSyncRepositoryItems: async () => [],
      getPowerSyncRepositoryRooms: async () => [],
    },
    './edition/planLimits': {
      loadRemotePlanLimitData: async () => null,
    },
  });

test('FOSS plan limits are unlimited when no remote plan data exists', async () => {
  const limits = loadLimitsWithLocalData({
    houses: [
      { id: 'house-1' },
      { id: 'house-2' },
      { id: 'house-3' },
    ],
    rooms: [{ id: 'room-1' }],
    containers: [{ id: 'container-1' }],
    boxes: [{ id: 'box-1' }],
    items: Array.from({ length: 500 }, (_, index) => ({ id: `item-${index}` })),
  });

  const snapshot = await limits.getPlanLimitSnapshot();

  assert.equal(snapshot.planId, 'foss');
  assert.equal(snapshot.limits.houses, Number.POSITIVE_INFINITY);
  assert.equal(snapshot.limits.storageUnits, Number.POSITIVE_INFINITY);
  assert.equal(snapshot.limits.items, Number.POSITIVE_INFINITY);
  assert.equal(snapshot.limits.itemPicturesPerItem, Number.POSITIVE_INFINITY);
  assert.equal(limits.isAtAnyLimit(snapshot.usage, snapshot.limits), false);
  assert.equal(limits.isOverAnyLimit(snapshot.usage, snapshot.limits), false);
  assert.equal(limits.formatLimitValue(snapshot.limits.items), 'Unlimited');
  assert.equal(limits.formatUsageLimit(snapshot.usage.items, snapshot.limits.items), '500 / Unlimited');

  await assert.doesNotReject(() => limits.assertCanAddHouse());
  await assert.doesNotReject(() => limits.assertCanAddStorageUnit());
  await assert.doesNotReject(() => limits.assertCanAddItem());
  await assert.doesNotReject(() => limits.assertCanAddItemPicture('item-1'));
  await assert.doesNotReject(() => limits.assertCanSetItemPictureCount(1000));
  assert.equal(limits.getLimitErrorMessage(limits.ITEM_LIMIT_ERROR, snapshot.limits), null);
});

test('finite remote plan limits still block cloud-only caps', async () => {
  const limits = loadWithMocks(limitsPath, {
    './storage/database': { database: createDatabaseMock() },
    './storage/models': {},
    './itemImages': {
      getItemImageCount: async () => 1,
    },
    './powersync/readMode': {
      loadPowerSyncReadModeEnabled: async () => false,
    },
    './powersync/repository': {
      getPowerSyncRepositoryBoxes: async () => [],
      getPowerSyncRepositoryContainers: async () => [],
      getPowerSyncRepositoryHouses: async () => [],
      getPowerSyncRepositoryItems: async () => [],
      getPowerSyncRepositoryRooms: async () => [],
    },
    './edition/planLimits': {
      loadRemotePlanLimitData: async () => ({
        plan_id: 'free',
        limits: {
          houses: 1,
          storage_units: 2,
          items: 3,
          item_pictures_per_item: 1,
        },
        usage: {
          houses: 1,
          storage_units: 2,
          items: 3,
        },
      }),
    },
  });

  const snapshot = await limits.getPlanLimitSnapshot();

  assert.equal(snapshot.planId, 'free');
  assert.equal(limits.isAtAnyLimit(snapshot.usage, snapshot.limits), true);
  await assert.rejects(() => limits.assertCanAddHouse(), /HOUSE_LIMIT_REACHED/);
  await assert.rejects(() => limits.assertCanAddStorageUnit(), /STORAGE_UNIT_LIMIT_REACHED/);
  await assert.rejects(() => limits.assertCanAddItem(), /ITEM_LIMIT_REACHED/);
  await assert.rejects(() => limits.assertCanAddItemPicture('item-1'), /ITEM_PICTURE_LIMIT_REACHED/);
});
