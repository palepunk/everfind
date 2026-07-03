import AsyncStorage from '@react-native-async-storage/async-storage';
import { database } from '@/utils/storage/database';
import { safeGetSession } from '@/utils/auth/session';
import { loadPowerSyncReadModeEnabled } from '@/utils/powersync/readMode';
import { getPowerSyncDatabase } from '@/utils/powersync/system';
import { markPowerSyncHousesSynced } from '@/utils/powersync/metadata';

// Shared sync preference metadata.
//
// FOSS builds always behave as signed out, so these helpers resolve to
// local-only/disabled sync state. Cloud builds use the same keys to remember
// which houses should participate in backend sync after sign-in.

const SYNC_ENABLED_KEY = 'cloudSyncEnabled';
const SYNC_ENABLED_HOUSE_IDS_KEY = 'cloudSyncEnabledHouseIds';
const SYNC_ENABLED_HOUSE_IDS_INITIALIZED_KEY = 'cloudSyncEnabledHouseIdsInitialized';
const SYNC_DISABLED_HOUSE_IDS_KEY = 'cloudSyncDisabledHouseIds';
const HOUSE_SYNC_MODES_KEY = 'houseSyncModesByHouseId';
const LEGACY_SYNC_ENABLED_KEYS = ['syncEnabled', 'cloud_sync_enabled'];
const SETTINGS_UPDATED_AT_KEY = 'settingsUpdatedAt';
const SETTINGS_LAST_SYNC_AT_KEY = 'settingsLastSyncAt';
const INSTALL_DEFAULT_HOUSE_ID_KEY = 'installDefaultHouseId';
const syncEnabledListeners = new Set<(enabled: boolean) => void>();
const syncedHouseIdsListeners = new Set<(houseIds: string[]) => void>();
type HouseSyncMode = 'manual_on' | 'manual_off' | 'auto_on';
type HouseSyncModeMap = Record<string, HouseSyncMode>;

const toNumber = (value: string | null) => {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const dedupeHouseIds = (ids: string[]) => Array.from(new Set(ids.filter(Boolean)));

const isHouseSyncMode = (value: unknown): value is HouseSyncMode =>
  value === 'manual_on' || value === 'manual_off' || value === 'auto_on';

const normalizeHouseSyncModeMap = (value: unknown): HouseSyncModeMap => {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      ([houseId, mode]) => Boolean(houseId) && isHouseSyncMode(mode)
    )
  ) as HouseSyncModeMap;
};

const getEnabledHouseIdsFromModes = (modes: HouseSyncModeMap) =>
  dedupeHouseIds(
    Object.entries(modes)
      .filter(([, mode]) => mode === 'manual_on' || mode === 'auto_on')
      .map(([houseId]) => houseId)
  );

const getDisabledHouseIdsFromModes = (modes: HouseSyncModeMap) =>
  dedupeHouseIds(
    Object.entries(modes)
      .filter(([, mode]) => mode === 'manual_off')
      .map(([houseId]) => houseId)
  );

const saveHouseSyncModes = async (modes: HouseSyncModeMap) => {
  const normalized = normalizeHouseSyncModeMap(modes);
  const enabledHouseIds = getEnabledHouseIdsFromModes(normalized);
  const disabledHouseIds = getDisabledHouseIdsFromModes(normalized);
  const enabledValue = enabledHouseIds.length > 0 ? 'true' : 'false';

  if (Object.keys(normalized).length > 0) {
    await AsyncStorage.setItem(HOUSE_SYNC_MODES_KEY, JSON.stringify(normalized));
  } else {
    await AsyncStorage.removeItem(HOUSE_SYNC_MODES_KEY);
  }

  await AsyncStorage.setItem(SYNC_ENABLED_HOUSE_IDS_KEY, JSON.stringify(enabledHouseIds));
  if (disabledHouseIds.length > 0) {
    await AsyncStorage.setItem(SYNC_DISABLED_HOUSE_IDS_KEY, JSON.stringify(disabledHouseIds));
  } else {
    await AsyncStorage.removeItem(SYNC_DISABLED_HOUSE_IDS_KEY);
  }
  await AsyncStorage.setItem(SYNC_ENABLED_KEY, enabledValue);
  await AsyncStorage.setItem(SYNC_ENABLED_HOUSE_IDS_INITIALIZED_KEY, 'true');
  await Promise.all(
    LEGACY_SYNC_ENABLED_KEYS.map((legacyKey) => AsyncStorage.setItem(legacyKey, enabledValue))
  );
  emitSyncState(enabledHouseIds);
};

const loadStoredHouseSyncModes = async (): Promise<HouseSyncModeMap> => {
  const raw = await AsyncStorage.getItem(HOUSE_SYNC_MODES_KEY);
  if (raw) {
    try {
      return normalizeHouseSyncModeMap(JSON.parse(raw));
    } catch {
      return {};
    }
  }

  const [storedEnabledRaw, storedDisabledRaw] = await Promise.all([
    AsyncStorage.getItem(SYNC_ENABLED_HOUSE_IDS_KEY),
    AsyncStorage.getItem(SYNC_DISABLED_HOUSE_IDS_KEY),
  ]);
  const modes: HouseSyncModeMap = {};

  if (storedEnabledRaw) {
    try {
      const parsed = JSON.parse(storedEnabledRaw);
      if (Array.isArray(parsed)) {
        for (const houseId of parsed.map((id) => String(id)).filter(Boolean)) {
          modes[houseId] = 'manual_on';
        }
      }
    } catch {
      // Ignore malformed legacy data.
    }
  }

  if (storedDisabledRaw) {
    try {
      const parsed = JSON.parse(storedDisabledRaw);
      if (Array.isArray(parsed)) {
        for (const houseId of parsed.map((id) => String(id)).filter(Boolean)) {
          modes[houseId] = 'manual_off';
        }
      }
    } catch {
      // Ignore malformed legacy data.
    }
  }

  return modes;
};

export const loadSyncDisabledHouseIds = async (): Promise<string[]> => {
  const { disabledHouseIds } = await loadEffectiveHouseSyncState();
  return disabledHouseIds;
};

const loadLegacySyncEnabled = async () => {
  const values: string[] = [];
  const stored = await AsyncStorage.getItem(SYNC_ENABLED_KEY);
  if (stored === 'true' || stored === 'false') {
    values.push(stored);
  }

  for (const legacyKey of LEGACY_SYNC_ENABLED_KEYS) {
    const legacyValue = await AsyncStorage.getItem(legacyKey);
    if (legacyValue === 'true' || legacyValue === 'false') {
      values.push(legacyValue);
    }
  }

  // Conservative migration: explicit false in any known legacy key wins.
  if (values.includes('false')) {
    await AsyncStorage.setItem(SYNC_ENABLED_KEY, 'false');
    return false;
  }
  if (values.includes('true')) {
    await AsyncStorage.setItem(SYNC_ENABLED_KEY, 'true');
    return true;
  }

  return false;
};

const loadAllLocalHouseIds = async (): Promise<string[]> => {
  try {
    const houses = await database.collections.get<any>('houses').query().fetch();
    return dedupeHouseIds(houses.map((house: any) => String(house.id)));
  } catch (error) {
    console.warn('Failed to load local houses for sync migration', error);
    return [];
  }
};

const loadVisiblePowerSyncHouseIds = async (): Promise<string[]> => {
  try {
    if (!(await loadPowerSyncReadModeEnabled())) return [];
    const powerSyncDatabase = getPowerSyncDatabase();
    await powerSyncDatabase.waitForReady();
    const rows = await powerSyncDatabase.getAll<{ id: string }>('SELECT id FROM houses');
    return dedupeHouseIds(rows.map((house) => String(house.id)));
  } catch (error) {
    console.warn('Failed to load PowerSync houses for sync metadata', error);
    return [];
  }
};

const emitSyncState = (houseIds: string[]) => {
  const next = dedupeHouseIds(houseIds);
  syncedHouseIdsListeners.forEach((listener) => listener(next));
  syncEnabledListeners.forEach((listener) => listener(next.length > 0));
};

const pruneHouseSyncModesToVisible = async (modes: HouseSyncModeMap, extraVisibleHouseIds: string[] = []) => {
  const [localHouseIds, installDefaultHouseId] = await Promise.all([
    loadAllLocalHouseIds(),
    AsyncStorage.getItem(INSTALL_DEFAULT_HOUSE_ID_KEY),
  ]);
  const visibleHouseIdSet = new Set([...localHouseIds, ...extraVisibleHouseIds]);
  return Object.fromEntries(
    Object.entries(modes).filter(([houseId, mode]) => {
      if (!visibleHouseIdSet.has(houseId)) return false;
      if (houseId === installDefaultHouseId && mode === 'auto_on') return false;
      return true;
    })
  ) as HouseSyncModeMap;
};

type EffectiveHouseSyncState = {
  modes: HouseSyncModeMap;
  enabledHouseIds: string[];
  disabledHouseIds: string[];
  initialized: boolean;
};

async function loadEffectiveHouseSyncState(): Promise<EffectiveHouseSyncState> {
  const session = await safeGetSession();
  if (!session?.access_token) {
    return {
      modes: {},
      enabledHouseIds: [],
      disabledHouseIds: [],
      initialized: false,
    };
  }

  const initialized = await AsyncStorage.getItem(SYNC_ENABLED_HOUSE_IDS_INITIALIZED_KEY);
  const storedModes = await loadStoredHouseSyncModes();
  const visiblePowerSyncHouseIds = await loadVisiblePowerSyncHouseIds();
  const prunedModes = await pruneHouseSyncModesToVisible(storedModes, visiblePowerSyncHouseIds);
  const nextModes = { ...prunedModes };
  let remoteModesChanged = false;

  for (const houseId of visiblePowerSyncHouseIds) {
    if (!nextModes[houseId]) {
      nextModes[houseId] = 'auto_on';
      remoteModesChanged = true;
    }
  }

  const modesChanged =
    remoteModesChanged ||
    JSON.stringify(Object.entries(nextModes).sort()) !==
      JSON.stringify(Object.entries(storedModes).sort());

  if (modesChanged) {
    await saveHouseSyncModes(nextModes);
    const autoEnabledPowerSyncHouseIds = visiblePowerSyncHouseIds.filter(
      (houseId) => nextModes[houseId] === 'auto_on'
    );
    if (autoEnabledPowerSyncHouseIds.length > 0) {
      await markPowerSyncHousesSynced(autoEnabledPowerSyncHouseIds);
    }
  }

  const enabledHouseIds = getEnabledHouseIdsFromModes(nextModes);
  const disabledHouseIds = getDisabledHouseIdsFromModes(nextModes);
  return {
    modes: nextModes,
    enabledHouseIds,
    disabledHouseIds,
    initialized: initialized === 'true',
  };
}

export const loadSyncedHouseIds = async (): Promise<string[]> => {
  const effectiveState = await loadEffectiveHouseSyncState();
  const { enabledHouseIds, modes } = effectiveState;

  if (enabledHouseIds.length > 0) {
    return enabledHouseIds;
  }

  if (Object.keys(modes).length > 0) {
    return [];
  }

  const legacyEnabled = await loadLegacySyncEnabled();
  if (legacyEnabled) {
    await AsyncStorage.setItem(SYNC_ENABLED_KEY, 'false');
    await AsyncStorage.setItem(SYNC_ENABLED_HOUSE_IDS_INITIALIZED_KEY, 'true');
  }

  await AsyncStorage.setItem(SYNC_ENABLED_HOUSE_IDS_INITIALIZED_KEY, 'true');
  return [];
};

export const saveSyncedHouseIds = async (ids: string[]) => {
  const nextEnabledIds = new Set(dedupeHouseIds(ids));
  const modes = await loadStoredHouseSyncModes();
  const nextModes: HouseSyncModeMap = {};

  for (const [houseId, mode] of Object.entries(modes)) {
    if (nextEnabledIds.has(houseId)) {
      nextModes[houseId] = 'manual_on';
    } else if (mode === 'manual_off') {
      nextModes[houseId] = 'manual_off';
    } else if (mode === 'manual_on' || mode === 'auto_on') {
      nextModes[houseId] = 'manual_off';
    }
  }

  for (const houseId of nextEnabledIds) {
    nextModes[houseId] = 'manual_on';
  }

  await saveHouseSyncModes(nextModes);
};

export const reconcileAutoSyncedHouseIds = async (
  ids: string[],
  options?: { force?: boolean }
) => {
  const nextAutoIds = new Set(dedupeHouseIds(ids));
  const modes = await loadStoredHouseSyncModes();
  const nextModes: HouseSyncModeMap = {};

  for (const [houseId, mode] of Object.entries(modes)) {
    if (mode === 'manual_on' || mode === 'manual_off') {
      if (options?.force && nextAutoIds.has(houseId)) {
        nextModes[houseId] = 'auto_on';
        continue;
      }
      nextModes[houseId] = mode;
      continue;
    }
    if (nextAutoIds.has(houseId)) {
      nextModes[houseId] = 'auto_on';
    }
  }

  for (const houseId of nextAutoIds) {
    if (!nextModes[houseId]) {
      nextModes[houseId] = 'auto_on';
    }
  }

  await saveHouseSyncModes(nextModes);
};

export const isHouseSyncEnabled = async (houseId: string) => {
  const { enabledHouseIds } = await loadEffectiveHouseSyncState();
  return enabledHouseIds.includes(houseId);
};

export const setHouseSyncEnabled = async (houseId: string, enabled: boolean) => {
  const session = await safeGetSession();
  if (enabled && !session?.access_token) {
    throw new Error('Sign in to enable sync.');
  }
  const installDefaultHouseId = await AsyncStorage.getItem(INSTALL_DEFAULT_HOUSE_ID_KEY);
  const modes = await loadStoredHouseSyncModes();
  if (enabled && installDefaultHouseId === houseId) {
    await AsyncStorage.removeItem(INSTALL_DEFAULT_HOUSE_ID_KEY);
  }
  modes[houseId] = enabled ? 'manual_on' : 'manual_off';
  await saveHouseSyncModes(modes);
};

export const ensureHouseSyncEnabled = async (houseId: string) => {
  const session = await safeGetSession();
  if (!session?.access_token) {
    throw new Error('Sign in to enable sync.');
  }
  const modes = await loadStoredHouseSyncModes();
  if (modes[houseId] === 'manual_on') return;
  const installDefaultHouseId = await AsyncStorage.getItem(INSTALL_DEFAULT_HOUSE_ID_KEY);
  if (installDefaultHouseId === houseId) {
    await AsyncStorage.removeItem(INSTALL_DEFAULT_HOUSE_ID_KEY);
  }
  modes[houseId] = 'manual_on';
  await saveHouseSyncModes(modes);
};

export const hasAnyHouseSyncEnabled = async () => {
  const { enabledHouseIds } = await loadEffectiveHouseSyncState();
  return enabledHouseIds.length > 0;
};

export const subscribeHouseSyncChanges = (listener: (houseIds: string[]) => void) => {
  syncedHouseIdsListeners.add(listener);
  return () => {
    syncedHouseIdsListeners.delete(listener);
  };
};

// Compatibility: keep global-style API mapped to "any house enabled".
export const loadSyncEnabled = async () => await hasAnyHouseSyncEnabled();

// Compatibility: "true" enables all current local houses; "false" disables all houses.
export const saveSyncEnabled = async (enabled: boolean) => {
  if (enabled) {
    const session = await safeGetSession();
    if (!session?.access_token) {
      throw new Error('Sign in to enable sync.');
    }
    const allHouseIds = await loadAllLocalHouseIds();
    await saveSyncedHouseIds(allHouseIds);
    return;
  }
  await saveSyncedHouseIds([]);
};

export const subscribeSyncEnabledChanges = (listener: (enabled: boolean) => void) => {
  syncEnabledListeners.add(listener);
  return () => {
    syncEnabledListeners.delete(listener);
  };
};

export const loadSettingsUpdatedAt = async () => {
  const stored = await AsyncStorage.getItem(SETTINGS_UPDATED_AT_KEY);
  return toNumber(stored) ?? 0;
};

export const saveSettingsUpdatedAt = async (value: number) => {
  await AsyncStorage.setItem(SETTINGS_UPDATED_AT_KEY, String(value));
};

export const touchSettingsUpdatedAt = async () => {
  const now = Date.now();
  await saveSettingsUpdatedAt(now);
  return now;
};

export const loadLastSyncAt = async () => {
  const stored = await AsyncStorage.getItem(SETTINGS_LAST_SYNC_AT_KEY);
  return toNumber(stored);
};

export const saveLastSyncAt = async (value: number) => {
  await AsyncStorage.setItem(SETTINGS_LAST_SYNC_AT_KEY, String(value));
};
