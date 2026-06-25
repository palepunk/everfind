import { getPowerSyncDatabase } from './system';

export const getPowerSyncUploadQueueStatsSnapshot = async () => {
  const database = getPowerSyncDatabase();
  const row = await database.database.getOptional<{ count: number }>('SELECT count(*) as count FROM ps_crud');

  return {
    count: row?.count ?? 0,
  };
};

export const getPowerSyncStatusSnapshot = async () => {
  const database = getPowerSyncDatabase();
  const uploadQueue = await getPowerSyncUploadQueueStatsSnapshot();

  return {
    connected: database.connected,
    connecting: database.connecting,
    ready: database.ready,
    uploadQueue,
  };
};
