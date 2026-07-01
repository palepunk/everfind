import { database } from './storage/database';
import { Box, Container, House, Item, Room } from './storage/models';
import { getItemImageCount } from './itemImages';
import { loadPowerSyncReadModeEnabled } from './powersync/readMode';
import {
  getPowerSyncRepositoryBoxes,
  getPowerSyncRepositoryContainers,
  getPowerSyncRepositoryHouses,
  getPowerSyncRepositoryItems,
  getPowerSyncRepositoryRooms,
} from './powersync/repository';
import { getFallbackPlanLimitInfo, loadRemotePlanLimitData } from './edition/planLimits';

export const UNLIMITED_LIMIT = Number.POSITIVE_INFINITY;
export const HOUSE_LIMIT = UNLIMITED_LIMIT;
export const STORAGE_UNIT_LIMIT = UNLIMITED_LIMIT;
export const ITEM_LIMIT = UNLIMITED_LIMIT;
export const ITEM_PICTURES_PER_ITEM_LIMIT = UNLIMITED_LIMIT;

export const HOUSE_LIMIT_ERROR = 'HOUSE_LIMIT_REACHED';
export const STORAGE_UNIT_LIMIT_ERROR = 'STORAGE_UNIT_LIMIT_REACHED';
export const ITEM_LIMIT_ERROR = 'ITEM_LIMIT_REACHED';
export const ITEM_PICTURE_LIMIT_ERROR = 'ITEM_PICTURE_LIMIT_REACHED';

export type LimitCounts = {
  houses: number;
  storageUnits: number;
  items: number;
};

export type LimitValues = {
  houses: number;
  storageUnits: number;
  items: number;
  itemPicturesPerItem: number;
};

export type PlanLimitSnapshot = {
  planId: string;
  limits: LimitValues;
  usage: LimitCounts;
};

const DEFAULT_LIMITS: LimitValues = {
  houses: HOUSE_LIMIT,
  storageUnits: STORAGE_UNIT_LIMIT,
  items: ITEM_LIMIT,
  itemPicturesPerItem: ITEM_PICTURES_PER_ITEM_LIMIT,
};

const toPositiveInt = (value: unknown, fallback: number) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
};

const toLimitValues = (value: any): LimitValues => ({
  houses: toPositiveInt(value?.houses, DEFAULT_LIMITS.houses),
  storageUnits: toPositiveInt(value?.storage_units, DEFAULT_LIMITS.storageUnits),
  items: toPositiveInt(value?.items, DEFAULT_LIMITS.items),
  itemPicturesPerItem: toPositiveInt(
    value?.item_pictures_per_item,
    DEFAULT_LIMITS.itemPicturesPerItem
  ),
});

const toUsageValues = (value: any): LimitCounts => ({
  houses: toPositiveInt(value?.houses, 0),
  storageUnits: toPositiveInt(value?.storage_units, 0),
  items: toPositiveInt(value?.items, 0),
});

const getLocalLimitCounts = async (): Promise<LimitCounts> => {
  if (await loadPowerSyncReadModeEnabled()) {
    const [houses, rooms, containers, boxes, items] = await Promise.all([
      getPowerSyncRepositoryHouses(),
      getPowerSyncRepositoryRooms(),
      getPowerSyncRepositoryContainers(),
      getPowerSyncRepositoryBoxes(),
      getPowerSyncRepositoryItems(),
    ]);

    return {
      houses: houses.length,
      storageUnits: rooms.length + containers.length + boxes.length,
      items: items.length,
    };
  }

  const [houses, rooms, containers, boxes, items] = await Promise.all([
    database.collections.get<House>('houses').query().fetch(),
    database.collections.get<Room>('rooms').query().fetch(),
    database.collections.get<Container>('containers').query().fetch(),
    database.collections.get<Box>('boxes').query().fetch(),
    database.collections.get<Item>('items').query().fetch(),
  ]);

  return {
    houses: houses.length,
    storageUnits: rooms.length + containers.length + boxes.length,
    items: items.length,
  };
};

export async function getPlanLimitSnapshot(): Promise<PlanLimitSnapshot> {
  const data = (await loadRemotePlanLimitData()) as any;

  if (!data) {
    const fallback = getFallbackPlanLimitInfo(DEFAULT_LIMITS);
    return {
      planId: fallback.planId,
      limits: fallback.limits,
      usage: await getLocalLimitCounts(),
    };
  }

  return {
    planId: typeof data?.plan_id === 'string' ? data.plan_id : 'free',
    limits: toLimitValues(data?.limits),
    usage: toUsageValues(data?.usage),
  };
}

export async function getLimitCounts(): Promise<LimitCounts> {
  const snapshot = await getPlanLimitSnapshot();
  return snapshot.usage;
}

export async function getPlanLimits(): Promise<LimitValues> {
  const snapshot = await getPlanLimitSnapshot();
  return snapshot.limits;
}

export async function assertCanAddHouse() {
  const snapshot = await getPlanLimitSnapshot();
  if (snapshot.usage.houses >= snapshot.limits.houses) {
    throw new Error(HOUSE_LIMIT_ERROR);
  }
}

export async function assertCanAddStorageUnit() {
  const snapshot = await getPlanLimitSnapshot();
  if (snapshot.usage.storageUnits >= snapshot.limits.storageUnits) {
    throw new Error(STORAGE_UNIT_LIMIT_ERROR);
  }
}

export async function assertCanAddItem() {
  const snapshot = await getPlanLimitSnapshot();
  if (snapshot.usage.items >= snapshot.limits.items) {
    throw new Error(ITEM_LIMIT_ERROR);
  }
}

export async function assertCanAddItemPicture(itemId: string, nextPictureCount?: number) {
  const snapshot = await getPlanLimitSnapshot();
  const currentCount =
    typeof nextPictureCount === 'number' ? nextPictureCount : await getItemImageCount(itemId);
  if (currentCount >= snapshot.limits.itemPicturesPerItem) {
    throw new Error(ITEM_PICTURE_LIMIT_ERROR);
  }
}

export async function assertCanSetItemPictureCount(nextPictureCount: number) {
  const snapshot = await getPlanLimitSnapshot();
  if (nextPictureCount > snapshot.limits.itemPicturesPerItem) {
    throw new Error(ITEM_PICTURE_LIMIT_ERROR);
  }
}

export function isAtAnyLimit(counts: LimitCounts, limits: LimitValues = DEFAULT_LIMITS) {
  return (
    (isFiniteLimit(limits.houses) && counts.houses >= limits.houses) ||
    (isFiniteLimit(limits.storageUnits) && counts.storageUnits >= limits.storageUnits) ||
    (isFiniteLimit(limits.items) && counts.items >= limits.items)
  );
}

export function isOverAnyLimit(counts: LimitCounts, limits: LimitValues = DEFAULT_LIMITS) {
  return (
    (isFiniteLimit(limits.houses) && counts.houses > limits.houses) ||
    (isFiniteLimit(limits.storageUnits) && counts.storageUnits > limits.storageUnits) ||
    (isFiniteLimit(limits.items) && counts.items > limits.items)
  );
}

export function isFiniteLimit(value: number) {
  return Number.isFinite(value);
}

export function formatLimitValue(value: number) {
  return isFiniteLimit(value) ? String(value) : 'Unlimited';
}

export function formatUsageLimit(count: number, limit: number) {
  return `${count} / ${formatLimitValue(limit)}`;
}

export function getLimitErrorMessage(errorCode: string, limits: LimitValues = DEFAULT_LIMITS) {
  if (errorCode === HOUSE_LIMIT_ERROR) {
    if (!isFiniteLimit(limits.houses)) return null;
    return `This plan supports up to ${limits.houses} houses.`;
  }
  if (errorCode === STORAGE_UNIT_LIMIT_ERROR) {
    if (!isFiniteLimit(limits.storageUnits)) return null;
    return `This plan supports up to ${limits.storageUnits} storage units (rooms, containers, boxes).`;
  }
  if (errorCode === ITEM_LIMIT_ERROR) {
    if (!isFiniteLimit(limits.items)) return null;
    return `This plan supports up to ${limits.items} items.`;
  }
  if (errorCode === ITEM_PICTURE_LIMIT_ERROR) {
    if (!isFiniteLimit(limits.itemPicturesPerItem)) return null;
    return `This plan supports up to ${limits.itemPicturesPerItem} pictures per item. Existing pictures stay available, but you cannot add more until the item is back within the limit.`;
  }
  return null;
}
