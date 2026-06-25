/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadWithMocks } = require('./helpers/moduleMocks');

const mutationsPath = path.resolve(__dirname, '../utils/powersync/mutations.ts');
const imageUploadQueuePath = path.resolve(__dirname, '../utils/powersync/imageUploadQueue.ts');
const imageUploadPath = path.resolve(__dirname, '../utils/powersync/imageUpload.ts');

const flushAsyncWork = () => new Promise((resolve) => setImmediate(resolve));

const createMutationModule = ({
  houseRows = [],
  roomRows = [],
  containerRows = [],
  boxRows = [],
  itemRows = [],
  itemImageRows = [],
  powerSyncHouseSyncStates = {},
} = {}) => {
  const executed = [];
  const markedLocalOnly = [];
  const imageUploads = [];
  const remoteImageDeletes = [];
  const queuedImageUploads = [];
  const queuedImageDeletes = [];
  const houseSyncStates = powerSyncHouseSyncStates;
  const database = {
    async getOptional(sql, parameters) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.includes('FROM houses')) {
        const row = houseRows.find((house) => house.id === parameters[0]);
        if (normalized.startsWith('SELECT id FROM houses')) {
          return row?.syncedHouseRow ? { id: row.id } : null;
        }
        return row ? { image_path: row.image_path ?? null } : null;
      }
      if (normalized.includes('FROM rooms')) {
        const row = roomRows.find((room) => room.id === parameters[0]);
        return row ? { image_path: row.remoteImagePath ?? row.imagePath ?? null } : null;
      }
      if (normalized.includes('FROM containers')) {
        const row = containerRows.find((container) => container.id === parameters[0]);
        return row ? { image_path: row.imagePath ?? null } : null;
      }
      if (normalized.includes('FROM boxes')) {
        const row = boxRows.find((box) => box.id === parameters[0]);
        return row ? { image_path: row.imagePath ?? null } : null;
      }
      if (normalized.includes('FROM items')) {
        const row = itemRows.find((item) => item.id === parameters[0]);
        return row ? { image_path: row.imagePath ?? null } : null;
      }
      return null;
    },
    async writeTransaction(callback) {
      return callback({
        async execute(sql, parameters) {
          executed.push({ sql: sql.replace(/\s+/g, ' ').trim(), parameters });
        },
      });
    },
  };

  const module = loadWithMocks(mutationsPath, {
    'expo-crypto': {
      randomUUID: () => 'generated-id',
    },
    './system': {
      getPowerSyncDatabase: () => database,
    },
    './metadata': {
      loadPowerSyncHouseSyncStates: async () => houseSyncStates,
      markPowerSyncHousesLocalOnly: async (houseIds) => {
        markedLocalOnly.push(...houseIds);
      },
    },
    '@/utils/sync/settingsMetadata': {
      loadSyncedHouseIds: async () =>
        Object.entries(houseSyncStates)
          .filter(([, state]) => state === 'legacy_synced')
          .map(([houseId]) => houseId),
    },
    './imageUpload': {
      uploadPowerSyncImageIfNeeded: async ({ table, houseId, id, imagePath }) => {
        imageUploads.push({ table, houseId, id, imagePath });
        return imagePath ? `houses/${houseId}/${table === 'item_images' ? 'item-images' : table}/${id}` : null;
      },
      deletePowerSyncRemoteImageIfNeeded: async (remotePath) => {
        remoteImageDeletes.push(remotePath);
      },
    },
    './imageUploadQueue': {
      enqueueAndProcessPowerSyncImageUpload: async ({ table, houseId, id, imagePath }) => {
        queuedImageUploads.push({ table, houseId, id, imagePath });
      },
      enqueueAndProcessPowerSyncImageDelete: async ({ remotePath }) => {
        queuedImageDeletes.push({ remotePath });
      },
    },
    './repository': {
      getPowerSyncRepositoryHouseById: async (_database, houseId) =>
        houseRows.find((house) => house.id === houseId) ?? null,
      getPowerSyncRepositoryRooms: async (_database, houseId) =>
        roomRows.filter((room) => !houseId || room.houseId === houseId),
      getPowerSyncRepositoryContainers: async (_database, houseId) =>
        containerRows.filter((container) => !houseId || container.houseId === houseId),
      getPowerSyncRepositoryBoxes: async (_database, houseId) =>
        boxRows.filter((box) => !houseId || box.houseId === houseId),
      getPowerSyncRepositoryItems: async (_database, houseId) =>
        itemRows.filter((item) => !houseId || item.houseId === houseId),
      getPowerSyncRepositoryItemImages: async (_database, itemId) =>
        itemImageRows.filter((itemImage) => !itemId || itemImage.itemId === itemId),
    },
  });

  return { ...module, database, executed, markedLocalOnly, imageUploads, remoteImageDeletes, queuedImageUploads, queuedImageDeletes };
};

test('createPowerSyncLocalHouse writes local house and marks it local-only', async () => {
  const { createPowerSyncLocalHouse, executed, markedLocalOnly } = createMutationModule({
    houseRows: [
      {
        source: 'local',
        id: 'generated-id',
        name: 'New Home',
        owner_id: null,
        address: null,
        notes: null,
        image_path: null,
      },
    ],
  });

  const house = await createPowerSyncLocalHouse({ name: 'New Home' });

  assert.equal(house.id, 'generated-id');
  assert.equal(house.name, 'New Home');
  assert.deepEqual(markedLocalOnly, ['generated-id']);
  assert.equal(executed.length, 2);
  assert.ok(executed[0].sql.includes('DELETE FROM local_metadata'));
  assert.ok(executed[1].sql.includes('INSERT INTO local_houses'));
  assert.deepEqual(executed[1].parameters.slice(0, 3), ['generated-id', 'New Home', null]);
});

test('updatePowerSyncLocalRoom overlays existing room in local table', async () => {
  const { updatePowerSyncLocalRoom, executed } = createMutationModule({
    roomRows: [
      {
        id: 'room-1',
        houseId: 'house-1',
        name: 'Old Room',
        description: null,
        imagePath: null,
        createdBy: null,
        updatedBy: null,
      },
      {
        id: 'room-1',
        houseId: 'house-1',
        name: 'Updated Room',
        description: 'Notes',
        imagePath: 'room.jpg',
        createdBy: null,
        updatedBy: null,
      },
    ],
  });

  const room = await updatePowerSyncLocalRoom({
    roomId: 'room-1',
    name: 'Updated Room',
    description: 'Notes',
    imagePath: 'room.jpg',
  });

  assert.equal(room.id, 'room-1');
  assert.ok(executed[0].sql.includes('DELETE FROM local_metadata'));
  assert.ok(executed[1].sql.includes('INSERT OR REPLACE INTO local_rooms'));
  assert.deepEqual(executed[1].parameters.slice(0, 5), [
    'room-1',
    'house-1',
    'Updated Room',
    'Notes',
    'room.jpg',
  ]);
});

test('createPowerSyncLocalRoom mirrors writes for synced houses', async () => {
  const { createPowerSyncLocalRoom, executed } = createMutationModule({
    powerSyncHouseSyncStates: { 'house-1': 'synced' },
    roomRows: [
      {
        id: 'generated-id',
        houseId: 'house-1',
        name: 'Kitchen',
        description: null,
        imagePath: null,
        createdBy: null,
        updatedBy: null,
      },
    ],
  });

  await createPowerSyncLocalRoom({ houseId: 'house-1', name: 'Kitchen' });

  assert.ok(executed.some((entry) => entry.sql.includes('INSERT INTO local_rooms')));
  assert.ok(executed.some((entry) => entry.sql.includes('INSERT INTO rooms')));
});

test('createPowerSyncLocalRoom uploads image for synced houses and keeps local mirror path', async () => {
  const { createPowerSyncLocalRoom, executed, queuedImageUploads } = createMutationModule({
    powerSyncHouseSyncStates: { 'house-1': 'synced' },
    roomRows: [
      {
        id: 'generated-id',
        houseId: 'house-1',
        name: 'Kitchen',
        description: null,
        imagePath: 'local-room.jpg',
        createdBy: null,
        updatedBy: null,
      },
    ],
  });

  await createPowerSyncLocalRoom({ houseId: 'house-1', name: 'Kitchen', imagePath: 'local-room.jpg' });

  await flushAsyncWork();
  assert.deepEqual(queuedImageUploads, [
    {
      table: 'rooms',
      houseId: 'house-1',
      id: 'generated-id',
      imagePath: 'local-room.jpg',
    },
  ]);
  const localInsert = executed.find((entry) => entry.sql.includes('INSERT INTO local_rooms'));
  const syncedInsert = executed.find((entry) => entry.sql.includes('INSERT INTO rooms'));
  assert.equal(localInsert.parameters[4], 'local-room.jpg');
  assert.equal(syncedInsert.parameters[4], null);

});

test('updatePowerSyncLocalRoom uploads replacement image for synced houses', async () => {
  const { updatePowerSyncLocalRoom, executed, queuedImageUploads } = createMutationModule({
    powerSyncHouseSyncStates: { 'house-1': 'synced' },
    roomRows: [
      {
        id: 'room-1',
        houseId: 'house-1',
        name: 'Kitchen',
        description: null,
        imagePath: 'old-room.jpg',
        remoteImagePath: 'houses/house-1/rooms/room-1-old',
        createdBy: null,
        updatedBy: null,
      },
    ],
  });

  await updatePowerSyncLocalRoom({
    roomId: 'room-1',
    name: 'Kitchen',
    imagePath: 'new-room.jpg',
  });

  await flushAsyncWork();
  assert.deepEqual(queuedImageUploads, [
    {
      table: 'rooms',
      houseId: 'house-1',
      id: 'room-1',
      imagePath: 'new-room.jpg',
    },
  ]);
  const syncedInsert = executed.find((entry) => entry.sql.includes('INSERT OR REPLACE INTO rooms'));
  assert.equal(syncedInsert.parameters[4], 'houses/house-1/rooms/room-1-old');

});

test('updatePowerSyncLocalRoom clears remote image path when image is removed', async () => {
  const { updatePowerSyncLocalRoom, executed, remoteImageDeletes, queuedImageUploads } = createMutationModule({
    powerSyncHouseSyncStates: { 'house-1': 'synced' },
    roomRows: [
      {
        id: 'room-1',
        houseId: 'house-1',
        name: 'Kitchen',
        description: null,
        imagePath: 'local-old.jpg',
        remoteImagePath: 'houses/house-1/rooms/room-1-old.jpg',
        createdBy: null,
        updatedBy: null,
      },
    ],
  });

  await updatePowerSyncLocalRoom({
    roomId: 'room-1',
    name: 'Kitchen',
    imagePath: null,
  });

  assert.deepEqual(queuedImageUploads, []);
  assert.deepEqual(remoteImageDeletes, ['houses/house-1/rooms/room-1-old.jpg']);
  const syncedInsert = executed.find((entry) => entry.sql.includes('INSERT OR REPLACE INTO rooms'));
  assert.equal(syncedInsert.parameters[4], null);
});

test('createPowerSyncLocalRoom mirrors writes for legacy sync-enabled houses', async () => {
  const { createPowerSyncLocalRoom, executed } = createMutationModule({
    powerSyncHouseSyncStates: { 'house-1': 'legacy_synced' },
    roomRows: [
      {
        id: 'generated-id',
        houseId: 'house-1',
        name: 'Kitchen',
        description: null,
        imagePath: null,
        createdBy: null,
        updatedBy: null,
      },
    ],
  });

  await createPowerSyncLocalRoom({ houseId: 'house-1', name: 'Kitchen' });

  assert.ok(executed.some((entry) => entry.sql.includes('INSERT INTO rooms')));
});

test('createPowerSyncLocalRoom keeps migrated local-only houses local despite legacy sync metadata', async () => {
  const { createPowerSyncLocalRoom, executed } = createMutationModule({
    powerSyncHouseSyncStates: { 'house-1': 'local_only' },
    roomRows: [
      {
        id: 'generated-id',
        houseId: 'house-1',
        name: 'Kitchen',
        description: null,
        imagePath: null,
        createdBy: null,
        updatedBy: null,
      },
    ],
  });

  await createPowerSyncLocalRoom({ houseId: 'house-1', name: 'Kitchen' });

  assert.ok(executed.some((entry) => entry.sql.includes('INSERT INTO local_rooms')));
  assert.ok(!executed.some((entry) => entry.sql.includes('INSERT INTO rooms')));
});

test('updatePowerSyncLocalRoom treats synced house rows as synced even with stale local-only metadata', async () => {
  const { updatePowerSyncLocalRoom, executed, queuedImageUploads } = createMutationModule({
    powerSyncHouseSyncStates: { 'house-1': 'local_only' },
    houseRows: [
      {
        id: 'house-1',
        syncedHouseRow: true,
      },
    ],
    roomRows: [
      {
        id: 'room-1',
        houseId: 'house-1',
        name: 'Kitchen',
        description: null,
        imagePath: 'old-room.jpg',
        remoteImagePath: 'houses/house-1/rooms/room-1-old',
        createdBy: null,
        updatedBy: null,
      },
    ],
  });

  await updatePowerSyncLocalRoom({
    roomId: 'room-1',
    name: 'Kitchen',
    imagePath: 'new-room.jpg',
  });

  assert.deepEqual(queuedImageUploads, [
    {
      table: 'rooms',
      houseId: 'house-1',
      id: 'room-1',
      imagePath: 'new-room.jpg',
    },
  ]);
  assert.ok(executed.some((entry) => entry.sql.includes('INSERT OR REPLACE INTO rooms')));
});

test('deletePowerSyncLocalRoom deletes dependent local rows before room', async () => {
  const { deletePowerSyncLocalRoom, executed } = createMutationModule();

  await deletePowerSyncLocalRoom({ roomId: 'room-1' });

  assert.equal(executed.length, 6);
  assert.ok(executed[0].sql.startsWith('DELETE FROM local_item_images'));
  assert.ok(executed[1].sql.startsWith('DELETE FROM local_items'));
  assert.ok(executed[2].sql.startsWith('DELETE FROM local_boxes'));
  assert.ok(executed[3].sql.startsWith('DELETE FROM local_containers'));
  assert.ok(executed[4].sql.startsWith('DELETE FROM local_rooms'));
  assert.ok(executed[5].sql.startsWith('INSERT OR REPLACE INTO local_metadata'));
});

test('deletePowerSyncLocalRoom mirrors child deletes for synced houses', async () => {
  const { deletePowerSyncLocalRoom, executed } = createMutationModule({
    powerSyncHouseSyncStates: { 'house-1': 'synced' },
    roomRows: [
      {
        id: 'room-1',
        houseId: 'house-1',
        name: 'Room',
        description: null,
        imagePath: null,
        createdBy: null,
        updatedBy: null,
      },
    ],
  });

  await deletePowerSyncLocalRoom({ roomId: 'room-1' });

  const syncedItemImagesDeleteIndex = executed.findIndex((entry) =>
    entry.sql.includes('DELETE FROM item_images')
  );
  const syncedItemsDeleteIndex = executed.findIndex((entry) =>
    entry.sql.includes('DELETE FROM items')
  );
  const syncedRoomsDeleteIndex = executed.findIndex((entry) =>
    entry.sql.includes('DELETE FROM rooms WHERE id = ?')
  );

  assert.ok(syncedItemImagesDeleteIndex >= 0);
  assert.ok(syncedItemsDeleteIndex > syncedItemImagesDeleteIndex);
  assert.ok(syncedRoomsDeleteIndex > syncedItemsDeleteIndex);
});

test('createPowerSyncLocalContainer writes local container', async () => {
  const { createPowerSyncLocalContainer, executed } = createMutationModule({
    containerRows: [
      {
        id: 'generated-id',
        houseId: 'house-1',
        roomId: 'room-1',
        name: 'Shelf',
        description: null,
        imagePath: null,
        createdBy: null,
        updatedBy: null,
      },
    ],
  });

  const container = await createPowerSyncLocalContainer({
    houseId: 'house-1',
    roomId: 'room-1',
    name: 'Shelf',
  });

  assert.equal(container.id, 'generated-id');
  assert.ok(executed[1].sql.includes('INSERT INTO local_containers'));
  assert.deepEqual(executed[1].parameters.slice(0, 4), ['generated-id', 'house-1', 'room-1', 'Shelf']);
});

test('createPowerSyncLocalContainer derives house from room when add screen has no house id', async () => {
  const { createPowerSyncLocalContainer, executed } = createMutationModule({
    roomRows: [
      {
        id: 'room-1',
        houseId: 'house-1',
        name: 'Room',
        description: null,
        imagePath: null,
        createdBy: null,
        updatedBy: null,
      },
    ],
    containerRows: [
      {
        id: 'generated-id',
        houseId: 'house-1',
        roomId: 'room-1',
        name: 'Shelf',
        description: null,
        imagePath: null,
        createdBy: null,
        updatedBy: null,
      },
    ],
  });

  const container = await createPowerSyncLocalContainer({
    houseId: '',
    roomId: 'room-1',
    name: 'Shelf',
  });

  assert.equal(container.houseId, 'house-1');
  assert.deepEqual(executed[1].parameters.slice(0, 4), ['generated-id', 'house-1', 'room-1', 'Shelf']);
});

test('updatePowerSyncLocalBox preserves existing parent when not supplied', async () => {
  const { updatePowerSyncLocalBox, executed } = createMutationModule({
    boxRows: [
      {
        id: 'box-1',
        houseId: 'house-1',
        parentType: 'room',
        parentId: 'room-1',
        name: 'Old Box',
        description: null,
        imagePath: null,
        tags: '',
        createdBy: null,
        updatedBy: null,
      },
      {
        id: 'box-1',
        houseId: 'house-1',
        parentType: 'room',
        parentId: 'room-1',
        name: 'New Box',
        description: 'Notes',
        imagePath: null,
        tags: '',
        createdBy: null,
        updatedBy: null,
      },
    ],
  });

  const box = await updatePowerSyncLocalBox({ boxId: 'box-1', name: 'New Box', description: 'Notes' });

  assert.equal(box.id, 'box-1');
  assert.ok(executed[1].sql.includes('INSERT OR REPLACE INTO local_boxes'));
  assert.deepEqual(executed[1].parameters.slice(0, 6), [
    'box-1',
    'house-1',
    'room',
    'room-1',
    'New Box',
    'Notes',
  ]);
});

test('deletePowerSyncLocalItem deletes item images and writes tombstone', async () => {
  const { deletePowerSyncLocalItem, executed } = createMutationModule();

  await deletePowerSyncLocalItem({ itemId: 'item-1' });

  assert.equal(executed.length, 3);
  assert.ok(executed[0].sql.startsWith('DELETE FROM local_item_images'));
  assert.ok(executed[1].sql.startsWith('DELETE FROM local_items'));
  assert.ok(executed[2].sql.startsWith('INSERT OR REPLACE INTO local_metadata'));
});

test('updatePowerSyncLocalItem can update local cover without touching synced storage', async () => {
  const { updatePowerSyncLocalItem, executed, queuedImageUploads, queuedImageDeletes } = createMutationModule({
    powerSyncHouseSyncStates: { 'house-1': 'synced' },
    itemRows: [
      {
        id: 'item-1',
        houseId: 'house-1',
        parentType: 'room',
        parentId: 'room-1',
        name: 'Item',
        description: null,
        imagePath: 'houses/house-1/item-images/old-cover.jpg',
        tags: '',
        purchasePriceCents: null,
        notes: null,
        createdBy: null,
        updatedBy: null,
      },
    ],
  });

  await updatePowerSyncLocalItem({
    itemId: 'item-1',
    houseId: 'house-1',
    parentType: 'room',
    parentId: 'room-1',
    name: 'Item',
    imagePath: 'new-local-cover.jpg',
    tags: '',
    purchasePriceCents: null,
    notes: null,
    syncImageStorage: false,
  });

  const localInsert = executed.find((entry) => entry.sql.includes('INSERT OR REPLACE INTO local_items'));
  const syncedInsert = executed.find((entry) => entry.sql.includes('INSERT OR REPLACE INTO items'));
  assert.equal(localInsert.parameters[6], 'new-local-cover.jpg');
  assert.equal(syncedInsert.parameters[6], null);
  assert.deepEqual(queuedImageUploads, []);
  assert.deepEqual(queuedImageDeletes, []);
});

test('updatePowerSyncLocalItem clears synced cover metadata without touching storage', async () => {
  const { updatePowerSyncLocalItem, executed, queuedImageUploads, queuedImageDeletes } = createMutationModule({
    powerSyncHouseSyncStates: { 'house-1': 'synced' },
    itemRows: [
      {
        id: 'item-1',
        houseId: 'house-1',
        parentType: 'room',
        parentId: 'room-1',
        name: 'Item',
        description: null,
        imagePath: 'houses/house-1/item-images/old-cover.jpg',
        tags: '',
        purchasePriceCents: null,
        notes: null,
        createdBy: null,
        updatedBy: null,
      },
    ],
  });

  await updatePowerSyncLocalItem({
    itemId: 'item-1',
    houseId: 'house-1',
    parentType: 'room',
    parentId: 'room-1',
    name: 'Item',
    imagePath: null,
    tags: '',
    purchasePriceCents: null,
    notes: null,
    syncImageStorage: false,
  });

  const localInsert = executed.find((entry) => entry.sql.includes('INSERT OR REPLACE INTO local_items'));
  const syncedInsert = executed.find((entry) => entry.sql.includes('INSERT OR REPLACE INTO items'));
  assert.equal(localInsert.parameters[6], null);
  assert.equal(syncedInsert.parameters[6], null);
  assert.deepEqual(queuedImageUploads, []);
  assert.deepEqual(queuedImageDeletes, []);
});

test('createPowerSyncLocalItem with item images keeps synced cover storage empty', async () => {
  const { createPowerSyncLocalItem, executed, queuedImageUploads } = createMutationModule({
    powerSyncHouseSyncStates: { 'house-1': 'synced' },
    itemRows: [
      {
        id: 'generated-id',
        houseId: 'house-1',
        parentType: 'room',
        parentId: 'room-1',
        name: 'Item',
        description: null,
        imagePath: 'local-cover.jpg',
        tags: '',
        purchasePriceCents: null,
        notes: null,
        createdBy: null,
        updatedBy: null,
      },
    ],
  });

  await createPowerSyncLocalItem({
    houseId: 'house-1',
    parentType: 'room',
    parentId: 'room-1',
    name: 'Item',
    imagePath: 'local-cover.jpg',
    tags: '',
    purchasePriceCents: null,
    notes: null,
    syncImageStorage: false,
  });

  const localInsert = executed.find((entry) => entry.sql.includes('INSERT INTO local_items'));
  const syncedInsert = executed.find((entry) => entry.sql.includes('INSERT INTO items'));
  assert.equal(localInsert.parameters[6], 'local-cover.jpg');
  assert.equal(syncedInsert.parameters[6], null);
  assert.deepEqual(queuedImageUploads, []);
});

test('createPowerSyncLocalItemImage writes local item image with legacy cover id', async () => {
  const { createPowerSyncLocalItemImage, executed } = createMutationModule({
    itemImageRows: [
      {
        id: 'legacy-item-1',
        itemId: 'item-1',
        houseId: 'house-1',
        imagePath: 'image.jpg',
        remotePath: null,
        position: 0,
        createdBy: null,
        updatedBy: null,
      },
    ],
  });

  const itemImage = await createPowerSyncLocalItemImage({
    itemId: 'item-1',
    houseId: 'house-1',
    imagePath: 'image.jpg',
    position: 0,
  });

  assert.equal(itemImage.id, 'legacy-item-1');
  assert.ok(executed[1].sql.includes('INSERT OR REPLACE INTO local_item_images'));
  assert.deepEqual(executed[1].parameters.slice(0, 6), [
    'legacy-item-1',
    'item-1',
    'house-1',
    'image.jpg',
    null,
    0,
  ]);
});

test('createPowerSyncLocalItemImage uploads image for synced houses', async () => {
  const { createPowerSyncLocalItemImage, executed, queuedImageUploads } = createMutationModule({
    powerSyncHouseSyncStates: { 'house-1': 'synced' },
    itemImageRows: [
      {
        id: 'legacy-item-1',
        itemId: 'item-1',
        houseId: 'house-1',
        imagePath: 'image.jpg',
        remotePath: 'houses/house-1/item-images/legacy-item-1',
        position: 0,
        createdBy: null,
        updatedBy: null,
      },
    ],
  });

  await createPowerSyncLocalItemImage({
    itemId: 'item-1',
    houseId: 'house-1',
    imagePath: 'image.jpg',
    position: 0,
  });

  await flushAsyncWork();
  assert.deepEqual(queuedImageUploads, [
    {
      table: 'item_images',
      houseId: 'house-1',
      id: 'legacy-item-1',
      imagePath: 'image.jpg',
    },
  ]);
  assert.ok(executed.some((entry) => entry.sql.includes('INSERT OR REPLACE INTO item_images')));
  const syncedInsert = executed.find((entry) => entry.sql.includes('INSERT OR REPLACE INTO item_images'));
  assert.equal(syncedInsert.parameters[4], null);

});

test('updatePowerSyncLocalItemImage preserves item and house ids', async () => {
  const { updatePowerSyncLocalItemImage, executed } = createMutationModule({
    itemImageRows: [
      {
        id: 'image-1',
        itemId: 'item-1',
        houseId: 'house-1',
        imagePath: 'old.jpg',
        remotePath: null,
        position: 0,
        createdBy: null,
        updatedBy: null,
      },
      {
        id: 'image-1',
        itemId: 'item-1',
        houseId: 'house-1',
        imagePath: 'new.jpg',
        remotePath: null,
        position: 1,
        createdBy: null,
        updatedBy: null,
      },
    ],
  });

  const itemImage = await updatePowerSyncLocalItemImage({
    itemImageId: 'image-1',
    imagePath: 'new.jpg',
    position: 1,
  });

  assert.equal(itemImage.id, 'image-1');
  assert.ok(executed[1].sql.includes('INSERT OR REPLACE INTO local_item_images'));
  assert.deepEqual(executed[1].parameters.slice(0, 6), [
    'image-1',
    'item-1',
    'house-1',
    'new.jpg',
    null,
    1,
  ]);
});

test('updatePowerSyncLocalItemImage uploads replacement image for synced houses', async () => {
  const { updatePowerSyncLocalItemImage, executed, queuedImageUploads } = createMutationModule({
    powerSyncHouseSyncStates: { 'house-1': 'synced' },
    itemImageRows: [
      {
        id: 'image-1',
        itemId: 'item-1',
        houseId: 'house-1',
        imagePath: 'old.jpg',
        remotePath: 'houses/house-1/item-images/image-1',
        position: 0,
        createdBy: null,
        updatedBy: null,
      },
      {
        id: 'image-1',
        itemId: 'item-1',
        houseId: 'house-1',
        imagePath: 'new.jpg',
        remotePath: 'houses/house-1/item-images/image-1',
        position: 0,
        createdBy: null,
        updatedBy: null,
      },
    ],
  });

  await updatePowerSyncLocalItemImage({
    itemImageId: 'image-1',
    imagePath: 'new.jpg',
  });

  await flushAsyncWork();
  assert.deepEqual(queuedImageUploads, [
    {
      table: 'item_images',
      houseId: 'house-1',
      id: 'image-1',
      imagePath: 'new.jpg',
    },
  ]);
  const syncedInsert = executed.find((entry) => entry.sql.includes('INSERT OR REPLACE INTO item_images'));
  assert.equal(syncedInsert.parameters[4], null);

});

test('updatePowerSyncLocalItemImage materializes missing legacy cover row', async () => {
  const { updatePowerSyncLocalItemImage, executed } = createMutationModule({
    itemRows: [
      {
        id: 'item-1',
        houseId: 'house-1',
        parentType: 'room',
        parentId: 'room-1',
        name: 'Item',
        description: null,
        imagePath: 'old-cover.jpg',
        remoteImagePath: null,
        tags: '',
        purchasePriceCents: null,
        notes: null,
        createdBy: null,
        updatedBy: null,
      },
    ],
  });

  const itemImage = await updatePowerSyncLocalItemImage({
    itemImageId: 'legacy-item-1',
    imagePath: 'new-cover.jpg',
  });

  assert.equal(itemImage.id, 'legacy-item-1');
  const localInsert = executed.find((entry) => entry.sql.includes('INSERT OR REPLACE INTO local_item_images'));
  assert.deepEqual(localInsert.parameters.slice(0, 6), [
    'legacy-item-1',
    'item-1',
    'house-1',
    'new-cover.jpg',
    null,
    0,
  ]);
});

test('deletePowerSyncLocalItemImage queues remote storage delete for synced houses', async () => {
  const { deletePowerSyncLocalItemImage, executed, queuedImageDeletes } = createMutationModule({
    powerSyncHouseSyncStates: { 'house-1': 'synced' },
    itemImageRows: [
      {
        id: 'image-1',
        itemId: 'item-1',
        houseId: 'house-1',
        imagePath: 'local-image.jpg',
        remotePath: 'houses/house-1/item-images/image-1.jpg',
        position: 0,
        createdBy: null,
        updatedBy: null,
      },
    ],
  });

  await deletePowerSyncLocalItemImage({ itemImageId: 'image-1' });

  assert.ok(executed.some((entry) => entry.sql === 'DELETE FROM local_metadata WHERE id = ?'));
  assert.ok(executed.some((entry) => entry.sql === 'DELETE FROM local_item_images WHERE id = ?'));
  assert.ok(executed.some((entry) => entry.sql === 'DELETE FROM item_images WHERE id = ?'));
  assert.deepEqual(queuedImageDeletes, [
    { remotePath: 'houses/house-1/item-images/image-1.jpg' },
  ]);
});

test('deletePowerSyncLocalItem queues remote storage deletes for child item images', async () => {
  const { deletePowerSyncLocalItem, executed, queuedImageDeletes } = createMutationModule({
    powerSyncHouseSyncStates: { 'house-1': 'synced' },
    itemRows: [
      {
        id: 'item-1',
        houseId: 'house-1',
        parentType: 'room',
        parentId: 'room-1',
        name: 'Item',
        description: null,
        imagePath: null,
        tags: '',
        purchasePriceCents: null,
        notes: null,
        createdBy: null,
        updatedBy: null,
      },
    ],
    itemImageRows: [
      {
        id: 'image-1',
        itemId: 'item-1',
        houseId: 'house-1',
        imagePath: 'local-1.jpg',
        remotePath: 'houses/house-1/item-images/image-1.jpg',
        position: 0,
        createdBy: null,
        updatedBy: null,
      },
      {
        id: 'image-2',
        itemId: 'item-1',
        houseId: 'house-1',
        imagePath: 'local-2.jpg',
        remotePath: 'houses/house-1/item-images/image-2.jpg',
        position: 1,
        createdBy: null,
        updatedBy: null,
      },
    ],
  });

  await deletePowerSyncLocalItem({ itemId: 'item-1' });

  const pendingUploadDeletes = executed.filter(
    (entry) =>
      entry.sql === 'DELETE FROM local_metadata WHERE id = ?' &&
      String(entry.parameters[0]).startsWith('pending:image-upload:item_images:')
  );
  assert.equal(pendingUploadDeletes.length, 2);
  assert.deepEqual(queuedImageDeletes, [
    { remotePath: 'houses/house-1/item-images/image-1.jpg' },
    { remotePath: 'houses/house-1/item-images/image-2.jpg' },
  ]);
});

test('processPendingPowerSyncImageUploads uploads queued room image and patches synced row', async () => {
  const executed = [];
  const metadataRows = [
    {
      id: 'pending:image-upload:rooms:room-1',
      value: JSON.stringify({
        table: 'rooms',
        houseId: 'house-1',
        id: 'room-1',
        imagePath: 'local-room.jpg',
        previousRemotePath: 'houses/house-1/rooms/room-1-old.jpg',
        createdAt: 1,
        attempts: 0,
      }),
    },
  ];
  const database = {
    async waitForReady() {},
    async getAll() {
      return metadataRows;
    },
    async getOptional(sql, parameters) {
      assert.ok(sql.includes('FROM local_rooms'));
      assert.deepEqual(parameters, ['room-1']);
      return { image_path: 'local-room.jpg' };
    },
    async writeTransaction(callback) {
      return callback({
        async execute(sql, parameters) {
          executed.push({ sql: sql.replace(/\s+/g, ' ').trim(), parameters });
        },
      });
    },
  };
  const imageUploads = [];
  const remoteImageDeletes = [];
  const { processPendingPowerSyncImageUploads } = loadWithMocks(imageUploadQueuePath, {
    './system': {
      getPowerSyncDatabase: () => database,
    },
    './imageUpload': {
      uploadPowerSyncImageIfNeeded: async ({ table, houseId, id, imagePath }) => {
        imageUploads.push({ table, houseId, id, imagePath });
        return 'houses/house-1/rooms/room-1';
      },
      deletePowerSyncRemoteImageIfNeeded: async (remotePath) => {
        remoteImageDeletes.push(remotePath);
      },
    },
  });

  await processPendingPowerSyncImageUploads(database);

  assert.deepEqual(imageUploads, [
    {
      table: 'rooms',
      houseId: 'house-1',
      id: 'room-1',
      imagePath: 'local-room.jpg',
    },
  ]);
  assert.ok(executed.some((entry) => entry.sql.includes('UPDATE rooms SET image_path = ?')));
  assert.ok(executed.some((entry) => entry.sql.includes('DELETE FROM local_metadata')));
  assert.deepEqual(remoteImageDeletes, ['houses/house-1/rooms/room-1-old.jpg']);
});

test('public image transport leaves local images unuploaded', async () => {
  const { uploadPowerSyncImageIfNeeded } = require(imageUploadPath);
  const remotePath = await uploadPowerSyncImageIfNeeded({
    table: 'rooms',
    houseId: 'house-1',
    id: 'room-1',
    imagePath: 'room-cover.png',
  });
  assert.equal(remotePath, null);
});
