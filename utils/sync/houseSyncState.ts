// Pure lifecycle-state helper shared by FOSS and cloud screens.
//
// FOSS normally lands on local-only states. Cloud builds can also surface
// syncing, synced, remote-only, and account-cleanup states.

export type HouseSyncLifecycleState =
  | 'local_only'
  | 'sync_enable_pending'
  | 'sync_bootstrap_pending'
  | 'syncing'
  | 'synced'
  | 'sync_error'
  | 'remote_only_discovered'
  | 'deleting_account_pending_cleanup';

export type HouseSyncStateHouseRecord = {
  id: string;
  ownerId?: string | null;
};

export const getHouseSyncState = ({
  houses,
  houseId,
  houseSyncEnabled,
  userId,
  isSyncing = false,
  isBootstrapInProgress = false,
  isDeletingAccountInProgress = false,
  hasSyncError = false,
}: {
  houses: HouseSyncStateHouseRecord[];
  houseId?: string | null;
  houseSyncEnabled: boolean;
  userId?: string | null;
  isSyncing?: boolean;
  isBootstrapInProgress?: boolean;
  isDeletingAccountInProgress?: boolean;
  hasSyncError?: boolean;
}) => {
  const localHouse = houseId ? houses.find((house) => house.id === houseId) : null;
  const isLocalHousePresent = Boolean(localHouse);
  const isOwnedByCurrentUser = Boolean(userId && localHouse && localHouse.ownerId === userId);
  const hasNoOwner = Boolean(localHouse && !localHouse.ownerId);

  let lifecycleState: HouseSyncLifecycleState = 'remote_only_discovered';
  if (isDeletingAccountInProgress) {
    lifecycleState = 'deleting_account_pending_cleanup';
  } else if (isLocalHousePresent && !houseSyncEnabled) {
    lifecycleState = 'local_only';
  } else if (!isLocalHousePresent && houseSyncEnabled) {
    lifecycleState = isBootstrapInProgress ? 'sync_bootstrap_pending' : 'remote_only_discovered';
  } else if (isLocalHousePresent && houseSyncEnabled) {
    if (hasSyncError) {
      lifecycleState = 'sync_error';
    } else if (isSyncing) {
      lifecycleState = 'syncing';
    } else if (userId && hasNoOwner) {
      lifecycleState = 'sync_enable_pending';
    } else {
      lifecycleState = 'synced';
    }
  }

  const isEditableLocally = Boolean(
    userId &&
      lifecycleState === 'local_only' &&
      localHouse &&
      (hasNoOwner || isOwnedByCurrentUser)
  );

  const shouldParticipateInSync = houseSyncEnabled;
  const shouldUseBackendPermissions = !isEditableLocally;

  return {
    lifecycleState,
    isEditableLocally,
    shouldParticipateInSync,
    shouldUseBackendPermissions,
    canEnableSync: isLocalHousePresent && !houseSyncEnabled,
    canDisableSync: isLocalHousePresent && houseSyncEnabled,
    shouldHideMissingRecordAlerts:
      lifecycleState === 'deleting_account_pending_cleanup' ||
      lifecycleState === 'sync_bootstrap_pending' ||
      lifecycleState === 'syncing',
  };
};
