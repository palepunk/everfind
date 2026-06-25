import { useCallback, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, View } from 'react-native';
import {
  Appbar,
  Surface,
  Text,
  List,
  Icon,
  Button,
  useTheme,
} from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { router, useFocusEffect } from 'expo-router';
import * as NavigationBar from 'expo-navigation-bar';
import Constants from 'expo-constants';
import * as Clipboard from 'expo-clipboard';
import {
  HOUSE_LIMIT,
  ITEM_LIMIT,
  ITEM_PICTURES_PER_ITEM_LIMIT,
  STORAGE_UNIT_LIMIT,
  formatLimitValue,
  formatUsageLimit,
  getPlanLimitSnapshot,
  type LimitCounts,
  type LimitValues,
} from '../../../utils/limits';
import type { AppTheme } from '../../../utils/theme/theme';
import { useThemePreference } from '../../../utils/theme/themePreference';
import { useAnalytics } from '../../../utils/analytics/AnalyticsProvider';
import { everfindEdition } from '../../../utils/edition/config';

const IOS_APP_ID = '6756936410';
const ANDROID_PACKAGE_NAME = 'online.everfind.app';
const SOURCE_CODE_URL = 'https://github.com/palepunk/everfind';

const openRateAppLink = async () => {
  const nativeUrl =
    Platform.OS === 'ios'
      ? `itms-apps://itunes.apple.com/app/id${IOS_APP_ID}?action=write-review`
      : Platform.OS === 'android'
        ? `market://details?id=${ANDROID_PACKAGE_NAME}`
        : 'https://everfind.online';

  const webUrl =
    Platform.OS === 'ios'
      ? `https://apps.apple.com/us/app/everfind-home-inventory/id${IOS_APP_ID}?action=write-review`
      : Platform.OS === 'android'
        ? `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE_NAME}`
        : 'https://everfind.online';

  try {
    const supported = await Linking.canOpenURL(nativeUrl);
    await Linking.openURL(supported ? nativeUrl : webUrl);
  } catch {
    await Linking.openURL(webUrl).catch(() => {});
  }
};

export default function AboutScreen() {
  const { colors, custom } = useTheme<AppTheme>();
  const { spacing, shapes, elevation, surfaces } = custom;
  const { resolvedTheme } = useThemePreference();
  const statusBarStyle = resolvedTheme === 'dark' ? 'light' : 'dark';
  const { publicInstanceId } = useAnalytics();
  const [appInfoPressCount, setAppInfoPressCount] = useState(0);
  const [betaVisible, setBetaVisible] = useState(false);
  const [copyConfirmed, setCopyConfirmed] = useState(false);
  const [limitCounts, setLimitCounts] = useState<LimitCounts>({ houses: 0, storageUnits: 0, items: 0 });
  const [planLimits, setPlanLimits] = useState<LimitValues>({
    houses: HOUSE_LIMIT,
    storageUnits: STORAGE_UNIT_LIMIT,
    items: ITEM_LIMIT,
    itemPicturesPerItem: ITEM_PICTURES_PER_ITEM_LIMIT,
  });

  useFocusEffect(
    useCallback(() => {
      NavigationBar.setBackgroundColorAsync('transparent');
      NavigationBar.setBorderColorAsync('transparent');
      NavigationBar.setVisibilityAsync('visible');
      NavigationBar.setButtonStyleAsync(resolvedTheme === 'dark' ? 'light' : 'dark');
      NavigationBar.setBehaviorAsync('overlay-swipe');
    }, [resolvedTheme])
  );

  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      const loadPlanLimits = async () => {
        try {
          const snapshot = await getPlanLimitSnapshot();
          if (!isActive) return;
          setLimitCounts(snapshot.usage);
          setPlanLimits(snapshot.limits);
        } catch (error) {
          console.warn('Failed to load backend plan limits', error);
        }
      };

      void loadPlanLimits();
      return () => {
        isActive = false;
      };
    }, [])
  );

  const insets = useSafeAreaInsets();

  const appVersion = Constants.expoConfig?.version || '1.0.0';
  const appInstanceLabel = publicInstanceId || 'Loading...';
  const isFossEdition = everfindEdition === 'foss';

  return (
    <>
      <StatusBar style={statusBarStyle} backgroundColor="transparent" translucent={false} />

      <SafeAreaView
        testID="about-screen"
        style={{ flex: 1, backgroundColor: colors.background }}
        edges={['bottom']}
      >
        {/* App Bar */}
        <Appbar.Header
          style={{
            backgroundColor: colors.surface,
            elevation: elevation.level0,
          }}
        >
          <Appbar.BackAction onPress={() => router.back()} />
          <Appbar.Content title="About" style={{ alignItems: 'flex-start' }} titleStyle={{ textAlign: 'left' }} />
        </Appbar.Header>

        <ScrollView
          style={{ flex: 1, backgroundColor: colors.background }}
          contentContainerStyle={{
            padding: spacing.xxl,
            paddingBottom: spacing.xxl + insets.bottom,
            gap: spacing.lg,
          }}
        >
          {/* Statistics */}
          <Surface
            elevation={elevation.level1}
            style={{
              backgroundColor: surfaces.card,
              borderRadius: shapes.cornerLarge,
              padding: spacing.xxl,
            }}
          >
            <Text variant="titleMedium">Statistics</Text>

            <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
              <Text variant="bodyLarge">
                Houses: {formatUsageLimit(limitCounts.houses, planLimits.houses)}
              </Text>
              <Text variant="bodyLarge">
                Storage units: {formatUsageLimit(limitCounts.storageUnits, planLimits.storageUnits)}
              </Text>
              <Text variant="bodyLarge">
                Items: {formatUsageLimit(limitCounts.items, planLimits.items)}
              </Text>
              <Text variant="bodyLarge">
                Item pictures per item: {formatLimitValue(planLimits.itemPicturesPerItem)}
              </Text>
            </View>
          </Surface>

          {/* FAQ */}
          <Surface
            elevation={elevation.level1}
            style={{
              backgroundColor: surfaces.card,
              borderRadius: shapes.cornerLarge,
              overflow: 'hidden',
            }}
          >
            <List.Accordion
              title="How is my data stored?"
              description="Local storage on this device"
              left={(props) => (
                <List.Icon
                  {...props}
                  icon="shield-lock-outline"
                  color={colors.onSurfaceVariant}
                />
              )}
            >
              <Text
                variant="bodyMedium"
                style={{
                  paddingHorizontal: spacing.xxl,
                  paddingBottom: spacing.lg,
                  color: colors.onSurfaceVariant,
                }}
              >
                everfind stores your houses, rooms, containers, boxes, and items
                directly on your device.
              </Text>
            </List.Accordion>

            <List.Accordion
              title="Can I use everfind offline?"
              description="Yes - no connection required"
              left={(props) => (
                <List.Icon
                  {...props}
                  icon="wifi-off"
                  color={colors.onSurfaceVariant}
                />
              )}
            >
              <Text
                variant="bodyMedium"
                style={{
                  paddingHorizontal: spacing.xxl,
                  paddingBottom: spacing.lg,
                  color: colors.onSurfaceVariant,
                }}
              >
                You can browse, search, and update your inventory without an
                internet connection.
              </Text>
            </List.Accordion>

            <List.Accordion
              title="How do I back up my inventory?"
              description="CSV export"
              left={(props) => (
                <List.Icon
                  {...props}
                  icon="file-export-outline"
                  color={colors.onSurfaceVariant}
                />
              )}
            >
              <Text
                variant="bodyMedium"
                style={{
                  paddingHorizontal: spacing.xxl,
                  paddingBottom: spacing.lg,
                  color: colors.onSurfaceVariant,
                }}
              >
                Export your inventory as a CSV file any time and keep that file
                somewhere safe.
              </Text>
            </List.Accordion>

            <List.Accordion
              title="What happens if I uninstall the app?"
              description="Local data is removed"
              left={(props) => (
                <List.Icon
                  {...props}
                  icon="delete-outline"
                  color={colors.onSurfaceVariant}
                />
              )}
            >
              <Text
                variant="bodyMedium"
                style={{
                  paddingHorizontal: spacing.xxl,
                  paddingBottom: spacing.lg,
                  color: colors.onSurfaceVariant,
                }}
              >
                Uninstalling everfind removes all locally stored inventory data.
                Export a backup first if you want to keep your records.
              </Text>
            </List.Accordion>
          </Surface>

          {/* App Information */}
          <Pressable
            testID="about-app-information-section"
            onPress={() => {
              const nextCount = appInfoPressCount + 1;
              setAppInfoPressCount(nextCount);
              if (nextCount >= 7) {
                setBetaVisible(true);
              }
            }}
            accessibilityLabel="App Information"
            accessibilityRole="button"
          >
            <Surface
              elevation={elevation.level1}
              style={{
                backgroundColor: surfaces.card,
                borderRadius: shapes.cornerLarge,
                padding: spacing.xxl,
              }}
            >
              <Text variant="titleMedium">App Information</Text>

              <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <Icon source="information-outline" size={20} color={colors.onSurfaceVariant} />
                  <Text testID="about-version-text" variant="bodyLarge">Version {appVersion}</Text>
                </View>

                {isFossEdition ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <Icon source="open-source-initiative" size={20} color={colors.onSurfaceVariant} />
                    <Text variant="bodyLarge">Open source edition (FOSS)</Text>
                  </View>
                ) : null}

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <Icon source="email-outline" size={20} color={colors.onSurfaceVariant} />
                  <Text variant="bodyLarge">hello@everfind.online</Text>
                </View>

                <Pressable
                  onPress={() =>
                    Linking.openURL('https://everfind.online/privacy-policy').catch(() => {})
                  }
                  accessibilityRole="link"
                  accessibilityLabel="Privacy policy"
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <Icon source="shield-account-outline" size={20} color={colors.onSurfaceVariant} />
                    <Text variant="bodyLarge" style={{ color: colors.primary }}>
                      Privacy policy
                    </Text>
                  </View>
                </Pressable>

                <Pressable
                  onPress={() => Linking.openURL('https://everfind.online/terms').catch(() => {})}
                  accessibilityRole="link"
                  accessibilityLabel="Terms of Service"
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <Icon source="file-document-outline" size={20} color={colors.onSurfaceVariant} />
                    <Text variant="bodyLarge" style={{ color: colors.primary }}>
                      Terms of Service
                    </Text>
                  </View>
                </Pressable>

                {isFossEdition ? (
                  <Pressable
                    onPress={() => Linking.openURL(SOURCE_CODE_URL).catch(() => {})}
                    accessibilityRole="link"
                    accessibilityLabel="Source code on GitHub"
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                      <Icon source="github" size={20} color={colors.onSurfaceVariant} />
                      <Text variant="bodyLarge" style={{ color: colors.primary }}>
                        Source code
                      </Text>
                    </View>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={openRateAppLink}
                    accessibilityRole="link"
                    accessibilityLabel="Rate app"
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                      <Icon source="star-outline" size={20} color={colors.onSurfaceVariant} />
                      <Text variant="bodyLarge" style={{ color: colors.primary }}>
                        Rate app
                      </Text>
                    </View>
                  </Pressable>
                )}
              </View>
            </Surface>
          </Pressable>

          {betaVisible ? (
            <Surface
              elevation={elevation.level1}
              style={{
                backgroundColor: surfaces.card,
                borderRadius: shapes.cornerLarge,
                padding: spacing.xxl,
                gap: spacing.sm,
              }}
            >
              <Text variant="titleMedium">Beta access</Text>
              <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
                App Instance ID: {appInstanceLabel}
              </Text>
              <Button
                mode="outlined"
                onPress={async () => {
                  if (!publicInstanceId) return;
                  await Clipboard.setStringAsync(publicInstanceId);
                  setCopyConfirmed(true);
                  setTimeout(() => setCopyConfirmed(false), 2000);
                }}
                disabled={!publicInstanceId}
              >
                Copy ID
              </Button>
              {copyConfirmed ? (
                <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                  Copied to clipboard.
                </Text>
              ) : null}
            </Surface>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

