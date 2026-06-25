import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, View } from 'react-native';
import {
  Appbar,
  Button,
  RadioButton,
  Switch,
  Text,
  TextInput,
  Surface,
  useTheme,
  List,
} from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { router, useFocusEffect } from 'expo-router';
import * as NavigationBar from 'expo-navigation-bar';
import Constants from 'expo-constants';
import { useActiveHouse, triggerGlobalRefresh } from '../../../utils/hooks/useDatabase';
import type { AppTheme } from '../../../utils/theme/theme';
import { ThemePreference, useThemePreference } from '../../../utils/theme/themePreference';
import { SPEECH_LANGUAGE_OPTIONS, useSpeechLanguage } from '../../../utils/speechLanguage';
import { useCurrencyPreference } from '../../../utils/currency';
import { useAuth } from '../../../utils/auth/AuthContext';
import { useSignInSheet } from '@/utils/auth/SignInSheetContext';
import { loadLastSyncAt, loadSyncedHouseIds } from '../../../utils/sync/settingsMetadata';
import { syncSettingsIfNeeded } from '../../../utils/sync/settingsSync';
import { syncPowerSyncConnectionForSession } from '@/utils/powersync/connectionLifecycle';
import { useSpotlightItemsEnabled } from '../../../utils/spotlightPreference';
import { clearSpotlightIndex, reindexAllSpotlightItems } from '../../../src/spotlight/spotlightIndex';
import { getPlanLimitSnapshot } from '../../../utils/limits';
import { editionCapabilities } from '@/utils/edition/config';
import { AppConfirmDialog } from '@/components/AppConfirmDialog';

export default function SettingsScreen() {
  const { colors, custom } = useTheme<AppTheme>();
  const { spacing, shapes, typography, elevation, surfaces } = custom;

  const { resetDatabase } = useActiveHouse();
  const { preference: themePreference, resolvedTheme, setPreference: setThemePreference } = useThemePreference();
  const { language: speechLanguage, setLanguage: setSpeechLanguage } = useSpeechLanguage();
  const { currency, setCurrency: setCurrencyPreference } = useCurrencyPreference();
  const [currencyInput, setCurrencyInput] = useState(currency);
  const { user, isLoading: authLoading } = useAuth();
  const { openSignIn } = useSignInSheet();
  const [syncedHouseIds, setSyncedHouseIds] = useState<string[]>([]);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [resetDialogVisible, setResetDialogVisible] = useState(false);
  const [languageMenuVisible, setLanguageMenuVisible] = useState(false);
  const [currentPlanName, setCurrentPlanName] = useState('Free');
  const { enabled: spotlightEnabled, setEnabled: setSpotlightEnabled, ready: spotlightReady } =
    useSpotlightItemsEnabled();
  const insets = useSafeAreaInsets();
  const appVariant = String(Constants.expoConfig?.extra?.appVariant ?? process.env.APP_VARIANT ?? 'development');
  const showPowerSyncDiagnostics =
    editionCapabilities.cloudSync && (__DEV__ || appVariant === 'development');

  const handleResetDatabase = () => {
    setResetDialogVisible(true);
  };

  const confirmResetDatabase = useCallback(async () => {
    await resetDatabase();
    if (user) {
      try {
        await syncPowerSyncConnectionForSession(true);
      } catch (error) {
        console.warn('PowerSync reconnect after database reset failed', error);
      }
    }
    triggerGlobalRefresh();
    setResetDialogVisible(false);
  }, [resetDatabase, user]);

  const themeOptions = useMemo(
    () => [
      { label: 'Light', value: 'light' as const },
      { label: 'Dark', value: 'dark' as const },
      { label: 'System', value: 'system' as const },
    ],
    []
  );

  const selectedSpeechLabel =
    SPEECH_LANGUAGE_OPTIONS.find((option) => option.value === speechLanguage)?.label ||
    'English';

  const statusBarStyle = resolvedTheme === 'dark' ? 'light' : 'dark';

  useEffect(() => {
    if (languageMenuVisible) {
      setLanguageMenuVisible(false);
    }
  }, [speechLanguage]);

  useEffect(() => {
    setCurrencyInput(currency);
  }, [currency]);

  const loadSyncState = useCallback(async () => {
    try {
      const [houseIds, lastSyncAt] = await Promise.all([loadSyncedHouseIds(), loadLastSyncAt()]);
      setSyncedHouseIds(houseIds);
      setLastSyncTime(lastSyncAt ? new Date(lastSyncAt).toLocaleString() : null);
    } catch (error) {
      console.warn('Failed to load sync settings', error);
    }
  }, []);

  const loadPlanState = useCallback(async () => {
    try {
      const snapshot = await getPlanLimitSnapshot();
      const rawPlanId = snapshot.planId || 'free';
      const label = rawPlanId
        .split('_')
        .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
        .join(' ');
      setCurrentPlanName(label);
    } catch (error) {
      console.warn('Failed to load plan state', error);
      setCurrentPlanName('Free');
    }
  }, []);

  useEffect(() => {
    loadSyncState();
  }, [loadSyncState]);

  useEffect(() => {
    loadPlanState();
  }, [loadPlanState]);

  useFocusEffect(
    useCallback(() => {
      loadSyncState();
    }, [loadSyncState])
  );

  useFocusEffect(
    useCallback(() => {
      loadPlanState();
    }, [loadPlanState])
  );

  useFocusEffect(
    useCallback(() => {
      NavigationBar.setBackgroundColorAsync('transparent');
      NavigationBar.setBorderColorAsync('transparent');
      NavigationBar.setVisibilityAsync('visible');
      NavigationBar.setButtonStyleAsync(resolvedTheme === 'dark' ? 'light' : 'dark');
      NavigationBar.setBehaviorAsync('overlay-swipe');
    }, [colors.background, resolvedTheme])
  );

  const isSignedIn = Boolean(user);
  const syncNowAvailable = isSignedIn && syncedHouseIds.length > 0 && !authLoading;

  const handleSyncNow = useCallback(async () => {
    if (!syncNowAvailable || !user) return;
    setSyncBusy(true);
    try {
      const [settingsSyncAt, powerSyncConnectedAt] = await Promise.all([
        syncSettingsIfNeeded(user.id),
        syncPowerSyncConnectionForSession(true).then(() => Date.now()),
      ]);
      const latest = Math.max(settingsSyncAt ?? 0, powerSyncConnectedAt ?? 0);
      if (latest) {
        setLastSyncTime(new Date(latest).toLocaleString());
      } else {
        await loadSyncState();
      }
    } catch (error) {
      console.warn('Manual sync failed', error);
      Alert.alert('Sync failed', 'Unable to sync. Please try again.');
    } finally {
      setSyncBusy(false);
    }
  }, [loadSyncState, syncNowAvailable, user]);

  const handleToggleSpotlight = useCallback(
    async (next: boolean) => {
      await setSpotlightEnabled(next);
      if (next) {
        await reindexAllSpotlightItems();
        return;
      }
      await clearSpotlightIndex();
    },
    [setSpotlightEnabled]
  );

  return (
    <>
      <StatusBar style={statusBarStyle} backgroundColor="transparent" translucent={false} />

      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
        {/* App Bar */}
        <Appbar.Header
          style={{
            backgroundColor: colors.surface,
            elevation: elevation.level0,
          }}
        >
          <Appbar.BackAction onPress={() => router.back()} />
          <Appbar.Content title="Settings" style={{ alignItems: 'flex-start' }} titleStyle={{ textAlign: 'left' }} />
        </Appbar.Header>

        <ScrollView
          style={{ flex: 1, backgroundColor: colors.background }}
          contentContainerStyle={{
            padding: spacing.xxl,
            paddingBottom: spacing.xxl + insets.bottom,
            gap: spacing.lg,
          }}
        >
          {/* Appearance */}
          <Surface
            testID="settings-appearance-section"
            elevation={elevation.level1}
            style={{
              backgroundColor: surfaces.card,
              borderRadius: shapes.cornerLarge,
              padding: spacing.xxl,
            }}
          >
            <Text variant="titleMedium">Appearance</Text>

            <View style={{ marginTop: spacing.lg }}>
              <RadioButton.Group
                onValueChange={(value) =>
                  setThemePreference(value as ThemePreference)
                }
                value={themePreference}
              >
                {themeOptions.map((option) => (
                  <Pressable
                    key={option.value}
                    testID={`settings-theme-${option.value}-option`}
                    accessibilityLabel={`Appearance ${option.label}`}
                    onPress={() => setThemePreference(option.value)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingVertical: spacing.sm,
                    }}
                  >
                    <RadioButton value={option.value} />
                    <Text variant="bodyLarge">{option.label}</Text>
                  </Pressable>
                ))}
              </RadioButton.Group>
            </View>
          </Surface>

          {/* Language */}
          <Surface
            elevation={elevation.level1}
            style={{
              backgroundColor: surfaces.card,
              borderRadius: shapes.cornerLarge,
              padding: spacing.xxl,
            }}
          >

            <View style={{ marginTop: spacing.lg }}>
              <Text variant="titleMedium">Language</Text>
              <View style={{ marginTop: spacing.lg }}>
              <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
                Speech recognition
              </Text>
              <List.Accordion
                title={selectedSpeechLabel}
                expanded={languageMenuVisible}
                onPress={() => setLanguageMenuVisible((prev) => !prev)}
                style={{ marginTop: spacing.md, backgroundColor: surfaces.cardLow }}
              >
                {SPEECH_LANGUAGE_OPTIONS.map((option) => (
                  <List.Item
                    key={option.value}
                    title={option.label}
                    onPress={() => {
                      setSpeechLanguage(option.value);
                      setLanguageMenuVisible(false);
                    }}
                  />
                ))}
              </List.Accordion>
              </View>

              <View style={{ marginTop: spacing.lg }}>
                <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
                  Default currency
                </Text>
                <TextInput
                  mode="outlined"
                  placeholder="USD"
                  value={currencyInput}
                  autoCapitalize="characters"
                  onChangeText={(value) => setCurrencyInput(value.toUpperCase())}
                  onBlur={() => setCurrencyPreference(currencyInput.trim() || 'USD')}
                  style={{ marginTop: spacing.md }}
                />
              </View>
            </View>

          </Surface>

          {editionCapabilities.siri && Platform.OS === 'ios' ? (
            <Surface
              elevation={elevation.level1}
              style={{
                backgroundColor: surfaces.card,
                borderRadius: shapes.cornerLarge,
                padding: spacing.xxl,
              }}
            >
              <Text variant="titleMedium">Search</Text>
              <View
                style={{
                  marginTop: spacing.lg,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <View style={{ flex: 1, marginRight: spacing.md }}>
                  <Text variant="bodyLarge">Show items in iOS Spotlight</Text>
                  <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
                    Makes item name and location searchable from iPhone Spotlight.
                  </Text>
                </View>
                <Switch
                  value={spotlightEnabled}
                  onValueChange={handleToggleSpotlight}
                  disabled={!spotlightReady}
                />
              </View>
            </Surface>
          ) : null}

          {editionCapabilities.authentication ? <>
          {/* Account / Subscription */}
          <Surface
            elevation={elevation.level1}
            style={{
              backgroundColor: surfaces.card,
              borderRadius: shapes.cornerLarge,
              padding: spacing.xxl,
            }}
          >
            <Text variant="titleMedium">Account / Subscription</Text>

            <View style={{ marginTop: spacing.lg }}>
              <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
                Current plan
              </Text>
              <Text variant="bodyLarge">{currentPlanName}</Text>
            </View>

            <View style={{ marginTop: spacing.lg }}>
              <Text variant="bodyLarge">Upgrade</Text>
              <Text
                variant="bodyMedium"
                style={{ color: colors.onSurfaceVariant }}
              >
                Coming soon
              </Text>
            </View>

            <View style={{ marginTop: spacing.lg }}>
              <Text variant="bodyLarge">Restore purchase</Text>
              <Text
                variant="bodyMedium"
                style={{ color: colors.onSurfaceVariant }}
              >
                Coming soon
              </Text>
            </View>
          </Surface>

          {/* Sync */}
          <Surface
            elevation={elevation.level1}
            style={{
              backgroundColor: surfaces.card,
              borderRadius: shapes.cornerLarge,
              padding: spacing.xxl,
            }}
          >
            <Text variant="titleMedium">Sync</Text>

            <View style={{ marginTop: spacing.lg }}>
              <Text variant="bodyLarge">Cloud sync</Text>
              <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
                Cloud sync is configured per house on each house screen.
              </Text>
              <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant, marginTop: spacing.xs }}>
                {syncedHouseIds.length} {syncedHouseIds.length === 1 ? 'house' : 'houses'} enabled
              </Text>
            </View>

            {!isSignedIn ? (
              <View style={{ marginTop: spacing.md }}>
                <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
                  Sync works only for signed in users.
                </Text>
                <Button
                  mode="outlined"
                  style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }}
                  onPress={openSignIn}
                >
                  Sign in
                </Button>
              </View>
            ) : null}

            <View style={{ marginTop: spacing.md }}>
              <Button
                mode="outlined"
                loading={syncBusy}
                disabled={!syncNowAvailable || syncBusy}
                onPress={handleSyncNow}
                style={{ alignSelf: 'flex-start' }}
              >
                Sync now
              </Button>
            </View>

            <View style={{ marginTop: spacing.lg }}>
              <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
                Last sync
              </Text>
              <Text variant="bodyLarge">
                {lastSyncTime || 'Not synced yet'}
              </Text>
            </View>
          </Surface>
          </> : null}

          {/* Advanced */}
          <Surface
            elevation={elevation.level1}
            style={{
              backgroundColor: surfaces.card,
              borderRadius: shapes.cornerLarge,
              padding: spacing.xxl,
            }}
          >
            <Text variant="titleMedium">Advanced</Text>

            <View style={{ marginTop: spacing.lg }}>
              <Text
                variant="bodyLarge"
                style={{ color: colors.error }}
              >
                Reset database
              </Text>
              <Text
                variant="bodyMedium"
                style={{ color: colors.onSurfaceVariant }}
              >
                Deletes local data. If sync is enabled, remote data is deleted too.
              </Text>

              <Button
                mode="outlined"
                textColor={colors.error}
                style={{
                  marginTop: spacing.sm,
                  alignSelf: 'flex-start',
                  borderColor: colors.error,
                }}
                onPress={handleResetDatabase}
                testID="settings-reset-database-button"
                accessibilityLabel="Reset database"
              >
                Reset
              </Button>
            </View>

            {showPowerSyncDiagnostics ? (
              <View style={{ marginTop: spacing.xl }}>
                <Text variant="bodyLarge">PowerSync diagnostics</Text>
                <Text
                  variant="bodyMedium"
                  style={{ color: colors.onSurfaceVariant }}
                >
                  Open the PowerSync database, connect for stream testing, or run the local migration manually.
                </Text>
                <Button
                  mode="outlined"
                  style={{
                    marginTop: spacing.sm,
                    alignSelf: 'flex-start',
                  }}
                  onPress={() => router.push('/settings/powersync' as any)}
                >
                  Open diagnostics
                </Button>
              </View>
            ) : null}
          </Surface>
        </ScrollView>
        <AppConfirmDialog
          visible={resetDialogVisible}
          title="Reset Database"
          message="This will delete your local data and recreate the default home. Continue?"
          confirmLabel="Reset"
          destructive
          onCancel={() => setResetDialogVisible(false)}
          onConfirm={() => void confirmResetDatabase()}
          testID="settings-reset-database-dialog"
        />
      </SafeAreaView>
    </>
  );
}
