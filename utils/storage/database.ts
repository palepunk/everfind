import { getPowerSyncDatabase } from '@/utils/powersync/system';
import type { QueryCondition } from './query';
import { Observable } from 'rxjs';

type TableName =
  | 'houses'
  | 'rooms'
  | 'containers'
  | 'boxes'
  | 'items'
  | 'item_images'
  | 'inbox_entries';

type DbRecord = Record<string, any> & {
  id: string;
  _raw: { id?: string };
  update: (updater: (record: any) => void) => Promise<void>;
  destroyPermanently: () => Promise<void>;
};

const LOCAL_TABLES: Record<TableName, string> = {
  houses: 'local_houses',
  rooms: 'local_rooms',
  containers: 'local_containers',
  boxes: 'local_boxes',
  items: 'local_items',
  item_images: 'local_item_images',
  inbox_entries: 'local_inbox_entries',
};

const TABLE_COLUMNS: Record<TableName, string[]> = {
  houses: ['id', 'name', 'owner_id', 'address', 'notes', 'image_path', 'created_by', 'updated_by'],
  rooms: ['id', 'house_id', 'name', 'description', 'image_path', 'created_by', 'updated_by'],
  containers: ['id', 'house_id', 'room_id', 'name', 'description', 'image_path', 'created_by', 'updated_by'],
  boxes: ['id', 'house_id', 'parent_type', 'parent_id', 'name', 'description', 'image_path', 'tags', 'created_by', 'updated_by'],
  items: [
    'id',
    'house_id',
    'parent_type',
    'parent_id',
    'name',
    'description',
    'image_path',
    'tags',
    'purchase_price_cents',
    'notes',
    'created_by',
    'updated_by',
  ],
  item_images: ['id', 'item_id', 'house_id', 'image_path', 'remote_path', 'position', 'created_by', 'updated_by'],
  inbox_entries: [
    'id',
    'created_at',
    'updated_at',
    'source',
    'raw_text',
    'status',
    'parsed_result_json',
    'applied_refs_json',
    'error',
  ],
};

const camelToSnake = (key: string) =>
  key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

const snakeToCamel = (key: string) =>
  key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());

const readRecordValue = (record: Record<string, any>, field: string) => {
  const camelField = snakeToCamel(field);
  return record[camelField] ?? record[field];
};

const toRecord = (table: TableName, row: Record<string, any>): DbRecord => {
  const record: Record<string, any> = { _raw: { id: row.id } };
  for (const [key, value] of Object.entries(row)) {
    record[snakeToCamel(key)] = value;
  }
  record.id = row.id;
  record.update = async (updater: (current: any) => void) => {
    updater(record);
    await upsertRecord(table, record);
  };
  record.destroyPermanently = async () => {
    await deleteRecord(table, record.id);
  };
  return record as DbRecord;
};

const recordToRow = (table: TableName, record: Record<string, any>) => {
  const row: Record<string, any> = {};
  for (const column of TABLE_COLUMNS[table]) {
    const camelKey = snakeToCamel(column);
    row[column] = record[camelKey] ?? record[column] ?? null;
  }
  row.id = record._raw?.id ?? record.id ?? row.id;
  return row;
};

const createId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

const tableName = (table: TableName) => LOCAL_TABLES[table];

const upsertRecord = async (table: TableName, record: Record<string, any>) => {
  const db = getPowerSyncDatabase();
  const row = recordToRow(table, record);
  if (!row.id) row.id = createId();
  const columns = TABLE_COLUMNS[table];
  const placeholders = columns.map(() => '?').join(', ');
  const updates = columns.filter((column) => column !== 'id').map((column) => `${column} = excluded.${column}`).join(', ');
  await db.execute(
    `INSERT INTO ${tableName(table)} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updates}`,
    columns.map((column) => row[column])
  );
  record.id = row.id;
  if (record._raw) record._raw.id = row.id;
};

const deleteRecord = async (table: TableName, id: string) => {
  await getPowerSyncDatabase().execute(`DELETE FROM ${tableName(table)} WHERE id = ?`, [id]);
};

const applyConditions = (records: DbRecord[], conditions: QueryCondition[]) => {
  let next = [...records];
  for (const condition of conditions) {
    if (condition.type === 'where') {
      next = next.filter((record) => {
        const value = readRecordValue(record, condition.field);
        if (condition.operator === 'oneOf') return condition.values.includes(value);
        if (condition.operator === 'notEq') return value !== condition.value;
        return value === condition.value;
      });
      continue;
    }
    if (condition.type === 'sortBy') {
      next.sort((left, right) => {
        const leftValue = readRecordValue(left, condition.field);
        const rightValue = readRecordValue(right, condition.field);
        if (leftValue === rightValue) return 0;
        const result = leftValue > rightValue ? 1 : -1;
        return condition.direction === 'desc' ? -result : result;
      });
      continue;
    }
    if (condition.type === 'take') {
      next = next.slice(0, condition.count);
    }
  }
  return next;
};

const fetchAll = async (table: TableName) => {
  const rows = await getPowerSyncDatabase().getAll<Record<string, any>>(
    `SELECT * FROM ${tableName(table)}`
  );
  return rows.map((row) => toRecord(table, row));
};

const makeObservable = <T>(load: () => Promise<T>) =>
  new Observable<T>((subscriber) => {
    load()
      .then((value) => {
        subscriber.next(value);
      })
      .catch((error) => {
        subscriber.error(error);
      });
    return () => undefined;
  });

const createQuery = (table: TableName, conditions: QueryCondition[]) => ({
  async fetch() {
    return applyConditions(await fetchAll(table), conditions);
  },
  async fetchCount() {
    return (await this.fetch()).length;
  },
  observeCount() {
    return makeObservable(() => this.fetchCount());
  },
  observe() {
    return makeObservable(() => this.fetch());
  },
  observeWithColumns(_columns: string[]) {
    return makeObservable(() => this.fetch());
  },
});

const createCollection = (table: TableName) => ({
  query(...conditions: QueryCondition[]) {
    return createQuery(table, conditions);
  },
  async find(id: string) {
    const row = await getPowerSyncDatabase().getOptional<Record<string, any>>(
      `SELECT * FROM ${tableName(table)} WHERE id = ?`,
      [id]
    );
    if (!row) throw new Error(`Record not found: ${table}#${id}`);
    return toRecord(table, row);
  },
  findAndObserve(id: string) {
    return makeObservable(() => this.find(id));
  },
  async create(builder: (record: any) => void) {
    const record: Record<string, any> = { _raw: {} };
    builder(record);
    await upsertRecord(table, record);
    return toRecord(table, recordToRow(table, record));
  },
});

export const database = {
  collections: {
    get<T>(_table: TableName) {
      return createCollection(_table) as any;
    },
  },
  async write<T>(work: () => Promise<T>) {
    return await work();
  },
  async unsafeResetDatabase() {
    const db = getPowerSyncDatabase();
    for (const table of Object.values(LOCAL_TABLES)) {
      await db.execute(`DELETE FROM ${table}`);
    }
    await db.execute('DELETE FROM local_metadata');
  },
};
