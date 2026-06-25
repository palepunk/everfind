// Local event bus for settings changes.
// FOSS only emits local updates; cloud builds may also use the remote source.

export type SettingsUpdateSource = 'local' | 'remote';

export type SettingsUpdate = {
  speechLanguage?: string;
  currency?: string;
  updatedAt?: number;
  source: SettingsUpdateSource;
};

const listeners = new Set<(update: SettingsUpdate) => void>();

export const emitSettingsUpdate = (update: SettingsUpdate) => {
  listeners.forEach((listener) => listener(update));
};

export const subscribeToSettingsUpdates = (listener: (update: SettingsUpdate) => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
