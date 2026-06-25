import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { database } from '../storage/database';
import { House, Room, Container, Box, Item, ItemImage } from '../storage/models';
import { assertCanAddHouse, assertCanAddItem, assertCanAddStorageUnit } from '../limits';
import { Q } from '@/utils/storage/query';
import { trackHouseSwitched, trackRecordCreated } from '../analytics/AnalyticsProvider';
import { getLegacyItemImageId } from '../itemImages';
import { saveSyncedHouseIds } from '../sync/settingsMetadata';
import {
  removeSpotlightItem,
  reindexAllSpotlightItems,
  upsertSpotlightItemById,
} from '@/src/spotlight/spotlightIndex';
import { usePowerSyncReadModeEnabled } from '@/utils/powersync/readMode';
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
  const [houses, setHouses] = useState<House[]>([]);
  const resetting = useDatabaseResetting();
  const powerSyncReadModeEnabled = usePowerSyncReadModeEnabled();
  const powerSyncHouses = usePowerSyncHousesRead(powerSyncReadModeEnabled && !resetting, refreshKey);

  useEffect(() => {
    if (resetting) {
      setHouses([]);
      return;
    }
    // Clear stale local state whenever we resubscribe
    setHouses([]);

    const subscription = database.collections
      .get<House>('houses')
      .query()
      .observeWithColumns(['name', 'address', 'notes', 'image_path'])
      .subscribe(setHouses);

    return () => subscription.unsubscribe();
  }, [refreshKey, resetting]);

  const addHouse = async (name: string, address?: string, notes?: string, imagePath?: string) => {
    await assertCanAddHouse();
    if (powerSyncReadModeEnabled) {
      const house = await createPowerSyncLocalHouse({
        name,
        address: address || null,
        notes: notes || null,
        imagePath: imagePath || null,
      });
      trackRecordCreated('house', { source: 'hook' });
      return house as unknown as House;
    }

    const house = await database.write(async () => {
      return await database.collections.get<House>('houses').create((house) => {
        house.name = name;
        house.ownerId = null;
        house.address = address || null;
        house.notes = notes || null;
        house.imagePath = imagePath || null;
      });
    });
    trackRecordCreated('house', { source: 'hook' });
    return house;
  };

  const updateHouse = async (houseId: string, name: string, address?: string, notes?: string, imagePath?: string) => {
    if (powerSyncReadModeEnabled) {
      await updatePowerSyncLocalHouse({
        houseId,
        name,
        address: address || null,
        notes: notes || null,
        imagePath,
      });
      await reindexAllSpotlightItems();
      return;
    }

    await database.write(async () => {
      const house = await database.collections.get<House>('houses').find(houseId);
      await house.update((h) => {
        h.name = name;
        h.address = address || null;
        h.notes = notes || null;
        h.imagePath = imagePath || null;
      });
    });
    await reindexAllSpotlightItems();
  };

  const deleteHouse = async (houseId: string) => {
    if (powerSyncReadModeEnabled) {
      await deletePowerSyncLocalHouse({ houseId });
      await reindexAllSpotlightItems();
      return;
    }

    await database.write(async () => {
      const house = await database.collections.get<House>('houses').find(houseId);
      await house.destroyPermanently();
    });
    await reindexAllSpotlightItems();
  };

  return { houses: powerSyncReadModeEnabled ? powerSyncHouses as unknown as House[] : houses, addHouse, updateHouse, deleteHouse };
}

export function useRooms(houseId?: string, refreshKey?: number) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const resetting = useDatabaseResetting();
  const powerSyncReadModeEnabled = usePowerSyncReadModeEnabled();
  const powerSyncRooms = usePowerSyncRoomsRead(powerSyncReadModeEnabled && !resetting, houseId, refreshKey);

  useEffect(() => {
    if (resetting) {
      setRooms([]);
      return;
    }
    const conditions = [];
    if (houseId) {
      conditions.push(Q.where('house_id', houseId));
    }

    const query = database.collections.get<Room>('rooms').query(...conditions);
    const subscription = query.observeWithColumns(['name', 'description', 'image_path', 'house_id']).subscribe((newRooms) => {
      setRooms(newRooms);
    });
    return () => subscription.unsubscribe();
  }, [houseId, refreshKey, resetting]);

  const addRoom = async (houseId: string, name: string, description?: string, imagePath?: string) => {
    await assertCanAddStorageUnit();
    if (powerSyncReadModeEnabled) {
      const room = await createPowerSyncLocalRoom({
        houseId,
        name,
        description: description || null,
        imagePath: imagePath || null,
      });
      trackRecordCreated('room', { source: 'hook' });
      return room as unknown as Room;
    }

    const room = await database.write(async () => {
      const room = await database.collections.get<Room>('rooms').create((room) => {
        room.houseId = houseId;
        room.name = name;
        room.description = description || null;
        room.imagePath = imagePath || null;
      });
      return room;
    });
    trackRecordCreated('room', { source: 'hook' });
    return room;
  };

  const updateRoom = async (roomId: string, name: string, description?: string, imagePath?: string) => {
    if (powerSyncReadModeEnabled) {
      await updatePowerSyncLocalRoom({
        roomId,
        name,
        description: description || null,
        imagePath,
      });
      await reindexAllSpotlightItems();
      return;
    }

    await database.write(async () => {
      const room = await database.collections.get<Room>('rooms').find(roomId);
      await room.update((r) => {
        r.name = name;
        r.description = description || null;
        r.imagePath = imagePath || null;
      });
    });
    await reindexAllSpotlightItems();
  };

  const deleteRoom = async (roomId: string) => {
    if (powerSyncReadModeEnabled) {
      await deletePowerSyncLocalRoom({ roomId });
      await reindexAllSpotlightItems();
      return;
    }

    await database.write(async () => {
      const room = await database.collections.get<Room>('rooms').find(roomId);
      await room.destroyPermanently();
    });
    await reindexAllSpotlightItems();
  };

  return { rooms: powerSyncReadModeEnabled ? powerSyncRooms as unknown as Room[] : rooms, addRoom, updateRoom, deleteRoom };
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
  const [containers, setContainers] = useState<Container[]>([]);
  const resetting = useDatabaseResetting();
  const fallbackRoomIds = options?.fallbackRoomIds;
  const powerSyncReadModeEnabled = usePowerSyncReadModeEnabled();
  const powerSyncContainers = usePowerSyncContainersRead(
    powerSyncReadModeEnabled && !resetting,
    houseId,
    roomId,
    refreshKey,
    fallbackRoomIds
  );

  useEffect(() => {
    if (resetting) {
      setContainers([]);
      return;
    }
    const fallbackRoomIdsArray = fallbackRoomIds ?? [];
    const shouldFilterByHouse = !!houseId && !roomId && fallbackRoomIdsArray.length === 0;
    const conditions = [];
    if (roomId) {
      conditions.push(Q.where('room_id', roomId));
    } else if (shouldFilterByHouse) {
      conditions.push(Q.where('house_id', houseId));
    }

    const query = database.collections.get<Container>('containers').query(...conditions);
    const subscription = query.observeWithColumns(['name', 'description', 'image_path', 'house_id', 'room_id']).subscribe((newContainers) => {
      const filtered = newContainers.filter((container) => {
        if (roomId) {
          return container.roomId === roomId;
        }
        if (houseId && container.houseId === houseId) {
          return true;
        }
        if (fallbackRoomIdsArray.length > 0 && fallbackRoomIdsArray.includes(container.roomId)) {
          return true;
        }
        return !houseId && fallbackRoomIdsArray.length === 0;
      });
      setContainers(filtered);
    });
    return () => subscription.unsubscribe();
  }, [fallbackRoomIds, houseId, refreshKey, roomId, resetting]);

  const addContainer = async (houseId: string, roomId: string, name: string, description?: string, imagePath?: string) => {
    await assertCanAddStorageUnit();
    if (powerSyncReadModeEnabled) {
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
    }

    const container = await database.write(async () => {
      return await database.collections.get<Container>('containers').create((container) => {
        container.houseId = houseId;
        container.roomId = roomId;
        container.name = name;
        container.description = description || null;
        container.imagePath = imagePath || null;
      });
    });
    trackRecordCreated('container', { source: 'hook' });
    return container;
  };

  const updateContainer = async (containerId: string, name: string, description?: string, imagePath?: string) => {
    if (powerSyncReadModeEnabled) {
      await updatePowerSyncLocalContainer({
        containerId,
        name,
        description: description || null,
        imagePath,
      });
      await reindexAllSpotlightItems();
      triggerGlobalRefresh();
      return;
    }

    await database.write(async () => {
      const container = await database.collections.get<Container>('containers').find(containerId);
      await container.update((c) => {
        c.name = name;
        c.description = description || null;
        c.imagePath = imagePath || null;
      });
    });
    await reindexAllSpotlightItems();
  };

  const deleteContainer = async (containerId: string) => {
    if (powerSyncReadModeEnabled) {
      await deletePowerSyncLocalContainer({ containerId });
      await reindexAllSpotlightItems();
      triggerGlobalRefresh();
      return;
    }

    await database.write(async () => {
      const container = await database.collections.get<Container>('containers').find(containerId);
      await container.destroyPermanently();
    });
    await reindexAllSpotlightItems();
  };

  return {
    containers: powerSyncReadModeEnabled ? powerSyncContainers as unknown as Container[] : containers,
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
  const [boxes, setBoxes] = useState<Box[]>([]);
  const resetting = useDatabaseResetting();
  const fallbackRoomIds = options?.fallbackRoomIds;
  const fallbackContainerIds = options?.fallbackContainerIds;
  const powerSyncReadModeEnabled = usePowerSyncReadModeEnabled();
  const powerSyncBoxes = usePowerSyncBoxesRead(
    powerSyncReadModeEnabled && !resetting,
    houseId,
    parentType,
    parentId,
    refreshKey,
    fallbackRoomIds,
    fallbackContainerIds
  );

  useEffect(() => {
    if (resetting) {
      setBoxes([]);
      return;
    }
    const fallbackRoomIdsArray = fallbackRoomIds ?? [];
    const fallbackContainerIdsArray = fallbackContainerIds ?? [];
    const isParentScope = Boolean(parentType && parentId);
    const shouldFilterByHouse =
      !!houseId &&
      !isParentScope &&
      fallbackRoomIdsArray.length === 0 &&
      fallbackContainerIdsArray.length === 0;

    const conditions = [];
    if (isParentScope) {
      conditions.push(Q.where('parent_type', parentType!));
      conditions.push(Q.where('parent_id', parentId!));
    } else if (shouldFilterByHouse) {
      conditions.push(Q.where('house_id', houseId!));
    }

    const query = database.collections.get<Box>('boxes').query(...conditions);
    const subscription = query.observeWithColumns(['name', 'description', 'image_path', 'house_id', 'parent_type', 'parent_id']).subscribe((newBoxes) => {
      const filtered = newBoxes.filter((box) => {
        if (isParentScope) {
          return box.parentType === parentType && box.parentId === parentId;
        }
        if (houseId && box.houseId === houseId) {
          return true;
        }
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

      setBoxes(filtered);
    });
    return () => subscription.unsubscribe();
  }, [
    fallbackContainerIds,
    fallbackRoomIds,
    houseId,
    parentId,
    parentType,
    refreshKey,
    resetting,
  ]);

  const addBox = async (houseId: string, name: string, description: string, parentType?: string, parentId?: string, imagePath?: string) => {
    await assertCanAddStorageUnit();
    if (powerSyncReadModeEnabled) {
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
    }

    const box = await database.write(async () => {
      return await database.collections.get<Box>('boxes').create((box) => {
        box.houseId = houseId;
        box.name = name;
        box.description = description;
        box.parentType = parentType || null;
        box.parentId = parentId || null;
        box.imagePath = imagePath || null;
        box.tags = '';
      });
    });
    trackRecordCreated('box', { source: 'hook' });
    return box;
  };

  const updateBox = async (boxId: string, name: string, description: string, imagePath?: string) => {
    if (powerSyncReadModeEnabled) {
      await updatePowerSyncLocalBox({
        boxId,
        name,
        description,
        imagePath,
      });
      await reindexAllSpotlightItems();
      return;
    }

    await database.write(async () => {
      const box = await database.collections.get<Box>('boxes').find(boxId);
      await box.update((b) => {
        b.name = name;
        b.description = description;
        b.imagePath = imagePath || null;
      });
    });
    await reindexAllSpotlightItems();
  };

  const deleteBox = async (boxId: string) => {
    if (powerSyncReadModeEnabled) {
      await deletePowerSyncLocalBox({ boxId });
      await reindexAllSpotlightItems();
      return;
    }

    await database.write(async () => {
      const box = await database.collections.get<Box>('boxes').find(boxId);
      await box.destroyPermanently();
    });
    await reindexAllSpotlightItems();
  };

  return { boxes: powerSyncReadModeEnabled ? powerSyncBoxes as unknown as Box[] : boxes, addBox, updateBox, deleteBox };
}

export function useItems(houseId?: string, parentType?: string, parentId?: string, refreshKey?: number) {
  const [items, setItems] = useState<Item[]>([]);
  const resetting = useDatabaseResetting();
  const powerSyncReadModeEnabled = usePowerSyncReadModeEnabled();
  const powerSyncItems = usePowerSyncItemsRead(
    powerSyncReadModeEnabled && !resetting,
    houseId,
    parentType,
    parentId,
    refreshKey
  );

  useEffect(() => {
    if (resetting) {
      setItems([]);
      return;
    }
    const conditions = [];
    if (houseId) {
      conditions.push(Q.where('house_id', houseId));
    }
    if (parentType && parentId) {
      conditions.push(Q.where('parent_type', parentType));
      conditions.push(Q.where('parent_id', parentId));
    }

    const query = database.collections.get<Item>('items').query(...conditions);
    const subscription = query
      .observeWithColumns(['name', 'description', 'image_path', 'house_id', 'parent_type', 'parent_id', 'tags'])
      .subscribe(setItems);
    return () => subscription.unsubscribe();
  }, [houseId, parentType, parentId, refreshKey, resetting]);

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
    if (powerSyncReadModeEnabled) {
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
    }

    const item = await database.write(async () => {
      return await database.collections.get<Item>('items').create((item) => {
        item.houseId = houseId;
        item.name = name;
        item.description = description;
        item.parentType = parentType || null;
        item.parentId = parentId || null;
        item.imagePath = imagePath || null;
        item.tags = tags || '';
        item.purchasePriceCents = purchasePriceCents ?? null;
        item.notes = notes || null;
      });
    });
    await upsertSpotlightItemById(item.id);
    trackRecordCreated('item', { source: 'hook' });
    return item;
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
    let updatedItemId: string | null = null;
    if (powerSyncReadModeEnabled) {
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
      return;
    }

    await database.write(async () => {
      const item = await database.collections.get<Item>('items').find(itemId);
      await item.update((i) => {
        i.name = name;
        i.description = description;
        i.imagePath = imagePath || null;
        if (tags !== undefined) {
          i.tags = tags;
        }
        if (purchasePriceCents !== undefined) {
          i.purchasePriceCents = purchasePriceCents ?? null;
        }
        if (notes !== undefined) {
          i.notes = notes || null;
        }
      });
      updatedItemId = item.id;
    });
    if (updatedItemId) {
      await upsertSpotlightItemById(updatedItemId);
    }
  };

  const deleteItem = async (itemId: string) => {
    let deletedItemId: string | null = null;
    if (powerSyncReadModeEnabled) {
      await deletePowerSyncLocalItem({ itemId });
      await removeSpotlightItem(itemId);
      return;
    }

    await database.write(async () => {
      const item = await database.collections.get<Item>('items').find(itemId);
      const itemImages = await database.collections
        .get<ItemImage>('item_images')
        .query(Q.where('item_id', itemId))
        .fetch();
      for (const itemImage of itemImages) {
        await itemImage.destroyPermanently();
      }
      deletedItemId = item.id;
      await item.destroyPermanently();
    });
    if (deletedItemId) {
      await removeSpotlightItem(deletedItemId);
    }
  };

  return { items: powerSyncReadModeEnabled ? powerSyncItems as unknown as Item[] : items, addItem, updateItem, deleteItem };
}

export function useItemImages(itemId?: string, refreshKey?: number) {
  const [itemImages, setItemImages] = useState<ItemImage[]>([]);
  const resetting = useDatabaseResetting();
  const powerSyncReadModeEnabled = usePowerSyncReadModeEnabled();
  const powerSyncItemImages = usePowerSyncItemImagesRead(
    powerSyncReadModeEnabled && !resetting,
    itemId,
    refreshKey
  );

  useEffect(() => {
    if (resetting || !itemId) {
      setItemImages([]);
      return;
    }

    const query = database.collections
      .get<ItemImage>('item_images')
      .query(Q.where('item_id', itemId), Q.sortBy('position', Q.asc));
    const subscription = query.observe().subscribe(setItemImages);
    return () => subscription.unsubscribe();
  }, [itemId, refreshKey, resetting]);

  const addItemImage = async (
    itemIdToUpdate: string,
    houseId: string,
    imagePath: string,
    position: number,
    id?: string
  ) => {
    if (powerSyncReadModeEnabled) {
      const itemImage = await createPowerSyncLocalItemImage({
        itemId: itemIdToUpdate,
        houseId,
        imagePath,
        position,
        id,
      });
      triggerGlobalRefresh();
      return itemImage as unknown as ItemImage;
    }

    const itemImage = await database.write(async () => {
      return await database.collections.get<ItemImage>('item_images').create((image) => {
        if (id || position === 0) {
          image._raw.id = id ?? getLegacyItemImageId(itemIdToUpdate);
        }
        image.itemId = itemIdToUpdate;
        image.houseId = houseId;
        image.imagePath = imagePath;
        image.remotePath = null;
        image.position = position;
      });
    });
    return itemImage;
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
    if (powerSyncReadModeEnabled) {
      const itemImage = await updatePowerSyncLocalItemImage({
        itemImageId,
        imagePath: updates.imagePath,
        remotePath: updates.remotePath,
        position: updates.position,
      });
      triggerGlobalRefresh();
      return itemImage as unknown as ItemImage;
    }

    let itemImage: ItemImage | null = null;
    await database.write(async () => {
      const record = await database.collections.get<ItemImage>('item_images').find(itemImageId);
      await record.update((image) => {
        if (updates.imagePath !== undefined) image.imagePath = updates.imagePath;
        if (updates.remotePath !== undefined) image.remotePath = updates.remotePath;
        if (updates.position !== undefined) image.position = updates.position;
      });
      itemImage = record;
    });
    return itemImage;
  };

  const deleteItemImage = async (itemImageId: string) => {
    if (powerSyncReadModeEnabled) {
      await deletePowerSyncLocalItemImage({ itemImageId });
      triggerGlobalRefresh();
      return itemImageId;
    }

    let deletedImage: { id: string; houseId: string; itemId: string; position: number; remotePath: string | null } | null = null;
    await database.write(async () => {
      const record = await database.collections.get<ItemImage>('item_images').find(itemImageId);
      deletedImage = {
        id: record.id,
        houseId: record.houseId,
        itemId: record.itemId,
        position: record.position,
        remotePath: record.remotePath ?? null,
      };
      await record.destroyPermanently();
    });
    const deletedImageId = deletedImage ? (deletedImage as { id: string }).id : null;
    return deletedImageId;
  };

  return {
    itemImages: powerSyncReadModeEnabled ? powerSyncItemImages as unknown as ItemImage[] : itemImages,
    addItemImage,
    updateItemImage,
    deleteItemImage,
  };
}

export function useActiveHouse() {
  const [activeHouseId, setActiveHouseId] = useState<string | null>(globalActiveHouseId);
  const [activeHouse, setActiveHouse] = useState<House | null>(null);
  const resetting = useDatabaseResetting();
  const powerSyncReadModeEnabled = usePowerSyncReadModeEnabled();
  const powerSyncActiveHouse = usePowerSyncActiveHouseRead(
    powerSyncReadModeEnabled && !resetting,
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

  useEffect(() => {
    // Load house data when activeHouseId changes
    if (resetting) {
      setActiveHouse(null);
      return;
    }
    if (powerSyncReadModeEnabled) {
      setActiveHouse(null);
      return;
    }
    if (activeHouseId) {
      const housesCollection = database.collections.get<House>('houses');
      const subscription = housesCollection
        .findAndObserve(activeHouseId)
        .subscribe(
          setActiveHouse,
          async (error) => {
            console.warn('Active house observation failed', error);
            setActiveHouse(null);
            try {
              const houses = await housesCollection.query().fetch();
              if (!houses.length) {
                await AsyncStorage.removeItem('activeHouseId');
                notifyActiveHouseListeners(null);
                return;
              }
              const fallbackId = houses[0].id;
              await AsyncStorage.setItem('activeHouseId', fallbackId);
              notifyActiveHouseListeners(fallbackId);
            } catch (fallbackError) {
              console.warn('Failed to recover active house after observation error', fallbackError);
              await AsyncStorage.removeItem('activeHouseId');
              notifyActiveHouseListeners(null);
            }
          }
        );

      return () => subscription.unsubscribe();
    } else {
      setActiveHouse(null);
    }
  }, [activeHouseId, powerSyncReadModeEnabled, resetting]);

  useEffect(() => {
    if (resetting) return;
    if (powerSyncReadModeEnabled) return;

    let cancelled = false;
    const reconcileActiveHouseId = async (houses: House[]) => {
      if (cancelled) return;
      if (!houses.length) {
        if (activeHouseId !== null) {
          notifyActiveHouseListeners(null);
        }
        return;
      }

      const hasCurrentActive = activeHouseId ? houses.some((house) => house.id === activeHouseId) : false;
      if (hasCurrentActive) {
        return;
      }

      try {
        const storedId = await AsyncStorage.getItem('activeHouseId');
        const nextId =
          storedId && houses.some((house) => house.id === storedId) ? storedId : houses[0].id;
        if (nextId === activeHouseId) {
          return;
        }
        await AsyncStorage.setItem('activeHouseId', nextId);
        notifyActiveHouseListeners(nextId);
      } catch (error) {
        console.error('Failed to reconcile active house id', error);
      }
    };

    const subscription = database.collections
      .get<House>('houses')
      .query()
      .observe()
      .subscribe((houses) => {
        void reconcileActiveHouseId(houses);
      });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [activeHouseId, powerSyncReadModeEnabled, resetting]);

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
    if (powerSyncReadModeEnabled) {
      try {
        const powerSyncDatabase = getPowerSyncDatabase();
        await powerSyncDatabase.waitForReady();
        const remoteHouseRows = await powerSyncDatabase.getAll<{ id: string }>('SELECT id FROM houses');
        powerSyncRemoteHouseIds = remoteHouseRows.map((house) => house.id).filter(Boolean);
      } catch (error) {
        console.warn('Failed to snapshot PowerSync remote houses before reset', error);
      }
    }

    notifyDatabaseResetting(true);
    // Reset local state first
    notifyActiveHouseListeners(null);
    setActiveHouse(null);

    // Safely reset the database inside a writer
    try {
      if (powerSyncReadModeEnabled) {
        await softDeleteRemoteHouses(powerSyncRemoteHouseIds);
      }

      await database.write(async () => {
        await database.unsafeResetDatabase();
      });

      // Clear AsyncStorage before reinitializing
      await AsyncStorage.removeItem('activeHouseId');
      await AsyncStorage.removeItem('appInitialized');
      await AsyncStorage.removeItem(INSTALL_DEFAULT_HOUSE_ID_KEY);
      await saveSyncedHouseIds([]);

      let newLegacyHouseId: string | null = null;
      await database.write(async () => {
        const house = await database.collections.get<House>('houses').create((h) => {
          h.name = 'My Home';
          h.ownerId = null;
          h.address = null;
          h.notes = null;
          h.imagePath = null;
        });
        newLegacyHouseId = house.id;
      });

      let newHouseId = newLegacyHouseId;
      if (powerSyncReadModeEnabled) {
        await disconnectPowerSync({ clearLocal: true });
        await savePowerSyncHouseSyncStates({});
        const powerSyncHouse = await createPowerSyncLocalHouse({
          name: 'My Home',
          address: null,
          notes: null,
          imagePath: null,
        });
        newHouseId = powerSyncHouse.id;
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
      }

      if (newHouseId) {
        await AsyncStorage.setItem('activeHouseId', newHouseId);
        await AsyncStorage.setItem(INSTALL_DEFAULT_HOUSE_ID_KEY, newHouseId);
        notifyActiveHouseListeners(newHouseId);
      }

      await AsyncStorage.setItem('appInitialized', 'true');
    } finally {
      notifyDatabaseResetting(false);
    }
  };

  useEffect(() => {
    initializeDefaultHouse();
  }, []);

  return {
    activeHouse: powerSyncReadModeEnabled ? powerSyncActiveHouse as unknown as House | null : activeHouse,
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
          const house = await database.collections.get<House>('houses').create((h) => {
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
