import { useEffect, useRef, useState } from 'react';

import {
  getPowerSyncRepositoryBoxes,
  getPowerSyncRepositoryContainers,
  getPowerSyncRepositoryHouseById,
  getPowerSyncRepositoryHouses,
  getPowerSyncRepositoryItemImages,
  getPowerSyncRepositoryItems,
  getPowerSyncRepositoryRooms,
} from './repository';
import { getPowerSyncDatabase } from './system';

type UsePowerSyncRowsOptions<T> = {
  active: boolean;
  refreshKey?: number;
  queryKey?: string;
  tables: string[];
  load: () => Promise<T[]>;
  filter?: (rows: T[]) => T[];
};

type UsePowerSyncRowOptions<T> = {
  active: boolean;
  refreshKey?: number;
  queryKey?: string;
  tables: string[];
  load: () => Promise<T | null>;
};

const usePowerSyncRows = <T,>({
  active,
  refreshKey,
  queryKey,
  tables,
  load,
  filter,
}: UsePowerSyncRowsOptions<T>) => {
  const [rows, setRows] = useState<T[]>([]);
  const tablesKey = tables.join(',');
  const loadRef = useRef(load);
  const filterRef = useRef(filter);
  const tablesRef = useRef(tables);

  loadRef.current = load;
  filterRef.current = filter;
  tablesRef.current = tables;

  useEffect(() => {
    if (!active) {
      setRows([]);
      return;
    }

    let disposed = false;
    const database = getPowerSyncDatabase();

    const refresh = async () => {
      try {
        const nextRows = await loadRef.current();
        const currentFilter = filterRef.current;
        if (!disposed) setRows(currentFilter ? currentFilter(nextRows) : nextRows);
      } catch (error) {
        console.warn('PowerSync read query failed', error);
        if (!disposed) setRows([]);
      }
    };

    void refresh();
    const dispose = database.onChange(
      {
        onChange: () => {
          void refresh();
        },
        onError: (error) => {
          console.warn('PowerSync read watch failed', error);
        },
      },
      { tables: tablesRef.current }
    );

    return () => {
      disposed = true;
      dispose?.();
    };
  }, [active, refreshKey, queryKey, tablesKey]);

  return rows;
};

const usePowerSyncRow = <T,>({
  active,
  refreshKey,
  queryKey,
  tables,
  load,
}: UsePowerSyncRowOptions<T>) => {
  const [row, setRow] = useState<T | null>(null);
  const tablesKey = tables.join(',');
  const loadRef = useRef(load);
  const tablesRef = useRef(tables);

  loadRef.current = load;
  tablesRef.current = tables;

  useEffect(() => {
    if (!active) {
      setRow(null);
      return;
    }

    let disposed = false;
    const database = getPowerSyncDatabase();

    const refresh = async () => {
      try {
        const nextRow = await loadRef.current();
        if (!disposed) setRow(nextRow);
      } catch (error) {
        console.warn('PowerSync read query failed', error);
        if (!disposed) setRow(null);
      }
    };

    void refresh();
    const dispose = database.onChange(
      {
        onChange: () => {
          void refresh();
        },
        onError: (error) => {
          console.warn('PowerSync read watch failed', error);
        },
      },
      { tables: tablesRef.current }
    );

    return () => {
      disposed = true;
      dispose?.();
    };
  }, [active, refreshKey, queryKey, tablesKey]);

  return row;
};

const INVENTORY_TABLES = [
  'houses',
  'local_houses',
  'rooms',
  'local_rooms',
  'containers',
  'local_containers',
  'boxes',
  'local_boxes',
  'items',
  'local_items',
  'item_images',
  'local_item_images',
];

const mapHouse = (house: Awaited<ReturnType<typeof getPowerSyncRepositoryHouses>>[number]) => ({
  id: house.id,
  name: house.name ?? '',
  ownerId: house.owner_id,
  address: house.address,
  notes: house.notes,
  imagePath: house.image_path,
});

export const usePowerSyncHousesRead = (active: boolean, refreshKey?: number) =>
  usePowerSyncRows({
    active,
    refreshKey,
    tables: ['houses', 'local_houses'],
    load: async () => (await getPowerSyncRepositoryHouses()).map(mapHouse),
  });

export const usePowerSyncActiveHouseRead = (
  active: boolean,
  houseId: string | null,
  refreshKey?: number
) =>
  usePowerSyncRow({
    active: active && Boolean(houseId),
    refreshKey,
    queryKey: houseId ?? '',
    tables: ['houses', 'local_houses'],
    load: async () => {
      if (!houseId) return null;
      const house = await getPowerSyncRepositoryHouseById(undefined, houseId);
      return house ? mapHouse(house) : null;
    },
  });

export const usePowerSyncRoomsRead = (active: boolean, houseId?: string, refreshKey?: number) =>
  usePowerSyncRows({
    active,
    refreshKey,
    queryKey: houseId ?? '',
    tables: ['rooms', 'local_rooms'],
    load: async () => getPowerSyncRepositoryRooms(undefined, houseId),
  });

export const usePowerSyncContainersRead = (
  active: boolean,
  houseId?: string | number,
  roomId?: string,
  refreshKey?: number,
  fallbackRoomIds?: string[]
) =>
  usePowerSyncRows({
    active,
    refreshKey,
    queryKey: `${houseId ?? ''}:${roomId ?? ''}:${(fallbackRoomIds ?? []).join(',')}`,
    tables: ['containers', 'local_containers'],
    load: async () => getPowerSyncRepositoryContainers(undefined, typeof houseId === 'string' ? houseId : undefined),
    filter: (rows) => {
      const fallbackRoomIdsArray = fallbackRoomIds ?? [];
      return rows.filter((container) => {
        if (roomId) return container.roomId === roomId;
        if (houseId && container.houseId === houseId) return true;
        if (fallbackRoomIdsArray.length > 0 && fallbackRoomIdsArray.includes(container.roomId)) return true;
        return !houseId && fallbackRoomIdsArray.length === 0;
      });
    },
  });

export const usePowerSyncBoxesRead = (
  active: boolean,
  houseId?: string,
  parentType?: string,
  parentId?: string,
  refreshKey?: number,
  fallbackRoomIds?: string[],
  fallbackContainerIds?: string[]
) =>
  usePowerSyncRows({
    active,
    refreshKey,
    queryKey: `${houseId ?? ''}:${parentType ?? ''}:${parentId ?? ''}:${(fallbackRoomIds ?? []).join(',')}:${(fallbackContainerIds ?? []).join(',')}`,
    tables: ['boxes', 'local_boxes'],
    load: async () => getPowerSyncRepositoryBoxes(undefined, houseId),
    filter: (rows) => {
      const fallbackRoomIdsArray = fallbackRoomIds ?? [];
      const fallbackContainerIdsArray = fallbackContainerIds ?? [];
      const isParentScope = Boolean(parentType && parentId);
      return rows.filter((box) => {
        if (isParentScope) return box.parentType === parentType && box.parentId === parentId;
        if (houseId && box.houseId === houseId) return true;
        if (
          fallbackRoomIdsArray.length > 0 &&
          box.parentType === 'room' &&
          box.parentId &&
          fallbackRoomIdsArray.includes(box.parentId)
        ) {
          return true;
        }
        if (
          fallbackContainerIdsArray.length > 0 &&
          box.parentType === 'container' &&
          box.parentId &&
          fallbackContainerIdsArray.includes(box.parentId)
        ) {
          return true;
        }
        return !houseId && !isParentScope;
      });
    },
  });

export const usePowerSyncItemsRead = (
  active: boolean,
  houseId?: string,
  parentType?: string,
  parentId?: string,
  refreshKey?: number
) =>
  usePowerSyncRows({
    active,
    refreshKey,
    queryKey: `${houseId ?? ''}:${parentType ?? ''}:${parentId ?? ''}`,
    tables: ['items', 'local_items'],
    load: async () => getPowerSyncRepositoryItems(undefined, houseId),
    filter: (rows) =>
      rows.filter((item) => {
        if (parentType && parentId) {
          return item.parentType === parentType && item.parentId === parentId;
        }
        return true;
      }),
  });

export const usePowerSyncItemImagesRead = (active: boolean, itemId?: string, refreshKey?: number) =>
  usePowerSyncRows({
    active: active && Boolean(itemId),
    refreshKey,
    queryKey: itemId ?? '',
    tables: ['item_images', 'local_item_images'],
    load: async () => getPowerSyncRepositoryItemImages(undefined, itemId),
  });

export const usePowerSyncInventoryRefreshRead = (active: boolean, refreshKey?: number) =>
  usePowerSyncRows({
    active,
    refreshKey,
    tables: INVENTORY_TABLES,
    load: async () => [],
  });
