import type { PowerSyncImageTable } from './imageUpload';

// FOSS placeholder: cloud builds replace this with remote image download handling.
// Public builds do not fetch images from backend storage.

type RemoteImageDownload = {
  table: PowerSyncImageTable;
  houseId: string;
  id: string;
  remotePath?: string | null;
  localPath?: string | null;
  database?: unknown;
};

export const enqueuePowerSyncRemoteImageDownload = async (_params: RemoteImageDownload) => undefined;
export const processPendingPowerSyncRemoteImageDownloads = async (_database?: unknown) => undefined;
export const enqueueAndProcessPowerSyncRemoteImageDownload = async (_params: RemoteImageDownload) =>
  undefined;

export const __private__ = {};
