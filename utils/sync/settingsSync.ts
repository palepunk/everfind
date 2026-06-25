import { loadLastSyncAt } from './settingsMetadata';

// FOSS placeholder: cloud builds replace this file with remote settings sync.
// Public builds still expose the API because shared layout/settings screens call it.
// No data leaves the device in this implementation.

export const syncSettingsForUser = async (_userId: string) => 0;
export const syncSettingsIfNeeded = async (_userId: string) => 0;
export const loadLastSyncTimeLabel = async () => null;
export const getLastSyncAt = async () => await loadLastSyncAt();
