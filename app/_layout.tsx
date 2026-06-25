import { Stack, router, useRootNavigationState } from 'expo-router';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import * as Linking from 'expo-linking';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { migrateStoredImages } from '@/utils/imageMigration';
import { migrateLegacyItemImages } from '@/utils/itemImageMigration';
import { ensurePowerSyncLocalDataMigratedOnStartup } from '@/utils/powersync/startupMigration';
import { AuthProvider, useAuth } from '@/utils/auth/AuthContext';
import { syncPowerSyncConnectionForSession } from '@/utils/powersync/connectionLifecycle';
import { AnalyticsProvider } from '@/utils/analytics/AnalyticsProvider';
import { importPendingSiriQueue } from '@/src/inbox';
import {
  addSpotlightURLListener,
  consumePendingSpotlightURL,
  normalizeSpotlightDeepLinkItemId,
  reindexAllSpotlightItems,
} from '@/src/spotlight/spotlightIndex';
import { hasEditionCapability } from '@/utils/edition/config';

function PowerSyncConnectionLifecycle() {
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!hasEditionCapability('cloudSync')) return;
    if (isLoading) return;

    syncPowerSyncConnectionForSession(Boolean(user)).catch((error) => {
      console.warn('PowerSync connection lifecycle failed', error);
    });
  }, [isLoading, user]);

  return null;
}

export default function RootLayout() {
  const navigationState = useRootNavigationState();

  useEffect(() => {
    migrateStoredImages().catch((error) => {
      console.warn('Image migration failed', error);
    });
    migrateLegacyItemImages().catch((error) => {
      console.warn('Item image migration failed', error);
    });
    ensurePowerSyncLocalDataMigratedOnStartup().catch((error) => {
      console.warn('PowerSync local data migration failed', error);
    });

    if (
      Platform.OS !== 'ios' ||
      (!hasEditionCapability('siri') && !hasEditionCapability('voice'))
    ) {
      return;
    }

    let importing = false;
    let lastSpotlightReindexAt = 0;
    let latestAppState = AppState.currentState;
    let queuedSpotlightURL: string | null = null;
    let lastNavigatedSpotlightURL: string | null = null;
    let lastNavigatedSpotlightAt = 0;
    const scheduledPendingSpotlightChecks = new Set<ReturnType<typeof setTimeout>>();
    const scheduledQueuedSpotlightNavigations = new Set<ReturnType<typeof setTimeout>>();
    const runSiriImport = async () => {
      if (importing) return;
      importing = true;
      try {
        const imported = await importPendingSiriQueue();
        if (imported > 0) {
          console.log(`[SiriImport] Imported ${imported} inbox entr${imported === 1 ? 'y' : 'ies'}.`);
        }
      } catch (error) {
        console.warn('Siri inbox import failed', error);
      } finally {
        importing = false;
      }
    };

    let handlingPendingSpotlightLink = false;
    const navigateToSpotlightItem = (url: string | null) => {
      if (!url) return;
      const itemId = normalizeSpotlightDeepLinkItemId(url);
      if (!itemId) return;
      const now = Date.now();
      if (lastNavigatedSpotlightURL === url && now - lastNavigatedSpotlightAt < 1500) return;
      lastNavigatedSpotlightURL = url;
      lastNavigatedSpotlightAt = now;

      const runNavigation = (attempt: number) => {
        if (router.canDismiss()) {
          router.dismissAll();
        }
        setTimeout(() => {
          router.navigate({
            pathname: '/items/[id]',
            params: { id: itemId, entry: 'direct', deepLinkSource: 'spotlight' },
          });
        }, 0);
      };

      runNavigation(1);
      setTimeout(() => runNavigation(2), 250);
    };

    const flushQueuedSpotlightNavigation = () => {
      if (latestAppState !== 'active' || !queuedSpotlightURL) {
        return;
      }
      const url = queuedSpotlightURL;
      queuedSpotlightURL = null;
      navigateToSpotlightItem(url);
    };

    const scheduleQueuedSpotlightNavigation = () => {
      for (const timeoutId of scheduledQueuedSpotlightNavigations) {
        clearTimeout(timeoutId);
      }
      scheduledQueuedSpotlightNavigations.clear();

      for (const delay of [0, 200, 600]) {
        const timeoutId = setTimeout(() => {
          scheduledQueuedSpotlightNavigations.delete(timeoutId);
          flushQueuedSpotlightNavigation();
        }, delay);
        scheduledQueuedSpotlightNavigations.add(timeoutId);
      }
    };

    const queueSpotlightNavigation = (url: string | null) => {
      if (!url) return;
      if (!normalizeSpotlightDeepLinkItemId(url)) return;
      queuedSpotlightURL = url;
      scheduleQueuedSpotlightNavigation();
    };

    const runSpotlightReindex = async () => {
      const now = Date.now();
      if (now - lastSpotlightReindexAt < 45_000) {
        return;
      }
      lastSpotlightReindexAt = now;
      try {
        await reindexAllSpotlightItems();
      } catch (error) {
        console.warn('Spotlight reindex failed', error);
      }
    };

    const handlePendingSpotlightLink = async () => {
      if (handlingPendingSpotlightLink) return;
      handlingPendingSpotlightLink = true;
      try {
        const pendingURL = await consumePendingSpotlightURL();
        queueSpotlightNavigation(pendingURL);
      } catch (error) {
        console.warn('Handling pending Spotlight link failed', error);
      } finally {
        handlingPendingSpotlightLink = false;
      }
    };

    const schedulePendingSpotlightChecks = () => {
      for (const timeoutId of scheduledPendingSpotlightChecks) {
        clearTimeout(timeoutId);
      }
      scheduledPendingSpotlightChecks.clear();

      for (const delay of [0, 250, 750, 1500]) {
        const timeoutId = setTimeout(() => {
          scheduledPendingSpotlightChecks.delete(timeoutId);
          handlePendingSpotlightLink().catch(() => undefined);
        }, delay);
        scheduledPendingSpotlightChecks.add(timeoutId);
      }
    };

    runSiriImport().catch(() => undefined);
    runSpotlightReindex().catch(() => undefined);
    schedulePendingSpotlightChecks();

    const linkingSubscription = Linking.addEventListener('url', ({ url }) => {
      queueSpotlightNavigation(url);
      schedulePendingSpotlightChecks();
    });
    const spotlightSubscription = addSpotlightURLListener((url) => {
      queueSpotlightNavigation(url);
      schedulePendingSpotlightChecks();
    });

    const subscription = AppState.addEventListener('change', (state) => {
      latestAppState = state;
      if (state === 'background' || state === 'inactive') {
        lastNavigatedSpotlightURL = null;
        lastNavigatedSpotlightAt = 0;
      }
      if (state === 'active') {
        runSiriImport().catch(() => undefined);
        runSpotlightReindex().catch(() => undefined);
        schedulePendingSpotlightChecks();
        scheduleQueuedSpotlightNavigation();
      }
    });

    return () => {
      for (const timeoutId of scheduledPendingSpotlightChecks) {
        clearTimeout(timeoutId);
      }
      scheduledPendingSpotlightChecks.clear();
      for (const timeoutId of scheduledQueuedSpotlightNavigations) {
        clearTimeout(timeoutId);
      }
      scheduledQueuedSpotlightNavigations.clear();
      spotlightSubscription.remove();
      linkingSubscription.remove();
      subscription.remove();
    };
  }, [navigationState?.key]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <PowerSyncConnectionLifecycle />
        <AnalyticsProvider>
          <BottomSheetModalProvider>
            <Stack
              screenOptions={{
                headerShown: false,
              }}
            />
          </BottomSheetModalProvider>
        </AnalyticsProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
