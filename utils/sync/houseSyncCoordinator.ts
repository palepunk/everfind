import AsyncStorage from '@react-native-async-storage/async-storage';

// Shared cloud-sync orchestration contract.
//
// In FOSS builds, the remote transport functions imported below are public
// placeholders, so these calls either disconnect or report cloud-unavailable
// state. The code remains public so shared screens can compile and so cloud
// builds can reuse the same orchestration with private transport overrides.

import { database } from '@/utils/storage/database';
import {
  loadSyncDisabledHouseIds,
  loadSyncedHouseIds,
  reconcileAutoSyncedHouseIds,
} from '@/utils/sync/settingsMetadata';
import { computeBootstrapSyncState, type BootstrapSyncState } from '@/utils/sync/bootstrapState';
import { setInventoryBootstrapInProgress } from '@/utils/sync/inventoryBootstrapState';
import { prepareHouseForSyncEnable } from '@/utils/sync/prepareHouseForSyncEnable';
import { loadPowerSyncReadModeEnabled } from '@/utils/powersync/readMode';
import { uploadPowerSyncHouseForFirstSync } from '@/utils/powersync/firstSync';
import { syncPowerSyncConnectionForSession } from '@/utils/powersync/connectionLifecycle';

const INSTALL_DEFAULT_HOUSE_ID_KEY = 'installDefaultHouseId';

type BootstrapSyncCallbacks = {
  onBootstrapVisibilityChange?: (visible: boolean) => void;
};

export const enableHouseSyncForUser = async (houseId: string, userId: string) => {
  if (await loadPowerSyncReadModeEnabled()) {
    await uploadPowerSyncHouseForFirstSync(houseId, userId);
    return;
  }

  await prepareHouseForSyncEnable(houseId, userId);
  await syncPowerSyncConnectionForSession(true);
};

export const syncEnabledInventoryForUser = async (userId: string, houseIds?: string[]) => {
  const targetHouseIds = houseIds ?? (await loadSyncedHouseIds());
  if (await loadPowerSyncReadModeEnabled()) {
    await syncPowerSyncConnectionForSession(true);
    return targetHouseIds;
  }

  await syncPowerSyncConnectionForSession(true);
  return targetHouseIds;
};

export const bootstrapRemoteInventoryForUser = async (
  userId: string,
  callbacks: BootstrapSyncCallbacks = {}
): Promise<{ initialHouseIds: string[]; finalHouseIds: string[]; bootstrapState: BootstrapSyncState | null }> => {
  let houseIds = await loadSyncedHouseIds();
  const initialHouseIds = [...houseIds];
  if (await loadPowerSyncReadModeEnabled()) {
    await syncPowerSyncConnectionForSession(true);
    return {
      initialHouseIds,
      finalHouseIds: houseIds,
      bootstrapState: null,
    };
  }

  const shouldShowBootstrapDialog = houseIds.length === 0;

  if (shouldShowBootstrapDialog) {
    setInventoryBootstrapInProgress(true);
    callbacks.onBootstrapVisibilityChange?.(true);
  }

  try {
    await syncPowerSyncConnectionForSession(true);

    let bootstrapState: BootstrapSyncState | null = null;
    if (!houseIds.length) {
      const [localHouses, disabledHouseIds, installDefaultHouseId, storedSyncedHouseIds] = await Promise.all([
        database.collections.get<any>('houses').query().fetch(),
        loadSyncDisabledHouseIds(),
        AsyncStorage.getItem(INSTALL_DEFAULT_HOUSE_ID_KEY),
        loadSyncedHouseIds(),
      ]);

      bootstrapState = computeBootstrapSyncState({
        visibleHouseIds: localHouses.map((house: any) => String(house.id)),
        storedSyncedHouseIds,
        disabledHouseIds,
        installDefaultHouseId,
      });

      if (bootstrapState.shouldRunBootstrap) {
        await reconcileAutoSyncedHouseIds(bootstrapState.discoveredHouseIds);
        houseIds = bootstrapState.discoveredHouseIds;
        await syncPowerSyncConnectionForSession(true);
      }
    }

    return {
      initialHouseIds,
      finalHouseIds: houseIds,
      bootstrapState,
    };
  } finally {
    if (shouldShowBootstrapDialog) {
      setInventoryBootstrapInProgress(false);
      callbacks.onBootstrapVisibilityChange?.(false);
    }
  }
};
