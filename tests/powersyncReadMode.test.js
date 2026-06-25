/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadWithMocks } = require('./helpers/moduleMocks');
const { createAsyncStorageMock } = require('./helpers/createAsyncStorageMock');

const readModePath = path.resolve(__dirname, '../utils/powersync/readMode.ts');

const createReadModeModule = ({ initialStorage = {}, configuredDefault } = {}) => {
  const AsyncStorage = createAsyncStorageMock(initialStorage);
  const module = loadWithMocks(readModePath, {
    '@react-native-async-storage/async-storage': AsyncStorage,
    'expo-constants': {
      expoConfig: {
        extra: configuredDefault === undefined ? {} : { powerSyncReadModeDefault: configuredDefault },
      },
    },
  });
  return { ...module, AsyncStorage };
};

test('PowerSync read mode defaults on when no explicit setting exists', async () => {
  const { loadPowerSyncReadModeEnabled, getPowerSyncReadModeEnabledSnapshot } = createReadModeModule();

  assert.equal(getPowerSyncReadModeEnabledSnapshot(), true);
  assert.equal(await loadPowerSyncReadModeEnabled(), true);
  assert.equal(getPowerSyncReadModeEnabledSnapshot(), true);
});

test('PowerSync read mode honors explicit disabled setting', async () => {
  const { loadPowerSyncReadModeEnabled, getPowerSyncReadModeEnabledSnapshot } = createReadModeModule({
    initialStorage: { 'powersyncReadModeEnabled:v1': 'false' },
  });

  assert.equal(await loadPowerSyncReadModeEnabled(), false);
  assert.equal(getPowerSyncReadModeEnabledSnapshot(), false);
});

test('PowerSync read mode can be disabled and re-enabled as an escape hatch', async () => {
  const { loadPowerSyncReadModeEnabled, setPowerSyncReadModeEnabled, AsyncStorage } = createReadModeModule();

  await setPowerSyncReadModeEnabled(false);
  assert.equal(await AsyncStorage.getItem('powersyncReadModeEnabled:v1'), 'false');
  assert.equal(await loadPowerSyncReadModeEnabled(), false);

  await setPowerSyncReadModeEnabled(true);
  assert.equal(await AsyncStorage.getItem('powersyncReadModeEnabled:v1'), 'true');
  assert.equal(await loadPowerSyncReadModeEnabled(), true);
});

test('PowerSync read mode default can be disabled by app config', async () => {
  const { loadPowerSyncReadModeEnabled } = createReadModeModule({
    configuredDefault: 'false',
  });

  assert.equal(await loadPowerSyncReadModeEnabled(), false);
});
