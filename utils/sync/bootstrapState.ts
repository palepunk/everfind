// Pure state helper shared with cloud sync flows.
//
// FOSS keeps this because tests and shared UI can reason about local-only versus
// sync-enabled house state without importing any backend implementation.

export type BootstrapSyncStateInput = {
  visibleHouseIds: string[];
  storedSyncedHouseIds: string[];
  disabledHouseIds: string[];
  installDefaultHouseId: string | null;
};

export type BootstrapSyncState = {
  nonDefaultHouseIds: string[];
  storedNonDefaultHouseIds: string[];
  missingVisibleNonDefaultHouseIds: string[];
  discoveredHouseIds: string[];
  onlyDefaultHouseVisible: boolean;
  onlyBootstrapHouseEnabled: boolean;
  shouldShowBootstrapDialog: boolean;
  shouldRunBootstrap: boolean;
};

const dedupeHouseIds = (ids: string[]) => Array.from(new Set(ids.filter(Boolean)));

export const computeBootstrapSyncState = ({
  visibleHouseIds,
  storedSyncedHouseIds,
  disabledHouseIds,
  installDefaultHouseId,
}: BootstrapSyncStateInput): BootstrapSyncState => {
  const disabledHouseIdSet = new Set(disabledHouseIds);
  const nonDefaultHouseIds = dedupeHouseIds(
    visibleHouseIds.filter(
      (houseId) =>
        Boolean(houseId) &&
        houseId !== installDefaultHouseId &&
        !disabledHouseIdSet.has(houseId)
    )
  );
  const storedNonDefaultHouseIds = dedupeHouseIds(
    storedSyncedHouseIds.filter((houseId) => houseId !== installDefaultHouseId)
  );
  const missingVisibleNonDefaultHouseIds = nonDefaultHouseIds.filter(
    (houseId) => !storedNonDefaultHouseIds.includes(houseId)
  );
  const onlyDefaultHouseVisible =
    Boolean(installDefaultHouseId) &&
    visibleHouseIds.length === 1 &&
    visibleHouseIds[0] === installDefaultHouseId;
  const onlyBootstrapHouseEnabled =
    Boolean(installDefaultHouseId) &&
    storedSyncedHouseIds.length > 0 &&
    storedSyncedHouseIds.every((houseId) => houseId === installDefaultHouseId);
  const shouldShowBootstrapDialog =
    storedSyncedHouseIds.length === 0 || onlyBootstrapHouseEnabled;
  const discoveredHouseIds =
    nonDefaultHouseIds.length > 0
      ? dedupeHouseIds([...storedNonDefaultHouseIds, ...nonDefaultHouseIds])
      : [];
  const shouldRunBootstrap =
    !(storedSyncedHouseIds.length > 0 &&
      !onlyBootstrapHouseEnabled &&
      missingVisibleNonDefaultHouseIds.length === 0) &&
    !(onlyDefaultHouseVisible && !nonDefaultHouseIds.length) &&
    discoveredHouseIds.length > 0;

  return {
    nonDefaultHouseIds,
    storedNonDefaultHouseIds,
    missingVisibleNonDefaultHouseIds,
    discoveredHouseIds,
    onlyDefaultHouseVisible,
    onlyBootstrapHouseEnabled,
    shouldShowBootstrapDialog,
    shouldRunBootstrap,
  };
};
