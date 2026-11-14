// Shared cloud-sync orchestration contract.
//
// In FOSS builds, the remote transport functions imported below are public
// placeholders, so these calls either disconnect or report cloud-unavailable
// state. The code remains public so shared screens can compile and so cloud
// builds can reuse the same orchestration with private transport overrides.

import { loadSyncedHouseIds } from '@/utils/sync/settingsMetadata';
import type { BootstrapSyncState } from '@/utils/sync/bootstrapState';
import { uploadPowerSyncHouseForFirstSync } from '@/utils/powersync/firstSync';
import { syncPowerSyncConnectionForSession } from '@/utils/powersync/connectionLifecycle';

type BootstrapSyncCallbacks = {
  onBootstrapVisibilityChange?: (visible: boolean) => void;
};

export const enableHouseSyncForUser = async (houseId: string, userId: string) => {
  await uploadPowerSyncHouseForFirstSync(houseId, userId);
};

export const syncEnabledInventoryForUser = async (userId: string, houseIds?: string[]) => {
  const targetHouseIds = houseIds ?? (await loadSyncedHouseIds());
  await syncPowerSyncConnectionForSession(true);
  return targetHouseIds;
};

export const bootstrapRemoteInventoryForUser = async (
  userId: string,
  _callbacks: BootstrapSyncCallbacks = {}
): Promise<{ initialHouseIds: string[]; finalHouseIds: string[]; bootstrapState: BootstrapSyncState | null }> => {
  const houseIds = await loadSyncedHouseIds();
  await syncPowerSyncConnectionForSession(true);
  return {
    initialHouseIds: [...houseIds],
    finalHouseIds: houseIds,
    bootstrapState: null,
  };
};
