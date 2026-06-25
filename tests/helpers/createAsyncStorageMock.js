const createAsyncStorageMock = (initialState = {}) => {
  const state = new Map(Object.entries(initialState));

  return {
    __state: state,
    async getItem(key) {
      return state.has(key) ? state.get(key) : null;
    },
    async setItem(key, value) {
      state.set(key, String(value));
    },
    async removeItem(key) {
      state.delete(key);
    },
    async multiRemove(keys) {
      for (const key of keys) {
        state.delete(key);
      }
    },
    async clear() {
      state.clear();
    },
  };
};

module.exports = {
  createAsyncStorageMock,
};
