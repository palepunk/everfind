import { getHouseSyncState, type HouseSyncStateHouseRecord } from '@/utils/sync/houseSyncState';

export type LocalHouseAccessRecord = HouseSyncStateHouseRecord;

export const isLocallyEditableUnsyncedHouse = ({
  houses,
  houseId,
  houseSyncEnabled,
  userId,
}: {
  houses: LocalHouseAccessRecord[];
  houseId?: string | null;
  houseSyncEnabled: boolean;
  userId?: string | null;
}) =>
  getHouseSyncState({
    houses,
    houseId,
    houseSyncEnabled,
    userId,
  }).isEditableLocally;
