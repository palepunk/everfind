import { database } from '../storage/database';
import { getHouseCollaboration } from '../collaboration/houseSharing';
import { loadPowerSyncReadModeEnabled } from '../powersync/readMode';
import { getPowerSyncRepositoryHouses } from '../powersync/repository';

export type ExportableHouseOption = {
  id: string;
  name: string;
  access: 'local' | 'owner' | 'admin';
};

const compareByName = (left: ExportableHouseOption, right: ExportableHouseOption) => {
  const byName = left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  if (byName !== 0) return byName;
  return left.id.localeCompare(right.id);
};

export const getExportableHouses = async (userId?: string | null): Promise<ExportableHouseOption[]> => {
  const powerSyncReadModeEnabled = await loadPowerSyncReadModeEnabled();
  const houses = powerSyncReadModeEnabled
    ? (await getPowerSyncRepositoryHouses()).map((house) => ({
        id: house.id,
        name: house.name,
        ownerId: house.owner_id,
        source: house.source,
      }))
    : await database.collections.get<any>('houses').query().fetch();

  const exportable = await Promise.all(
    houses.map(async (house: any): Promise<ExportableHouseOption | null> => {
      if (powerSyncReadModeEnabled && house.source === 'local') {
        return {
          id: house.id,
          name: house.name ?? 'Untitled house',
          access: 'local',
        };
      }

      if (!userId) {
        return {
          id: house.id,
          name: house.name ?? 'Untitled house',
          access: 'local',
        };
      }

      try {
        const collaboration = await getHouseCollaboration(house.id);
        const canExport =
          collaboration?.permissions?.can_admin === true ||
          collaboration?.my_role === 'owner' ||
          collaboration?.my_role === 'admin';

        if (!canExport) return null;

        return {
          id: house.id,
          name: house.name ?? 'Untitled house',
          access: collaboration?.my_role === 'owner' ? 'owner' : 'admin',
        };
      } catch {
        if (!house.ownerId) {
          return {
            id: house.id,
            name: house.name ?? 'Untitled house',
            access: 'local',
          };
        }

        if (house.ownerId === userId) {
          return {
            id: house.id,
            name: house.name ?? 'Untitled house',
            access: 'owner',
          };
        }

        return null;
      }
    })
  );

  return exportable.filter((house): house is ExportableHouseOption => Boolean(house)).sort(compareByName);
};
