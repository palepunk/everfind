import { column, Schema, Table, type RowType } from '@powersync/react-native';

export const houses = new Table(
  {
    name: column.text,
    owner_id: column.text,
    address: column.text,
    notes: column.text,
    image_path: column.text,
    created_by: column.text,
    updated_by: column.text,
  },
  { indexes: { owner: ['owner_id'] } }
);

export const rooms = new Table(
  {
    house_id: column.text,
    name: column.text,
    description: column.text,
    image_path: column.text,
    created_by: column.text,
    updated_by: column.text,
  },
  { indexes: { house: ['house_id'] } }
);

export const containers = new Table(
  {
    house_id: column.text,
    room_id: column.text,
    name: column.text,
    description: column.text,
    image_path: column.text,
    created_by: column.text,
    updated_by: column.text,
  },
  { indexes: { house: ['house_id'], room: ['room_id'] } }
);

export const boxes = new Table(
  {
    house_id: column.text,
    parent_type: column.text,
    parent_id: column.text,
    name: column.text,
    description: column.text,
    image_path: column.text,
    tags: column.text,
    created_by: column.text,
    updated_by: column.text,
  },
  { indexes: { house: ['house_id'], parent: ['parent_type', 'parent_id'] } }
);

export const items = new Table(
  {
    house_id: column.text,
    parent_type: column.text,
    parent_id: column.text,
    name: column.text,
    description: column.text,
    image_path: column.text,
    tags: column.text,
    purchase_price_cents: column.integer,
    notes: column.text,
    created_by: column.text,
    updated_by: column.text,
  },
  { indexes: { house: ['house_id'], parent: ['parent_type', 'parent_id'] } }
);

export const item_images = new Table(
  {
    item_id: column.text,
    house_id: column.text,
    image_path: column.text,
    remote_path: column.text,
    position: column.integer,
    created_by: column.text,
    updated_by: column.text,
  },
  { indexes: { item: ['item_id'], house: ['house_id'] } }
);

export const inbox_entries = new Table(
  {
    created_at: column.integer,
    updated_at: column.integer,
    source: column.text,
    raw_text: column.text,
    status: column.text,
    parsed_result_json: column.text,
    applied_refs_json: column.text,
    error: column.text,
  },
  { indexes: { created: ['created_at'], status: ['status'] } }
);

export const local_houses = new Table(
  {
    name: column.text,
    owner_id: column.text,
    address: column.text,
    notes: column.text,
    image_path: column.text,
    created_by: column.text,
    updated_by: column.text,
  },
  { indexes: { owner: ['owner_id'] }, localOnly: true }
);

export const local_rooms = new Table(
  {
    house_id: column.text,
    name: column.text,
    description: column.text,
    image_path: column.text,
    created_by: column.text,
    updated_by: column.text,
  },
  { indexes: { house: ['house_id'] }, localOnly: true }
);

export const local_containers = new Table(
  {
    house_id: column.text,
    room_id: column.text,
    name: column.text,
    description: column.text,
    image_path: column.text,
    created_by: column.text,
    updated_by: column.text,
  },
  { indexes: { house: ['house_id'], room: ['room_id'] }, localOnly: true }
);

export const local_boxes = new Table(
  {
    house_id: column.text,
    parent_type: column.text,
    parent_id: column.text,
    name: column.text,
    description: column.text,
    image_path: column.text,
    tags: column.text,
    created_by: column.text,
    updated_by: column.text,
  },
  { indexes: { house: ['house_id'], parent: ['parent_type', 'parent_id'] }, localOnly: true }
);

export const local_items = new Table(
  {
    house_id: column.text,
    parent_type: column.text,
    parent_id: column.text,
    name: column.text,
    description: column.text,
    image_path: column.text,
    tags: column.text,
    purchase_price_cents: column.integer,
    notes: column.text,
    created_by: column.text,
    updated_by: column.text,
  },
  { indexes: { house: ['house_id'], parent: ['parent_type', 'parent_id'] }, localOnly: true }
);

export const local_item_images = new Table(
  {
    item_id: column.text,
    house_id: column.text,
    image_path: column.text,
    remote_path: column.text,
    position: column.integer,
    created_by: column.text,
    updated_by: column.text,
  },
  { indexes: { item: ['item_id'], house: ['house_id'] }, localOnly: true }
);

export const local_inbox_entries = new Table(
  {
    created_at: column.integer,
    updated_at: column.integer,
    source: column.text,
    raw_text: column.text,
    status: column.text,
    parsed_result_json: column.text,
    applied_refs_json: column.text,
    error: column.text,
  },
  { indexes: { created: ['created_at'], status: ['status'] }, localOnly: true }
);

export const local_metadata = new Table(
  {
    value: column.text,
    updated_at: column.integer,
  },
  { localOnly: true }
);

export const AppSchema = new Schema({
  houses,
  rooms,
  containers,
  boxes,
  items,
  item_images,
  inbox_entries,
  local_houses,
  local_rooms,
  local_containers,
  local_boxes,
  local_items,
  local_item_images,
  local_inbox_entries,
  local_metadata,
});

export type PowerSyncDatabaseSchema = (typeof AppSchema)['types'];
export type PowerSyncHouse = RowType<typeof houses>;
export type PowerSyncRoom = RowType<typeof rooms>;
export type PowerSyncContainer = RowType<typeof containers>;
export type PowerSyncBox = RowType<typeof boxes>;
export type PowerSyncItem = RowType<typeof items>;
export type PowerSyncItemImage = RowType<typeof item_images>;
export type PowerSyncInboxEntry = RowType<typeof inbox_entries>;
export type PowerSyncLocalHouse = RowType<typeof local_houses>;
export type PowerSyncLocalRoom = RowType<typeof local_rooms>;
export type PowerSyncLocalContainer = RowType<typeof local_containers>;
export type PowerSyncLocalBox = RowType<typeof local_boxes>;
export type PowerSyncLocalItem = RowType<typeof local_items>;
export type PowerSyncLocalItemImage = RowType<typeof local_item_images>;
export type PowerSyncLocalInboxEntry = RowType<typeof local_inbox_entries>;
