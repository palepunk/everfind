const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadWithMocks } = require('./helpers/moduleMocks');

const schemaPath = path.resolve(__dirname, '../utils/powersync/schema.ts');

const createSchemaModule = () =>
  loadWithMocks(schemaPath, {
    '@powersync/react-native': {
      column: {
        text: { type: 'text' },
        integer: { type: 'integer' },
      },
      Table: class Table {
        constructor(columns, options = {}) {
          this.columns = Object.entries(columns).map(([name, definition]) => ({
            name,
            ...definition,
          }));
          this.localOnly = options.localOnly === true;
          this.indexes = options.indexes ?? {};
        }
      },
      Schema: class Schema {
        constructor(tablesByName) {
          this.tables = Object.entries(tablesByName).map(([name, table]) => ({
            ...table,
            name,
          }));
        }
      },
    },
  });

test('PowerSync schema includes inventory, inbox, and local metadata tables', () => {
  const { AppSchema } = createSchemaModule();
  const tableNames = AppSchema.tables.map((table) => table.name).sort();

  assert.deepEqual(tableNames, [
    'boxes',
    'containers',
    'houses',
    'inbox_entries',
    'item_images',
    'items',
    'local_boxes',
    'local_containers',
    'local_houses',
    'local_inbox_entries',
    'local_item_images',
    'local_items',
    'local_metadata',
    'local_rooms',
    'rooms',
  ]);

  const localMetadata = AppSchema.tables.find((table) => table.name === 'local_metadata');
  assert.equal(localMetadata.localOnly, true);
  const localHouses = AppSchema.tables.find((table) => table.name === 'local_houses');
  assert.equal(localHouses.localOnly, true);
});

test('PowerSync schema preserves image path columns for phase-one migration', () => {
  const { AppSchema } = createSchemaModule();
  const itemImages = AppSchema.tables.find((table) => table.name === 'item_images');
  const columnNames = itemImages.columns.map((column) => column.name).sort();

  assert.ok(columnNames.includes('image_path'));
  assert.ok(columnNames.includes('remote_path'));
});
