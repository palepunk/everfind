import AsyncStorage from '@react-native-async-storage/async-storage';

export const POWERSYNC_LOCAL_DATA_MIGRATION_KEY = 'powersyncLocalDataMigration:v2';
export const POWERSYNC_HOUSE_SYNC_STATE_KEY = 'powersyncHouseSyncStateByHouseId:v1';

export type PowerSyncMigrationState = 'pending' | 'running' | 'completed' | 'failed';

export type PowerSyncLocalDataMigrationStatus = {
  state: PowerSyncMigrationState;
  startedAt?: number;
  completedAt?: number;
  failedAt?: number;
  error?: string;
  rowCounts?: Record<string, number>;
};

export type PowerSyncHouseSyncState =
  | 'local_only'
  | 'sync_enable_pending'
  | 'synced'
  | 'sync_error';

export type PowerSyncHouseSyncStateMap = Record<string, PowerSyncHouseSyncState>;

type KeyValueStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export const defaultPowerSyncStorage: KeyValueStorage = AsyncStorage;

const parseJson = <T>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export const loadPowerSyncLocalDataMigrationStatus = async (
  storage: KeyValueStorage = defaultPowerSyncStorage
): Promise<PowerSyncLocalDataMigrationStatus | null> => {
  return parseJson<PowerSyncLocalDataMigrationStatus | null>(
    await storage.getItem(POWERSYNC_LOCAL_DATA_MIGRATION_KEY),
    null
  );
};

export const savePowerSyncLocalDataMigrationStatus = async (
  status: PowerSyncLocalDataMigrationStatus,
  storage: KeyValueStorage = defaultPowerSyncStorage
) => {
  await storage.setItem(POWERSYNC_LOCAL_DATA_MIGRATION_KEY, JSON.stringify(status));
};

export const clearPowerSyncLocalDataMigrationStatus = async (
  storage: KeyValueStorage = defaultPowerSyncStorage
) => {
  await storage.removeItem(POWERSYNC_LOCAL_DATA_MIGRATION_KEY);
};

export const loadPowerSyncHouseSyncStates = async (
  storage: KeyValueStorage = defaultPowerSyncStorage
): Promise<PowerSyncHouseSyncStateMap> => {
  const raw = await storage.getItem(POWERSYNC_HOUSE_SYNC_STATE_KEY);
  const parsed = parseJson<Record<string, unknown>>(raw, {});
  return Object.fromEntries(
    Object.entries(parsed).filter(([, value]) =>
      value === 'local_only' ||
      value === 'sync_enable_pending' ||
      value === 'synced' ||
      value === 'sync_error'
    )
  ) as PowerSyncHouseSyncStateMap;
};

export const savePowerSyncHouseSyncStates = async (
  states: PowerSyncHouseSyncStateMap,
  storage: KeyValueStorage = defaultPowerSyncStorage
) => {
  await storage.setItem(POWERSYNC_HOUSE_SYNC_STATE_KEY, JSON.stringify(states));
};

export const markPowerSyncHousesLocalOnly = async (
  houseIds: string[],
  storage: KeyValueStorage = defaultPowerSyncStorage
) => {
  const current = await loadPowerSyncHouseSyncStates(storage);
  const next = { ...current };
  for (const houseId of Array.from(new Set(houseIds.filter(Boolean)))) {
    next[houseId] = 'local_only';
  }
  await savePowerSyncHouseSyncStates(next, storage);
};

export const markPowerSyncHousesSynced = async (
  houseIds: string[],
  storage: KeyValueStorage = defaultPowerSyncStorage
) => {
  const current = await loadPowerSyncHouseSyncStates(storage);
  const next = { ...current };
  for (const houseId of Array.from(new Set(houseIds.filter(Boolean)))) {
    next[houseId] = 'synced';
  }
  await savePowerSyncHouseSyncStates(next, storage);
};

export const markPowerSyncHousesSyncEnablePending = async (
  houseIds: string[],
  storage: KeyValueStorage = defaultPowerSyncStorage
) => {
  const current = await loadPowerSyncHouseSyncStates(storage);
  const next = { ...current };
  for (const houseId of Array.from(new Set(houseIds.filter(Boolean)))) {
    next[houseId] = 'sync_enable_pending';
  }
  await savePowerSyncHouseSyncStates(next, storage);
};

export const markPowerSyncHousesSyncError = async (
  houseIds: string[],
  storage: KeyValueStorage = defaultPowerSyncStorage
) => {
  const current = await loadPowerSyncHouseSyncStates(storage);
  const next = { ...current };
  for (const houseId of Array.from(new Set(houseIds.filter(Boolean)))) {
    next[houseId] = 'sync_error';
  }
  await savePowerSyncHouseSyncStates(next, storage);
};

export type { KeyValueStorage };
