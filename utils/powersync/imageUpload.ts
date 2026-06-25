// FOSS placeholder: cloud builds replace this with Supabase Storage uploads.
// Public builds keep local image paths only and never create remote storage paths.

export type PowerSyncImageTable =
  | 'houses'
  | 'rooms'
  | 'containers'
  | 'boxes'
  | 'items'
  | 'item_images';

export const uploadPowerSyncImageIfNeeded = async (_params: {
  table: PowerSyncImageTable;
  houseId: string;
  id: string;
  imagePath?: string | null;
}) => null;

export const deletePowerSyncRemoteImageIfNeeded = async (_remotePath?: string | null) => undefined;

export const __private__ = {};
