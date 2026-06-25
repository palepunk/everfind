// FOSS placeholder: cloud builds replace this with the first-sync upload flow.
// Public builds can keep local inventory data but cannot upload it to the backend.

const unavailable = () => new Error('Cloud sync is not available in this edition.');

export const preparePowerSyncHouseForSyncEnable = async (_houseId: string, _userId: string) => {
  throw unavailable();
};

export const uploadPowerSyncHouseForFirstSync = async (_houseId: string, _userId: string) => {
  throw unavailable();
};
