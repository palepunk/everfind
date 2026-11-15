import { Platform, NativeEventEmitter, NativeModules } from 'react-native';
import { loadSpotlightItemsEnabled } from '@/utils/spotlightPreference';
import {
  getPowerSyncRepositoryBoxes,
  getPowerSyncRepositoryContainers,
  getPowerSyncRepositoryHouses,
  getPowerSyncRepositoryItems,
  getPowerSyncRepositoryRooms,
  type PowerSyncRepositoryBox,
  type PowerSyncRepositoryContainer,
  type PowerSyncRepositoryHouse,
  type PowerSyncRepositoryItem,
  type PowerSyncRepositoryRoom,
} from '@/utils/powersync/repository';

export type SpotlightItemPayload = {
  id: string;
  name: string;
  locationPath: string;
  updatedAt?: number;
};

type SpotlightBridge = {
  upsertItem: (payload: SpotlightItemPayload) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  reindexAll: (payloads: SpotlightItemPayload[]) => Promise<void>;
  clearIndex: () => Promise<void>;
  consumePendingURL?: () => Promise<string | null>;
};

const bridge = NativeModules.EverfindSpotlightBridge as SpotlightBridge | undefined;
const spotlightEventEmitter =
  Platform.OS === 'ios' && bridge ? new NativeEventEmitter(bridge as never) : null;

const devLog = (message: string, payload?: unknown) => {
  if (!__DEV__) return;
  if (payload === undefined) {
    console.log(`[Spotlight] ${message}`);
    return;
  }
  console.log(`[Spotlight] ${message}`, payload);
};

const isIosWithBridge = () => Platform.OS === 'ios' && Boolean(bridge);

const canIndex = async () => {
  if (!isIosWithBridge()) return false;
  return await loadSpotlightItemsEnabled();
};

const splitRoutePath = (path: string) =>
  path
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);

const joinPath = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' > ');

const buildPowerSyncPayloadFromItem = (
  item: PowerSyncRepositoryItem,
  context: {
    houses: PowerSyncRepositoryHouse[];
    rooms: PowerSyncRepositoryRoom[];
    containers: PowerSyncRepositoryContainer[];
    boxes: PowerSyncRepositoryBox[];
  }
) => {
  const house = context.houses.find((candidate) => candidate.id === item.houseId);
  if (!house?.name) return null;

  const parentParts: string[] = [];
  if (item.parentType === 'room' && item.parentId) {
    const room = context.rooms.find((candidate) => candidate.id === item.parentId);
    if (room?.name) parentParts.push(room.name);
  } else if (item.parentType === 'container' && item.parentId) {
    const container = context.containers.find((candidate) => candidate.id === item.parentId);
    const room = context.rooms.find((candidate) => candidate.id === container?.roomId);
    if (room?.name) parentParts.push(room.name);
    if (container?.name) parentParts.push(container.name);
  } else if (item.parentType === 'box' && item.parentId) {
    const box = context.boxes.find((candidate) => candidate.id === item.parentId);
    if (box?.parentType === 'container' && box.parentId) {
      const container = context.containers.find((candidate) => candidate.id === box.parentId);
      const room = context.rooms.find((candidate) => candidate.id === container?.roomId);
      if (room?.name) parentParts.push(room.name);
      if (container?.name) parentParts.push(container.name);
    } else if (box?.parentType === 'room' && box.parentId) {
      const room = context.rooms.find((candidate) => candidate.id === box.parentId);
      if (room?.name) parentParts.push(room.name);
    }
    if (box?.name) parentParts.push(box.name);
  }

  return normalizePayload({
    id: item.id,
    name: item.name,
    locationPath: joinPath(house.name, ...parentParts),
  });
};

const buildPowerSyncSpotlightPayloads = async () => {
  const [houses, rooms, containers, boxes, items] = await Promise.all([
    getPowerSyncRepositoryHouses(),
    getPowerSyncRepositoryRooms(),
    getPowerSyncRepositoryContainers(),
    getPowerSyncRepositoryBoxes(),
    getPowerSyncRepositoryItems(),
  ]);
  const context = { houses, rooms, containers, boxes };
  return items
    .map((item) => buildPowerSyncPayloadFromItem(item, context))
    .filter((payload): payload is SpotlightItemPayload => Boolean(payload));
};

const normalizePayload = (payload: SpotlightItemPayload): SpotlightItemPayload | null => {
  const id = payload.id?.trim();
  const name = payload.name?.trim();
  const locationPath = payload.locationPath?.trim();
  if (!id || !name || !locationPath) return null;
  return { id, name, locationPath };
};

export const isSpotlightAvailable = () => isIosWithBridge();

export const upsertSpotlightItem = async (payload: SpotlightItemPayload) => {
  if (!(await canIndex())) return;
  const normalized = normalizePayload(payload);
  if (!normalized) return;
  try {
    await bridge!.upsertItem(normalized);
  } catch (error) {
    devLog('upsertItem failed', error);
  }
};

export const removeSpotlightItem = async (itemId: string) => {
  if (!isIosWithBridge()) return;
  const id = itemId?.trim();
  if (!id) return;
  try {
    await bridge!.deleteItem(id);
  } catch (error) {
    devLog('deleteItem failed', error);
  }
};

export const clearSpotlightIndex = async () => {
  if (!isIosWithBridge()) return;
  try {
    await bridge!.clearIndex();
  } catch (error) {
    devLog('clearIndex failed', error);
  }
};

export const reindexAllSpotlightItems = async (payloads?: SpotlightItemPayload[]) => {
  if (!isIosWithBridge()) return;
  if (!(await canIndex())) {
    await clearSpotlightIndex();
    return;
  }

  const allPayloads =
    payloads ??
    (await buildAllSpotlightPayloads()).filter(
      (entry): entry is SpotlightItemPayload => Boolean(entry)
    );
  try {
    await bridge!.reindexAll(allPayloads);
  } catch (error) {
    devLog('reindexAll failed', error);
  }
};

export const upsertSpotlightItemById = async (itemId: string) => {
  if (!(await canIndex())) return;
  try {
    const items = await getPowerSyncRepositoryItems();
    const item = items.find((candidate) => candidate.id === itemId);
    if (!item) {
      await bridge!.deleteItem(itemId);
      return;
    }
    const [houses, rooms, containers, boxes] = await Promise.all([
      getPowerSyncRepositoryHouses(),
      getPowerSyncRepositoryRooms(),
      getPowerSyncRepositoryContainers(),
      getPowerSyncRepositoryBoxes(),
    ]);
    const payload = buildPowerSyncPayloadFromItem(item, { houses, rooms, containers, boxes });
    if (!payload) return;
    await bridge!.upsertItem(payload);
  } catch (error) {
    devLog('upsertSpotlightItemById failed', { itemId, error });
  }
};

export const buildAllSpotlightPayloads = async () => {
  return buildPowerSyncSpotlightPayloads();
};

export const consumePendingSpotlightURL = async () => {
  if (!isIosWithBridge() || typeof bridge?.consumePendingURL !== 'function') return null;
  try {
    return await bridge.consumePendingURL();
  } catch (error) {
    devLog('consumePendingURL failed', error);
    return null;
  }
};

export const addSpotlightURLListener = (listener: (url: string) => void) => {
  if (!spotlightEventEmitter) {
    return { remove: () => undefined };
  }

  const subscription = spotlightEventEmitter.addListener(
    'spotlightURL',
    (event: { url?: string } | undefined) => {
      if (typeof event?.url === 'string' && event.url) {
        listener(event.url);
      }
    }
  );

  return {
    remove: () => subscription.remove(),
  };
};

export const normalizeSpotlightDeepLinkItemId = (url: string) => {
  try {
    const parsed = new URL(url);
    const normalizedProtocol = parsed.protocol.toLowerCase();
    if (!normalizedProtocol.startsWith('everfind')) return null;

    const path = parsed.pathname.replace(/^\/+/, '');
    const [first, second] = splitRoutePath(path);
    if (first === 'items' && second) {
      return decodeURIComponent(second);
    }

    if (parsed.host === 'items' && first) {
      return decodeURIComponent(first);
    }

    return null;
  } catch {
    return null;
  }
};
