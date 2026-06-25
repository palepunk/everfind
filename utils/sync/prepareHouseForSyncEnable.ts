import { database } from '@/utils/storage/database';

// Shared cloud-sync preparation contract.
//
// In FOSS this is normally unreachable because enabling sync requires auth.
// Cloud builds use it before first upload to attach the signed-in owner to a
// previously local-only house.

export const prepareHouseForSyncEnable = async (houseId: string, userId: string) => {
  if (!houseId || !userId) return null;

  const house = await database.collections.get<any>('houses').find(houseId);
  if (!house.ownerId) {
    await database.write(async () => {
      await house.update((current: any) => {
        current.ownerId = userId;
      });
    });
  }
  return house;
};
