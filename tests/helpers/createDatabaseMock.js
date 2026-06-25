const matchesCondition = (record, condition) => {
  if (!condition) return true;
  if (condition.type !== 'where') return true;
  const value = record[condition.field];
  if (condition.operator === 'eq') {
    return value === condition.value;
  }
  if (condition.operator === 'oneOf') {
    return condition.values.includes(value);
  }
  return true;
};

const createRecord = (tableStore, data) => {
  const record = {
    ...data,
    _raw: { id: data.id },
    async update(updater) {
      updater(record);
      const nextId = record._raw.id ?? record.id;
      if (nextId) {
        record.id = nextId;
        tableStore.set(nextId, record);
      }
    },
    async destroyPermanently() {
      if (record.id) {
        tableStore.delete(record.id);
      }
    },
  };
  return record;
};

const createCollection = (tableStore) => ({
  query(...conditions) {
    const filtered = Array.from(tableStore.values()).filter((record) =>
      conditions.every((condition) => matchesCondition(record, condition))
    );
    return {
      async fetch() {
        return filtered;
      },
      async fetchCount() {
        return filtered.length;
      },
    };
  },
  async find(id) {
    const record = tableStore.get(id);
    if (!record) {
      throw new Error(`Record not found: ${id}`);
    }
    return record;
  },
  async create(builder) {
    const draft = {
      _raw: {},
      async update(updater) {
        updater(draft);
        const nextId = draft._raw.id ?? draft.id;
        if (nextId) {
          draft.id = nextId;
          tableStore.set(nextId, draft);
        }
      },
      async destroyPermanently() {
        if (draft.id) {
          tableStore.delete(draft.id);
        }
      },
    };
    builder(draft);
    const nextId = draft._raw.id ?? draft.id;
    if (!nextId) {
      throw new Error('Missing id for created record');
    }
    draft.id = nextId;
    tableStore.set(nextId, draft);
    return draft;
  },
});

const createDatabaseMock = (initialData = {}) => {
  const stores = {
    houses: new Map(),
    rooms: new Map(),
    containers: new Map(),
    boxes: new Map(),
    items: new Map(),
    item_images: new Map(),
  };

  for (const [table, records] of Object.entries(initialData)) {
    if (!stores[table]) continue;
    for (const record of records) {
      stores[table].set(record.id, createRecord(stores[table], record));
    }
  }

  const collections = {
    get(name) {
      if (!stores[name]) {
        throw new Error(`Unknown collection: ${name}`);
      }
      return createCollection(stores[name]);
    },
  };

  return {
    __stores: stores,
    collections,
    async write(work) {
      return await work();
    },
  };
};

module.exports = {
  createDatabaseMock,
};
