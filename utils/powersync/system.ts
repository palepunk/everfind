import { PowerSyncDatabase } from '@powersync/react-native';
import { OPSqliteOpenFactory } from '@powersync/op-sqlite';

import { EverfindPowerSyncConnector } from './connector';
import { AppSchema } from './schema';

const POWERSYNC_DB_FILENAME = 'everfind-powersync-v2.db';
const POWERSYNC_DB_LOCATION = 'powersync';

let powerSyncDatabase: PowerSyncDatabase | null = null;

export const getPowerSyncDatabase = () => {
  if (!powerSyncDatabase) {
    const opSqlite = new OPSqliteOpenFactory({
      dbFilename: POWERSYNC_DB_FILENAME,
      dbLocation: POWERSYNC_DB_LOCATION,
    });

    powerSyncDatabase = new PowerSyncDatabase({
      schema: AppSchema,
      database: opSqlite,
    });
  }

  return powerSyncDatabase;
};

export const connectPowerSyncForCurrentUser = async () => {
  const database = getPowerSyncDatabase();
  if (!database.connected && !database.connecting) {
    await database.connect(new EverfindPowerSyncConnector());
  }
  return database;
};

export const disconnectPowerSync = async (options?: {
  /** Clears synced tables, the upload queue, and local-only tables. */
  clearLocal?: boolean;
  /** Clears synced tables and the upload queue; local-only tables are preserved. */
  clearSynced?: boolean;
}) => {
  if (!powerSyncDatabase) return;

  if (options?.clearSynced && !options.clearLocal) {
    await powerSyncDatabase.disconnectAndClear({ clearLocal: false });
    return;
  }

  if (options?.clearLocal) {
    await powerSyncDatabase.disconnectAndClear();
    return;
  }

  await powerSyncDatabase.disconnect();
};
