import AsyncStorage from '@react-native-async-storage/async-storage';

// Legacy custom-sync cleanup only.
//
// FOSS does not run remote inventory sync. These helpers remove or prune
// AsyncStorage keys left by older builds so public installs do not carry stale
// queue/tombstone state forward.

export type InventoryTable =
  | 'houses'
  | 'rooms'
  | 'containers'
  | 'boxes'
  | 'items'
  | 'item_images';

type LegacyQueueItem = {
  table?: InventoryTable;
  houseId?: string;
};

const QUEUE_KEY = 'inventorySyncQueue';
const LAST_SYNC_HOUSE_IDS_KEY = 'inventoryLastSyncHouseIds';
const IMAGE_DELETE_TOMBSTONES_KEY = 'inventoryImageDeleteTombstones';
const MEDIA_OPS_KEY = 'inventoryMediaOps';
const PERMISSION_REJECTIONS_KEY = 'inventoryPermissionRejections';
const PENDING_REMOTE_IMAGE_DOWNLOADS_KEY = 'inventoryPendingRemoteImageDownloads';
const FIRST_RECONCILE_DONE_PREFIX = 'inventoryFirstReconcileDone:v2:';

const LEGACY_SYNC_KEYS = [
  QUEUE_KEY,
  LAST_SYNC_HOUSE_IDS_KEY,
  IMAGE_DELETE_TOMBSTONES_KEY,
  MEDIA_OPS_KEY,
  PERMISSION_REJECTIONS_KEY,
  PENDING_REMOTE_IMAGE_DOWNLOADS_KEY,
];

const cleanupLegacySyncState = async () => {
  await AsyncStorage.multiRemove(LEGACY_SYNC_KEYS);
};

const loadLegacyQueue = async (): Promise<LegacyQueueItem[]> => {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const saveLegacyQueue = async (queue: LegacyQueueItem[]) => {
  if (!queue.length) {
    await AsyncStorage.removeItem(QUEUE_KEY);
    return;
  }
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
};

export const pruneQueueForDisabledHouses = async (enabledHouseIds: string[]) => {
  const enabled = new Set(enabledHouseIds);
  const queue = await loadLegacyQueue();
  await saveLegacyQueue(queue.filter((item) => item.houseId && enabled.has(item.houseId)));
};

export const pruneQueuedChangesForHouse = async (houseId: string) => {
  if (!houseId) return;
  const queue = await loadLegacyQueue();
  await saveLegacyQueue(queue.filter((item) => item.houseId !== houseId));
};

export const clearLegacyInventorySyncState = cleanupLegacySyncState;

export const clearLegacyFirstReconcileMarker = async (userId: string) => {
  if (!userId) return;
  await AsyncStorage.removeItem(`${FIRST_RECONCILE_DONE_PREFIX}${userId}`);
};
