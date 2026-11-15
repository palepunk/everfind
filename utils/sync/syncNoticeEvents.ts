// Local event bus for short, user-facing sync notices.
// FOSS never emits; cloud builds use it to tell the user about sync problems
// from code that has no access to the UI (for example the upload connector).

const listeners = new Set<(message: string) => void>();

export const emitSyncNotice = (message: string) => {
  listeners.forEach((listener) => listener(message));
};

export const subscribeToSyncNotices = (listener: (message: string) => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
