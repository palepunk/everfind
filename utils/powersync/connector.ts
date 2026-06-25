import type {
  AbstractPowerSyncDatabase,
  PowerSyncBackendConnector,
  PowerSyncCredentials,
} from '@powersync/react-native';

// FOSS placeholder: cloud builds replace this with the backend connector.
// Public builds never receive PowerSync credentials and cannot upload CRUD entries.

const unavailable = () => new Error('PowerSync cloud transport is not available in this edition.');

export class EverfindPowerSyncConnector implements PowerSyncBackendConnector {
  async fetchCredentials(): Promise<PowerSyncCredentials | null> {
    return null;
  }

  async uploadData(_database: AbstractPowerSyncDatabase) {
    throw unavailable();
  }
}
