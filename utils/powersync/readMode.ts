import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const POWERSYNC_READ_MODE_KEY = 'powersyncReadModeEnabled:v1';

type ReadModeListener = (enabled: boolean) => void;

const DEFAULT_POWERSYNC_READ_MODE_ENABLED = true;

let cachedPowerSyncReadModeEnabled = DEFAULT_POWERSYNC_READ_MODE_ENABLED;
let readModeLoaded = false;
const readModeListeners: ReadModeListener[] = [];

const getPowerSyncReadModeDefault = () => {
  const configuredDefault = Constants.expoConfig?.extra?.powerSyncReadModeDefault ?? process.env.EXPO_PUBLIC_POWERSYNC_READ_MODE_DEFAULT;
  if (configuredDefault === 'false') return false;
  if (configuredDefault === 'true') return true;
  return DEFAULT_POWERSYNC_READ_MODE_ENABLED;
};

const notifyPowerSyncReadModeListeners = (enabled: boolean) => {
  cachedPowerSyncReadModeEnabled = enabled;
  readModeListeners.forEach((listener) => listener(enabled));
};

export const loadPowerSyncReadModeEnabled = async () => {
  const storedValue = await AsyncStorage.getItem(POWERSYNC_READ_MODE_KEY);
  const enabled = storedValue === null ? getPowerSyncReadModeDefault() : storedValue === 'true';
  readModeLoaded = true;
  notifyPowerSyncReadModeListeners(enabled);
  return enabled;
};

export const setPowerSyncReadModeEnabled = async (enabled: boolean) => {
  await AsyncStorage.setItem(POWERSYNC_READ_MODE_KEY, enabled ? 'true' : 'false');
  readModeLoaded = true;
  notifyPowerSyncReadModeListeners(enabled);
};

export const getPowerSyncReadModeEnabledSnapshot = () => cachedPowerSyncReadModeEnabled;

export function usePowerSyncReadModeEnabled() {
  const [enabled, setEnabled] = useState(getPowerSyncReadModeEnabledSnapshot());

  useEffect(() => {
    let mounted = true;
    const listener: ReadModeListener = (nextEnabled) => {
      if (mounted) setEnabled(nextEnabled);
    };
    readModeListeners.push(listener);

    if (!readModeLoaded) {
      loadPowerSyncReadModeEnabled().catch((error) => {
        console.warn('Failed to load PowerSync read mode setting', error);
      });
    }

    return () => {
      mounted = false;
      const index = readModeListeners.indexOf(listener);
      if (index >= 0) readModeListeners.splice(index, 1);
    };
  }, []);

  return enabled;
}

export const __private__ = {
  POWERSYNC_READ_MODE_KEY,
  getPowerSyncReadModeDefault,
  notifyPowerSyncReadModeListeners,
};
