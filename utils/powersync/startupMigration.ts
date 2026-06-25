let startupMigrationPromise: Promise<void> | null = null;

export const ensurePowerSyncLocalDataMigratedOnStartup = async () => {
  if (!startupMigrationPromise) {
    startupMigrationPromise = Promise.resolve();
  }

  return startupMigrationPromise;
};

export const __private__ = {
  resetStartupMigrationForTests: () => {
    startupMigrationPromise = null;
  },
};
