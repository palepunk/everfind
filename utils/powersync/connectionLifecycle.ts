import { disconnectPowerSync } from './system';

// FOSS placeholder: cloud builds replace this with session-aware connection
// management. Public builds always disconnect from remote PowerSync.

export const syncPowerSyncConnectionForSession = async (_signedIn: boolean) => {
  await disconnectPowerSync();
  return { connected: false, reason: 'cloud_unavailable' };
};
