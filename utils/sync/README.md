# Sync Boundaries

The FOSS edition has no backend sync service. This directory still exists
because shared screens need stable sync-state APIs, and because the app keeps
some local compatibility metadata for older installs.

Files in this directory fall into three groups:

- FOSS no-op remote sync contracts, such as `settingsSync.ts`.
- Shared local metadata/state helpers, such as `settingsMetadata.ts`,
  `houseSyncState.ts`, and `bootstrapState.ts`.
- Legacy cleanup helpers for old custom sync state, such as `inventorySync.ts`.

Cloud builds replace only the remote implementation pieces from the private
repo. FOSS builds keep local inventory data in PowerSync local SQLite tables and
never connect to a backend.
