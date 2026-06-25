import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';

const STORAGE_KEY = 'iosSpotlightItemsEnabled';

export const loadSpotlightItemsEnabled = async () => {
  if (Platform.OS !== 'ios') return false;
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  if (stored === 'true') return true;
  if (stored === 'false') return false;
  return true;
};

export const saveSpotlightItemsEnabled = async (enabled: boolean) => {
  await AsyncStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
};

export const useSpotlightItemsEnabled = () => {
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    loadSpotlightItemsEnabled()
      .then((value) => {
        if (!active) return;
        setEnabled(value);
        setReady(true);
      })
      .catch(() => {
        if (!active) return;
        setEnabled(false);
        setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const updateEnabled = useCallback(async (next: boolean) => {
    setEnabled(next);
    await saveSpotlightItemsEnabled(next);
  }, []);

  return { enabled, setEnabled: updateEnabled, ready };
};
