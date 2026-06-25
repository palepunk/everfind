import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { getLastDismissedAt, observePendingCount, observePendingNewestCreatedAt } from './inboxRepo';

export function useInboxPending() {
  const [pendingCount, setPendingCount] = useState(0);
  const [newestPendingCreatedAt, setNewestPendingCreatedAt] = useState<number | null>(null);
  const [lastDismissedAt, setLastDismissedAt] = useState(0);

  useEffect(() => {
    if (Platform.OS !== 'ios') {
      setPendingCount(0);
      setNewestPendingCreatedAt(null);
      setLastDismissedAt(0);
      return;
    }

    getLastDismissedAt().then(setLastDismissedAt).catch(() => setLastDismissedAt(0));

    const subCount = observePendingCount().subscribe(setPendingCount);
    const subNewest = observePendingNewestCreatedAt().subscribe(setNewestPendingCreatedAt);

    return () => {
      subCount.unsubscribe();
      subNewest.unsubscribe();
    };
  }, []);

  return {
    pendingCount,
    newestPendingCreatedAt,
    lastDismissedAt,
    setLastDismissedAt,
  };
}
