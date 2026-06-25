import { Drawer } from "expo-router/drawer";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  PaperProvider,
  Snackbar,
  Divider,
  IconButton,
  Icon,
  Avatar,
  Text as PaperText,
  useTheme,
} from 'react-native-paper';
import { AppAlertHost } from '@/components/AppAlertHost';
import { AppProgressDialog } from '@/components/AppProgressDialog';
import { lightTheme, darkTheme } from '../../utils/theme/theme';
import {
  useHouses,
  useActiveHouse,
  useGlobalRefresh,
  triggerGlobalRefresh,
} from '../../utils/hooks/useDatabase';
import { DrawerContentScrollView } from '@react-navigation/drawer';
import { AppState, Platform, View, TouchableOpacity, useColorScheme } from 'react-native';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { router } from 'expo-router';
import type { AppTheme } from '../../utils/theme/theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemePreference, ThemePreferenceContext } from '../../utils/theme/themePreference';
import { getUserAvatarUrl, useAuth } from '../../utils/auth/AuthContext';
import { SignInSheetProvider, useSignInSheet } from '@/utils/auth/SignInSheetContext';
import { syncSettingsIfNeeded } from '../../utils/sync/settingsSync';
import { subscribeToSettingsUpdates } from '../../utils/sync/settingsSyncEvents';
import { useInboxPending } from '@/src/inbox';
import {
  bootstrapRemoteInventoryForUser,
  syncEnabledInventoryForUser,
} from '@/utils/sync/houseSyncCoordinator';
import { setActiveHouseSwitchInProgress } from '@/utils/navigation/activeHouseSwitchState';
import { editionCapabilities } from '@/utils/edition/config';

const THEME_PREFERENCE_KEY = 'themePreference';

/* ----------------------------- Drawer Content ----------------------------- */

function CustomDrawerContent(props: any) {
  const { colors, custom } = useTheme<AppTheme>();
  const { spacing, shapes, typography, opacity, surfaces } = custom;
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { openSignIn } = useSignInSheet();
  const avatarUrl = getUserAvatarUrl(user);
  const displayName =
    (user?.user_metadata as Record<string, any> | undefined)?.full_name ??
    (user?.user_metadata as Record<string, any> | undefined)?.name ??
    user?.email ??
    'Signed out';

  const globalRefreshKey = useGlobalRefresh();
  const { houses } = useHouses(globalRefreshKey);
  const { activeHouseId, setActiveHouseById } = useActiveHouse();

  const { onShowSnackbar } = props;
  const { pendingCount } = useInboxPending();
  const isIos = Platform.OS === 'ios';

  const handleHousePress = async (house: any) => {
    if (house.id !== activeHouseId) {
      setActiveHouseSwitchInProgress(true);
      try {
        await setActiveHouseById(house.id);
        onShowSnackbar(`Active house: ${house.name}`);
        router.replace('/');
      } finally {
        setTimeout(() => {
          setActiveHouseSwitchInProgress(false);
        }, 400);
      }
    }
    props.navigation.closeDrawer();
  };

  const handleHouseInfoPress = (house: any) => {
    router.push(`/houses/${house.id}`);
    props.navigation.closeDrawer();
  };

  const handleAddHousePress = () => {
    router.push('/houses/add');
    props.navigation.closeDrawer();
  };

  const handleJoinHousePress = () => {
    router.push('/houses/join');
    props.navigation.closeDrawer();
  };

  const handleNavigate = (path: string) => {
    router.push(path);
    props.navigation.closeDrawer();
  };

  const handleAccountPress = () => {
    if (user) {
      handleNavigate('/profile');
      return;
    }
    openSignIn();
    props.navigation.closeDrawer();
  };

  return (
    <DrawerContentScrollView
      {...props}
      testID="app-drawer-content"
      scrollIndicatorInsets={{ bottom: insets.bottom + spacing.xxl }}
      contentContainerStyle={{
        flexGrow: 1,
        paddingBottom: insets.bottom + spacing.xxxl,
        backgroundColor: colors.surface,
      }}
    >
      {/* Account Header */}
      {editionCapabilities.authentication ? <TouchableOpacity
        onPress={handleAccountPress}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: spacing.xxl,
          paddingTop: spacing.xxl,
          paddingBottom: spacing.lg,
        }}
      >
        {avatarUrl ? (
          <Avatar.Image size={44} source={{ uri: avatarUrl }} />
        ) : (
          <Avatar.Icon size={44} icon={user ? 'account' : 'account-outline'} />
        )}
        <View style={{ marginLeft: spacing.lg, flex: 1 }}>
          <PaperText variant="titleMedium" style={{ color: colors.onSurface }}>
            {displayName}
          </PaperText>
          <PaperText
            variant="bodyMedium"
            style={{ color: colors.onSurfaceVariant, marginTop: spacing.xs }}
          >
            {user ? 'View profile' : 'Click here to sign in'}
          </PaperText>
        </View>
      </TouchableOpacity> : null}

      {editionCapabilities.authentication ? <Divider style={{ marginBottom: spacing.sm }} /> : null}

      {editionCapabilities.siri && isIos ? (
        <>
          <TouchableOpacity
            onPress={() => handleNavigate('/inbox')}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: spacing.xxl,
              paddingVertical: spacing.lg,
            }}
          >
            <View style={{ width: 32, alignItems: 'center', marginRight: spacing.lg }}>
              <Icon source="inbox-outline" size={24} color={colors.onSurfaceVariant} />
            </View>
            <PaperText variant="bodyLarge" style={{ color: colors.onSurface, flex: 1 }}>
              Inbox
            </PaperText>
            {pendingCount > 0 ? (
              <View
                style={{
                  minWidth: 18,
                  height: 18,
                  borderRadius: 9,
                  paddingHorizontal: 4,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: colors.error,
                }}
              >
                <PaperText variant="labelSmall" style={{ color: colors.onError }}>
                  {pendingCount}
                </PaperText>
              </View>
            ) : null}
          </TouchableOpacity>

          <Divider style={{ marginBottom: spacing.sm }} />
        </>
      ) : null}

      {/* Section Header */}
      <View
        style={{
          paddingHorizontal: spacing.xxl,
          paddingTop: spacing.xxl,
          paddingBottom: spacing.sm,
        }}
      >
        <PaperText
          variant="titleMedium"
          style={{ color: colors.onSurface }}
        >
          Houses
        </PaperText>
      </View>

      {/* Houses List */}
      {houses.map((house) => {
        const isActive = house.id === activeHouseId;
        const isMemberHouse = Boolean(user?.id && house.ownerId && house.ownerId !== user.id);

        return (
          <TouchableOpacity
            key={house.id}
            onPress={() => handleHousePress(house)}
            testID={`drawer-house-${house.name.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || house.id}`}
            accessibilityLabel={`House ${house.name}`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: spacing.xxl,
              paddingVertical: spacing.lg,
              backgroundColor: isActive
                ? `${colors.primary}${opacity.alpha40}`
                : 'transparent',
            }}
          >
            {/* Icon */}
            <View
              style={{
                width: 32,
                alignItems: 'center',
                marginRight: spacing.lg,
              }}
            >
              <Icon
                source={isMemberHouse ? 'home-import-outline' : 'home-outline'}
                size={24}
                color={isActive ? colors.primary : colors.onSurfaceVariant}
              />
            </View>

            {/* Text */}
            <View style={{ flex: 1 }}>
              <PaperText
                variant="bodyLarge"
                style={{
                  color: isActive ? colors.primary : colors.onSurface,
                  fontWeight: isActive ? '600' : '400',
                }}
              >
                {house.name}
              </PaperText>

              <PaperText
                variant="bodyMedium"
                style={{
                  color: colors.onSurfaceVariant,
                  marginTop: spacing.xs,
                }}
              >
                {house.address || 'Tap to set active home'}
              </PaperText>
            </View>

            {/* Active check */}
            {isActive && (
              <Icon
                source="check"
                size={18}
                color={colors.primary}
                style={{ marginRight: spacing.sm }}
              />
            )}

            {/* Info */}
            <IconButton
              icon="information-outline"
              size={20}
              onPress={() => handleHouseInfoPress(house)}
            />
          </TouchableOpacity>
        );
      })}

      {/* Add House */}
      <TouchableOpacity
        onPress={handleAddHousePress}
        testID="drawer-add-house-button"
        accessibilityLabel="Add House"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: spacing.xxl,
          paddingVertical: spacing.lg,
        }}
      >
        <View
          style={{
            width: 32,
            alignItems: 'center',
            marginRight: spacing.lg,
          }}
        >
          <Icon source="plus" size={24} color={colors.primary} />
        </View>

        <PaperText
          variant="bodyLarge"
          style={{ color: colors.primary }}
        >
          Add House
        </PaperText>
      </TouchableOpacity>

      {editionCapabilities.collaboration ? <TouchableOpacity
        onPress={handleJoinHousePress}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: spacing.xxl,
          paddingVertical: spacing.lg,
        }}
      >
        <View
          style={{
            width: 32,
            alignItems: 'center',
            marginRight: spacing.lg,
          }}
        >
          <Icon source="account-plus-outline" size={24} color={colors.primary} />
        </View>

        <PaperText
          variant="bodyLarge"
          style={{ color: colors.primary }}
        >
          Join a House
        </PaperText>
      </TouchableOpacity> : null}

      <Divider style={{ marginVertical: spacing.lg }} />

      {/* Navigation Links */}
      {[
        { label: 'Import / Export', icon: 'file-import', path: '/import-export' },
        { label: 'Settings', icon: 'cog-outline', path: '/settings' },
        { label: 'About everfind', icon: 'information-outline', path: '/about' },
      ].map(({ label, icon, path }) => (
        <TouchableOpacity
          key={path}
          onPress={() => handleNavigate(path)}
          testID={
            path === '/about'
              ? 'drawer-about-everfind-button'
              : path === '/settings'
                ? 'drawer-settings-button'
              : undefined
          }
          accessibilityLabel={label}
          accessibilityRole="button"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: spacing.xxl,
            paddingVertical: spacing.lg,
          }}
        >
          <View
            style={{
              width: 32,
              alignItems: 'center',
              marginRight: spacing.lg,
            }}
          >
            <Icon
              source={icon}
              size={24}
              color={colors.onSurfaceVariant}
            />
          </View>

          <PaperText variant="bodyLarge" style={{ color: colors.onSurface }}>
            {label}
          </PaperText>
        </TouchableOpacity>
      ))}
    </DrawerContentScrollView>
  );
}

/* --------------------------------- Layout -------------------------------- */

export default function Layout() {
  const isIos = Platform.OS === 'ios';
  const colorScheme = useColorScheme();
  const systemTheme: 'light' | 'dark' = colorScheme === 'dark' ? 'dark' : 'light';
  const [themePreference, setThemePreference] = useState<ThemePreference>('system');
  const { user, isLoading, lastAuthEvent, lastSignInAt, consumeAuthEvent } = useAuth();
  const lastToastAtRef = useRef<number | null>(null);
  const syncDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inventoryRefreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSyncErrorAtRef = useRef<number | null>(null);

  useEffect(() => {
    const loadPreference = async () => {
      try {
        const storedPreference = await AsyncStorage.getItem(THEME_PREFERENCE_KEY);
        if (storedPreference === 'light' || storedPreference === 'dark' || storedPreference === 'system') {
          setThemePreference(storedPreference);
        }
      } catch (error) {
        console.warn('Failed to load theme preference', error);
      }
    };

    loadPreference();
  }, []);

  useEffect(() => {
    if (isLoading) {
      return;
    }
    if (lastSignInAt && lastToastAtRef.current !== lastSignInAt) {
      setSnackbarMessage('Signed in successfully');
      setSnackbarVisible(true);
      lastToastAtRef.current = lastSignInAt;
    }
    if (lastAuthEvent === 'SIGNED_IN') {
      consumeAuthEvent();
    }
  }, [consumeAuthEvent, isLoading, lastAuthEvent, lastSignInAt]);

  useEffect(() => {
    if (!user) return;

    const runSync = async () => {
      try {
        await syncSettingsIfNeeded(user.id);
      } catch (error) {
        console.warn('Settings sync failed', error);
        const now = Date.now();
        if (!lastSyncErrorAtRef.current || now - lastSyncErrorAtRef.current > 30000) {
          setSnackbarMessage('Sync failed');
          setSnackbarVisible(true);
          lastSyncErrorAtRef.current = now;
        }
      }
    };

    runSync();
  }, [user]);

  useEffect(() => {
    if (isLoading || !user) return;

    const scheduleSync = () => {
      if (syncDebounceRef.current) {
        clearTimeout(syncDebounceRef.current);
      }

      syncDebounceRef.current = setTimeout(async () => {
        try {
          await syncSettingsIfNeeded(user.id);
        } catch (error) {
          console.warn('Settings sync failed', error);
          const now = Date.now();
          if (!lastSyncErrorAtRef.current || now - lastSyncErrorAtRef.current > 30000) {
            setSnackbarMessage('Sync failed');
            setSnackbarVisible(true);
            lastSyncErrorAtRef.current = now;
          }
        }
      }, 500);
    };

    const unsubscribe = subscribeToSettingsUpdates((update) => {
      if (update.source !== 'local') return;
      scheduleSync();
    });

    return () => {
      if (syncDebounceRef.current) {
        clearTimeout(syncDebounceRef.current);
      }
      unsubscribe();
    };
  }, [isLoading, user]);

  useEffect(() => {
    if (isLoading || !user) return;

    const runInventorySync = async () => {
      try {
        await bootstrapRemoteInventoryForUser(user.id, {
          onBootstrapVisibilityChange: setInventoryBootstrapRefreshing,
        });
        triggerGlobalRefresh();
      } catch (error) {
        console.warn('Inventory sync failed', error);
        const now = Date.now();
        if (!lastSyncErrorAtRef.current || now - lastSyncErrorAtRef.current > 30000) {
          setSnackbarMessage('Sync failed');
          setSnackbarVisible(true);
          lastSyncErrorAtRef.current = now;
        }
      }
    };

    runInventorySync();
  }, [isLoading, user]);

  useEffect(() => {
    if (!user) return;

    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;

      if (inventoryRefreshDebounceRef.current) {
        clearTimeout(inventoryRefreshDebounceRef.current);
      }

      inventoryRefreshDebounceRef.current = setTimeout(async () => {
        try {
          await syncEnabledInventoryForUser(user.id);
          triggerGlobalRefresh();
        } catch (error) {
          console.warn('Inventory sync on foreground failed', error);
        }
      }, 300);
    });

    return () => {
      subscription.remove();
      if (inventoryRefreshDebounceRef.current) {
        clearTimeout(inventoryRefreshDebounceRef.current);
      }
    };
  }, [user]);

  const resolvedTheme: 'light' | 'dark' = themePreference === 'system' ? systemTheme : themePreference;
  const theme = resolvedTheme === 'dark' ? darkTheme : lightTheme;

  const [snackbarVisible, setSnackbarVisible] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [inventoryBootstrapRefreshing, setInventoryBootstrapRefreshing] = useState(false);

  const handleSetThemePreference = useCallback(async (preference: ThemePreference) => {
    setThemePreference(preference);
    try {
      await AsyncStorage.setItem(THEME_PREFERENCE_KEY, preference);
    } catch (error) {
      console.warn('Failed to persist theme preference', error);
    }
  }, []);

  const themePreferenceValue = useMemo(
    () => ({
      preference: themePreference,
      resolvedTheme,
      setPreference: handleSetThemePreference,
    }),
    [handleSetThemePreference, resolvedTheme, themePreference],
  );

  return (
    <SafeAreaProvider>
      <ThemePreferenceContext.Provider value={themePreferenceValue}>
        <PaperProvider theme={theme}>
          <AppAlertHost />
          <SignInSheetProvider>
            <AppProgressDialog
              visible={inventoryBootstrapRefreshing}
              title="Syncing"
              message="Syncing your houses and inventory..."
            />
            <Drawer
              screenOptions={{
                headerShown: false,
                detachInactiveScreens: true,
                drawerStyle: {
                  backgroundColor: theme.colors.surface,
                },
              }}
              drawerContent={(props) => (
                <CustomDrawerContent
                  key={refreshKey}
                  {...props}
                  onShowSnackbar={(message: string) => {
                    setSnackbarMessage(message);
                    setSnackbarVisible(true);
                  }}
                  onDatabaseReset={() => setRefreshKey(prev => prev + 1)}
                />
              )}
            >
              <Drawer.Screen name="index" options={{ headerShown: false }} />
              <Drawer.Screen name="houses/index" options={{ headerShown: false }} />
              <Drawer.Screen name="houses/[id]" options={{ headerShown: false }} />
              <Drawer.Screen name="houses/join" options={{ headerShown: false }} />
              <Drawer.Screen name="search/index" options={{ headerShown: false }} />
              <Drawer.Screen name="inbox" options={{ headerShown: false }} />
              <Drawer.Screen name="import-export/index" options={{ headerShown: false }} />
              <Drawer.Screen name="settings/index" options={{ headerShown: false }} />
              <Drawer.Screen name="settings/powersync" options={{ headerShown: false }} />
              <Drawer.Screen name="about/index" options={{ headerShown: false }} />
              <Drawer.Screen name="profile" options={{ headerShown: false }} />
              <Drawer.Screen name="sign-in" options={{ headerShown: false }} />
              <Drawer.Screen name="(stack)" options={{ headerShown: false }} />
            </Drawer>

            <Snackbar
              visible={snackbarVisible}
              onDismiss={() => setSnackbarVisible(false)}
              duration={2000}
            >
              {snackbarMessage}
            </Snackbar>
          </SignInSheetProvider>
        </PaperProvider>
      </ThemePreferenceContext.Provider>
    </SafeAreaProvider>
  );
}
