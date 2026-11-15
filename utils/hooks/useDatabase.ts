import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { database } from '../storage/database';
import { House, Room, Container, Box, Item, ItemImage } from '../storage/models';
import { assertCanAddHouse, assertCanAddItem, assertCanAddStorageUnit } from '../limits';
import { trackHouseSwitched, trackRecordCreated } from '../analytics/AnalyticsProvider';
import { saveSyncedHouseIds } from '../sync/settingsMetadata';
import {
  removeSpotlightItem,
  reindexAllSpotlightItems,
  upsertSpotlightItemById,
} from '@/src/spotlight/spotlightIndex';
import {
  usePowerSyncActiveHouseRead,
  usePowerSyncBoxesRead,
  usePowerSyncContainersRead,
  usePowerSyncHousesRead,
  usePowerSyncItemImagesRead,
  usePowerSyncItemsRead,
  usePowerSyncRoomsRead,
} from '@/utils/powersync/readHooks';
import {
  createPowerSyncLocalHouse,
  createPowerSyncLocalItemImage,
  createPowerSyncLocalRoom,
  createPowerSyncLocalContainer,
  createPowerSyncLocalBox,
  createPowerSyncLocalItem,
  deletePowerSyncLocalHouse,
  deletePowerSyncLocalItemImage,
  deletePowerSyncLocalRoom,
  deletePowerSyncLocalContainer,
  deletePowerSyncLocalBox,
  deletePowerSyncLocalItem,
  updatePowerSyncLocalHouse,
  updatePowerSyncLocalItemImage,
  updatePowerSyncLocalRoom,
  updatePowerSyncLocalContainer,
  updatePowerSyncLocalBox,
  updatePowerSyncLocalItem,
} from '@/utils/powersync/mutations';
import { disconnectPowerSync, getPowerSyncDatabase } from '@/utils/powersync/system';
import {
  savePowerSyncHouseSyncStates,
  savePowerSyncLocalDataMigrationStatus,
} from '@/utils/powersync/metadata';
import { softDeleteRemoteHouses } from '@/utils/edition/remoteInventory';

type ActiveHouseListener = (id: string | null) => void;
const INSTALL_DEFAULT_HOUSE_ID_KEY = 'installDefaultHouseId';

let globalActiveHouseId: string | null = null;
const activeHouseListeners: ActiveHouseListener[] = [];

const notifyActiveHouseListeners = (houseId: string | null) => {
  globalActiveHouseId = houseId;
  activeHouseListeners.forEach(listener => listener(houseId));
};

export function useHouses(refreshKey?: number) {
  const resetting = useDatabaseResetting();
  const powerSyncHouses = usePowerSyncHousesRead(!resetting, refreshKey);
  const addHouse = async (name: string, address?: string, notes?: string, imagePath?: string) => {
    await assertCanAddHouse();
    const house = await createPowerSyncLocalHouse({
      name,
      address: address || null,
      notes: notes || null,
      imagePath: imagePath || null,
    });
    trackRecordCreated('house', { source: 'hook' });
    return house as unknown as House;
  };

  const updateHouse = async (houseId: string, name: string, address?: string, notes?: string, imagePath?: string) => {
    await updatePowerSyncLocalHouse({
      houseId,
      name,
      address: address || null,
      notes: notes || null,
      imagePath,
    });
    await reindexAllSpotlightItems();
  };

  const deleteHouse = async (houseId: string) => {
    await deletePowerSyncLocalHouse({ houseId });
    await reindexAllSpotlightItems();
  };

  return { houses: powerSyncHouses as unknown as House[], addHouse, updateHouse, deleteHouse };
}

export function useRooms(houseId?: string, refreshKey?: number) {
  const resetting = useDatabaseResetting();
  const powerSyncRooms = usePowerSyncRoomsRead(!resetting, houseId, refreshKey);
  const addRoom = async (houseId: string, name: string, description?: string, imagePath?: string) => {
    await assertCanAddStorageUnit();
    const room = await createPowerSyncLocalRoom({
      houseId,
      name,
      description: description || null,
      imagePath: imagePath || null,
    });
    trackRecordCreated('room', { source: 'hook' });
    return room as unknown as Room;
  };

  const updateRoom = async (roomId: string, name: string, description?: string, imagePath?: string) => {
    await updatePowerSyncLocalRoom({
      roomId,
      name,
      description: description || null,
      imagePath,
    });
    await reindexAllSpotlightItems();
  };

  const deleteRoom = async (roomId: string) => {
    await deletePowerSyncLocalRoom({ roomId });
    await reindexAllSpotlightItems();
  };

  return { rooms: powerSyncRooms as unknown as Room[], addRoom, updateRoom, deleteRoom };
}

export type UseContainersOptions = {
  fallbackRoomIds?: string[];
};

export function useContainers(
  houseId?: string | number,
  roomId?: string,
  refreshKey?: number,
  options?: UseContainersOptions
) {
  const resetting = useDatabaseResetting();
  const fallbackRoomIds = options?.fallbackRoomIds;
  const powerSyncContainers = usePowerSyncContainersRead(
    !resetting,
    houseId,
    roomId,
    refreshKey,
    fallbackRoomIds
  );
  const addContainer = async (houseId: string, roomId: string, name: string, description?: string, imagePath?: string) => {
    await assertCanAddStorageUnit();
    const container = await createPowerSyncLocalContainer({
      houseId,
      roomId,
      name,
      description: description || null,
      imagePath: imagePath || null,
    });
    trackRecordCreated('container', { source: 'hook' });
    triggerGlobalRefresh();
    return container as unknown as Container;
  };

  const updateContainer = async (containerId: string, name: string, description?: string, imagePath?: string) => {
    await updatePowerSyncLocalContainer({
      containerId,
      name,
      description: description || null,
      imagePath,
    });
    await reindexAllSpotlightItems();
    triggerGlobalRefresh();
  };

  const deleteContainer = async (containerId: string) => {
    await deletePowerSyncLocalContainer({ containerId });
    await reindexAllSpotlightItems();
    triggerGlobalRefresh();
  };

  return {
    containers: powerSyncContainers as unknown as Container[],
    addContainer,
    updateContainer,
    deleteContainer,
  };
}

export type UseBoxesOptions = {
  fallbackRoomIds?: string[];
  fallbackContainerIds?: string[];
};

export function useBoxes(
  houseId?: string,
  parentType?: string,
  parentId?: string,
  refreshKey?: number,
  options?: UseBoxesOptions
) {
  const resetting = useDatabaseResetting();
  const fallbackRoomIds = options?.fallbackRoomIds;
  const fallbackContainerIds = options?.fallbackContainerIds;
  const powerSyncBoxes = usePowerSyncBoxesRead(
    !resetting,
    houseId,
    parentType,
    parentId,
    refreshKey,
    fallbackRoomIds,
    fallbackContainerIds
  );
  const addBox = async (houseId: string, name: string, description: string, parentType?: string, parentId?: string, imagePath?: string) => {
    await assertCanAddStorageUnit();
    const box = await createPowerSyncLocalBox({
      houseId,
      name,
      description,
      parentType: parentType || null,
      parentId: parentId || null,
      imagePath: imagePath || null,
    });
    trackRecordCreated('box', { source: 'hook' });
    return box as unknown as Box;
  };

  const updateBox = async (boxId: string, name: string, description: string, imagePath?: string) => {
    await updatePowerSyncLocalBox({
      boxId,
      name,
      description,
      imagePath,
    });
    await reindexAllSpotlightItems();
  };

  const deleteBox = async (boxId: string) => {
    await deletePowerSyncLocalBox({ boxId });
    await reindexAllSpotlightItems();
  };

  return { boxes: powerSyncBoxes as unknown as Box[], addBox, updateBox, deleteBox };
}

export function useItems(houseId?: string, parentType?: string, parentId?: string, refreshKey?: number) {
  const resetting = useDatabaseResetting();
  const powerSyncItems = usePowerSyncItemsRead(
    !resetting,
    houseId,
    parentType,
    parentId,
    refreshKey
  );
  const addItem = async (
    houseId: string,
    name: string,
    description: string,
    parentType?: string,
    parentId?: string,
    imagePath?: string,
    tags?: string,
    purchasePriceCents?: number,
    notes?: string
  ) => {
    await assertCanAddItem();
    const item = await createPowerSyncLocalItem({
      houseId,
      name,
      description,
      parentType: parentType || null,
      parentId: parentId || null,
      imagePath: imagePath || null,
      tags: tags || '',
      purchasePriceCents: purchasePriceCents ?? null,
      notes: notes || null,
    });
    trackRecordCreated('item', { source: 'hook' });
    return item as unknown as Item;
  };

  const updateItem = async (
    itemId: string,
    name: string,
    description: string,
    imagePath?: string,
    tags?: string,
    purchasePriceCents?: number,
    notes?: string
  ) => {
    await updatePowerSyncLocalItem({
      itemId,
      name,
      description,
      imagePath,
      tags,
      purchasePriceCents,
      notes: notes || null,
    });
    await upsertSpotlightItemById(itemId);
  };

  const deleteItem = async (itemId: string) => {
    await deletePowerSyncLocalItem({ itemId });
    await removeSpotlightItem(itemId);
  };

  return { items: powerSyncItems as unknown as Item[], addItem, updateItem, deleteItem };
}

export function useItemImages(itemId?: string, refreshKey?: number) {
  const resetting = useDatabaseResetting();
  const powerSyncItemImages = usePowerSyncItemImagesRead(
    !resetting,
    itemId,
    refreshKey
  );
  const addItemImage = async (
    itemIdToUpdate: string,
    houseId: string,
    imagePath: string,
    position: number,
    id?: string
  ) => {
    const itemImage = await createPowerSyncLocalItemImage({
      itemId: itemIdToUpdate,
      houseId,
      imagePath,
      position,
      id,
    });
    triggerGlobalRefresh();
    return itemImage as unknown as ItemImage;
  };

  const updateItemImage = async (
    itemImageId: string,
    updates: {
      imagePath?: string | null;
      remotePath?: string | null;
      position?: number;
    },
    _options?: { imageChanged?: boolean }
  ) => {
    const itemImage = await updatePowerSyncLocalItemImage({
      itemImageId,
      imagePath: updates.imagePath,
      remotePath: updates.remotePath,
      position: updates.position,
    });
    triggerGlobalRefresh();
    return itemImage as unknown as ItemImage;
  };

  const deleteItemImage = async (itemImageId: string) => {
    await deletePowerSyncLocalItemImage({ itemImageId });
    triggerGlobalRefresh();
    return itemImageId;
  };

  return {
    itemImages: powerSyncItemImages as unknown as ItemImage[],
    addItemImage,
    updateItemImage,
    deleteItemImage,
  };
}

export function useActiveHouse() {
  const [activeHouseId, setActiveHouseId] = useState<string | null>(globalActiveHouseId);
  const resetting = useDatabaseResetting();
  const powerSyncActiveHouse = usePowerSyncActiveHouseRead(
    !resetting,
    activeHouseId,
    0
  );

  useEffect(() => {
    // Load active house from AsyncStorage
    const loadActiveHouse = async () => {
      try {
        const storedId = await AsyncStorage.getItem('activeHouseId');
        notifyActiveHouseListeners(storedId || null);
      } catch (error) {
        console.error('Error loading active house:', error);
      }
    };

    loadActiveHouse();
  }, []);

  useEffect(() => {
    const listener: ActiveHouseListener = (houseId) => {
      setActiveHouseId(houseId);
    };
    activeHouseListeners.push(listener);
    return () => {
      const index = activeHouseListeners.indexOf(listener);
      if (index > -1) {
        activeHouseListeners.splice(index, 1);
      }
    };
  }, []);
  const setActiveHouseById = async (houseId: string) => {
    try {
      const storedActiveHouseId = await AsyncStorage.getItem('activeHouseId');
      if (houseId === globalActiveHouseId && houseId === storedActiveHouseId) {
        return;
      }
      if (globalActiveHouseId && houseId !== globalActiveHouseId) {
        trackHouseSwitched();
      }
      await AsyncStorage.setItem('activeHouseId', houseId);
      notifyActiveHouseListeners(houseId);
    } catch (error) {
      console.error('Error setting active house:', error);
    }
  };

  const resetDatabase = async () => {
    let powerSyncRemoteHouseIds: string[] = [];
    try {
      const powerSyncDatabase = getPowerSyncDatabase();
      await powerSyncDatabase.waitForReady();
      const remoteHouseRows = await powerSyncDatabase.getAll<{ id: string }>('SELECT id FROM houses');
      powerSyncRemoteHouseIds = remoteHouseRows.map((house) => house.id).filter(Boolean);
    } catch (error) {
      console.warn('Failed to snapshot PowerSync remote houses before reset', error);
    }

    notifyDatabaseResetting(true);
    // Reset local state first
    notifyActiveHouseListeners(null);

    // Safely reset the database inside a writer
    try {
      await softDeleteRemoteHouses(powerSyncRemoteHouseIds);

      await database.write(async () => {
        await database.unsafeResetDatabase();
      });

      // Clear AsyncStorage before reinitializing
      await AsyncStorage.removeItem('activeHouseId');
      await AsyncStorage.removeItem('appInitialized');
      await AsyncStorage.removeItem(INSTALL_DEFAULT_HOUSE_ID_KEY);
      await saveSyncedHouseIds([]);

      await disconnectPowerSync({ clearLocal: true });
      await savePowerSyncHouseSyncStates({});
      const powerSyncHouse = await createPowerSyncLocalHouse({
        name: 'My Home',
        address: null,
        notes: null,
        imagePath: null,
      });
      const newHouseId = powerSyncHouse.id;
      await savePowerSyncLocalDataMigrationStatus({
        state: 'completed',
        startedAt: Date.now(),
        completedAt: Date.now(),
        rowCounts: {
          houses: 1,
          rooms: 0,
          containers: 0,
          boxes: 0,
          items: 0,
          item_images: 0,
          inbox_entries: 0,
        },
      });

      await AsyncStorage.setItem('activeHouseId', newHouseId);
      await AsyncStorage.setItem(INSTALL_DEFAULT_HOUSE_ID_KEY, newHouseId);
      notifyActiveHouseListeners(newHouseId);

      await AsyncStorage.setItem('appInitialized', 'true');
    } finally {
      notifyDatabaseResetting(false);
    }
  };

  useEffect(() => {
    initializeDefaultHouse();
  }, []);

  return {
    activeHouse: powerSyncActiveHouse as unknown as House | null,
    activeHouseId,
    setActiveHouseById,
    resetDatabase,
  };
}

// Global initialization function to prevent multiple calls
let initializationPromise: Promise<void> | null = null;

const initializeDefaultHouse = async () => {
  // Prevent multiple simultaneous initializations
  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    try {
      // Check if app has been initialized globally
      const isInitialized = await AsyncStorage.getItem('appInitialized');

      if (isInitialized === 'true') {
        return;
      }

      // Check if any houses exist
      const houses = await database.collections.get<House>('houses').query().fetch();

      if (houses.length === 0) {
        // Create default house
        await database.write(async () => {
          const house = await database.collections.get<House>('houses').create((h: any) => {
            h.name = 'My Home';
            h.ownerId = null;
            h.address = null;
            h.notes = null;
          });

          // Set as active house
          await AsyncStorage.setItem('activeHouseId', house.id);
          await AsyncStorage.setItem(INSTALL_DEFAULT_HOUSE_ID_KEY, house.id);
          notifyActiveHouseListeners(house.id);
        });
        // Fresh installs must stay offline-first until user explicitly enables sync.
        await saveSyncedHouseIds([]);
      } else {
        // Check if there's an active house set
        const activeHouseId = await AsyncStorage.getItem('activeHouseId');
        if (!activeHouseId) {
          // Set first house as active if none is set
          await AsyncStorage.setItem('activeHouseId', houses[0].id);
          notifyActiveHouseListeners(houses[0].id);
        }
      }

      // Mark app as initialized
      await AsyncStorage.setItem('appInitialized', 'true');
    } catch (error) {
      console.error('Error in initializeDefaultHouse:', error);
    } finally {
      initializationPromise = null;
    }
  })();

  return initializationPromise;
};

// Global refresh key for forcing UI updates after database reset
let globalRefreshKey = 0;
const refreshListeners: ((key: number) => void)[] = [];
let isDatabaseResetting = false;
const databaseResetListeners: ((resetting: boolean) => void)[] = [];

function notifyDatabaseResetting(nextValue: boolean) {
  isDatabaseResetting = nextValue;
  databaseResetListeners.forEach(listener => listener(nextValue));
}

export function useGlobalRefresh() {
  const [refreshKey, setRefreshKey] = useState(globalRefreshKey);

  useEffect(() => {
    const listener = (key: number) => setRefreshKey(key);
    refreshListeners.push(listener);
    return () => {
      const index = refreshListeners.indexOf(listener);
      if (index > -1) {
        refreshListeners.splice(index, 1);
      }
    };
  }, []);

  return refreshKey;
}

export function triggerGlobalRefresh() {
  globalRefreshKey += 1;
  refreshListeners.forEach(listener => listener(globalRefreshKey));
}

export function useDatabaseResetting() {
  const [resetting, setResetting] = useState(isDatabaseResetting);

  useEffect(() => {
    const listener = (value: boolean) => setResetting(value);
    databaseResetListeners.push(listener);
    return () => {
      const index = databaseResetListeners.indexOf(listener);
      if (index > -1) {
        databaseResetListeners.splice(index, 1);
      }
    };
  }, []);

  return resetting;
}

// Similar for rooms and containers
