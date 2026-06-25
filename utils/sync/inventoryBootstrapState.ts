// UI-only bootstrap flag shared by sync-capable screens.
// FOSS keeps the flag for compatibility, but no backend bootstrap runs.

let inventoryBootstrapInProgress = false;

export const setInventoryBootstrapInProgress = (value: boolean) => {
  inventoryBootstrapInProgress = value;
};

export const isInventoryBootstrapInProgress = () => inventoryBootstrapInProgress;
