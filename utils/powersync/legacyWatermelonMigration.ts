export type PowerSyncLocalDataMigrationResult = {
  skipped: boolean;
  rowCounts: Record<string, number>;
};

export const runPowerSyncLocalDataMigration = async (): Promise<PowerSyncLocalDataMigrationResult> => ({
  skipped: true,
  rowCounts: {},
});

export const __private__ = {};
