import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Easing,
  Pressable,
  View,
  type NativeEventSubscription,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { ActivityIndicator, Icon, IconButton, Text, ThemeProvider, useTheme } from 'react-native-paper';

import type { AppTheme } from '@/utils/theme/theme';

/**
 * Bottom sheet modals render through a portal at the app root, outside the
 * PaperProvider, so content inside a sheet (and its footer) would get Paper's
 * default theme without `custom`. Wrap sheet content and footers in this,
 * passing the theme read by the component that owns the sheet.
 */
export function SheetTheme({ theme, children }: { theme: AppTheme; children: React.ReactNode }) {
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
}

/**
 * Shared look for bottom sheet modals: sheet chrome (handle, corners,
 * background) and the small building blocks used inside them.
 */

// Matches the sheets that still set their chrome inline (EntityScreen, import/export).
export const SHEET_CORNER_RADIUS = 22;
export const SHEET_BUTTON_HEIGHT = 52;

export function useSheetChrome() {
  const { colors, custom } = useTheme<AppTheme>();
  const { opacity, surfaces } = custom;

  return useMemo(() => {
    const sheetBackground = colors.surface;
    return {
      sheetBackground,
      cardBackground: surfaces.card,
      hairline: `${colors.onSurface}${opacity.alpha12}`,
      /** Spread onto BottomSheetModal. */
      modalProps: {
        handleStyle: { paddingTop: 10, paddingBottom: 6 },
        handleIndicatorStyle: {
          backgroundColor: `${colors.onSurface}${opacity.alpha30}`,
          width: 36,
          height: 5,
        },
        backgroundStyle: {
          backgroundColor: sheetBackground,
          borderTopLeftRadius: SHEET_CORNER_RADIUS,
          borderTopRightRadius: SHEET_CORNER_RADIUS,
        },
      },
    };
  }, [colors.onSurface, colors.surface, opacity.alpha12, opacity.alpha30, surfaces.card]);
}

/**
 * Makes the Android Back button close a bottom sheet modal instead of leaving
 * the screen (or the app). Pass the returned handler as the sheet's onChange,
 * or call it from an existing onChange. The listener is only registered while
 * the sheet is open, so it takes priority over screen-level Back handlers.
 */
export function useSheetBackHandler(sheetRef: React.RefObject<{ dismiss: () => void } | null>) {
  const subscriptionRef = useRef<NativeEventSubscription | null>(null);

  const release = useCallback(() => {
    subscriptionRef.current?.remove();
    subscriptionRef.current = null;
  }, []);

  useEffect(() => release, [release]);

  return useCallback(
    (index: number) => {
      if (index < 0) {
        release();
        return;
      }
      if (subscriptionRef.current) return;
      subscriptionRef.current = BackHandler.addEventListener('hardwareBackPress', () => {
        sheetRef.current?.dismiss();
        return true;
      });
    },
    [release, sheetRef]
  );
}

type SheetHeaderProps = {
  title: string;
  subtitle?: string;
  onClose?: () => void;
  closeLabel?: string;
  titleTestID?: string;
};

export function SheetHeader({ title, subtitle, onClose, closeLabel, titleTestID }: SheetHeaderProps) {
  const { colors, custom } = useTheme<AppTheme>();
  const { spacing } = custom;

  return (
    <View style={{ gap: spacing.xs }}>
      <View style={{ minHeight: 40, justifyContent: 'center', alignItems: 'center' }}>
        {onClose ? (
          <IconButton
            icon="close"
            size={22}
            onPress={onClose}
            style={{ position: 'absolute', left: -spacing.sm, margin: 0 }}
            accessibilityLabel={closeLabel ?? 'Close'}
          />
        ) : null}
        <Text
          testID={titleTestID}
          variant="titleMedium"
          style={{ color: colors.onSurface, fontWeight: '600', fontSize: 18 }}
        >
          {title}
        </Text>
      </View>
      {subtitle ? (
        <Text
          variant="bodyMedium"
          style={{ color: colors.onSurfaceVariant, textAlign: 'center', paddingHorizontal: spacing.xxl }}
        >
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

type SheetCardProps = {
  label?: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function SheetCard({ label, trailing, children, style }: SheetCardProps) {
  const { colors, custom } = useTheme<AppTheme>();
  const { spacing, shapes } = custom;
  const { cardBackground, hairline } = useSheetChrome();

  return (
    <View
      style={[
        {
          backgroundColor: cardBackground,
          borderRadius: shapes.cornerLarge,
          borderWidth: 1,
          borderColor: hairline,
          padding: spacing.xxl,
          gap: spacing.md,
        },
        style,
      ]}
    >
      {label || trailing ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 20 }}>
          <Text variant="labelLarge" style={{ color: colors.onSurfaceVariant, flex: 1 }}>
            {label ?? ''}
          </Text>
          {trailing}
        </View>
      ) : null}
      {children}
    </View>
  );
}

type SheetRowProps = {
  icon: string;
  overline?: string;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  accessibilityLabel?: string;
};

export function SheetRow({ icon, overline, title, subtitle, onPress, accessibilityLabel }: SheetRowProps) {
  const { colors, custom } = useTheme<AppTheme>();
  const { spacing, shapes, opacity } = custom;

  const content = (
    <>
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: shapes.cornerSmall,
          backgroundColor: colors.primaryContainer,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon source={icon} size={20} color={colors.onPrimaryContainer} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        {overline ? (
          <Text variant="labelSmall" style={{ color: colors.onSurfaceVariant }}>
            {overline}
          </Text>
        ) : null}
        <Text variant="bodyLarge" style={{ color: colors.onSurface, fontWeight: '600' }}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {onPress ? <Icon source="chevron-right" size={22} color={colors.onSurfaceVariant} /> : null}
    </>
  );

  const rowStyle = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.lg };

  if (!onPress) {
    return <View style={rowStyle}>{content}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      style={({ pressed }) => ({
        ...rowStyle,
        minHeight: 48,
        marginHorizontal: -spacing.sm,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        borderRadius: shapes.cornerSmall,
        backgroundColor: pressed ? `${colors.primary}${opacity.alpha08}` : 'transparent',
      })}
    >
      {content}
    </Pressable>
  );
}

type SheetNoticeProps = {
  tone?: 'error' | 'info';
  children: React.ReactNode;
  testID?: string;
};

export function SheetNotice({ tone = 'error', children, testID }: SheetNoticeProps) {
  const { colors, custom } = useTheme<AppTheme>();
  const { spacing, shapes } = custom;
  const isError = tone === 'error';
  const foreground = isError ? colors.onErrorContainer : colors.onSecondaryContainer;

  return (
    <View
      testID={testID}
      accessibilityRole={isError ? 'alert' : undefined}
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.sm,
        backgroundColor: isError ? colors.errorContainer : colors.secondaryContainer,
        borderRadius: shapes.cornerMedium,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
      }}
    >
      <Icon source={isError ? 'alert-circle-outline' : 'information-outline'} size={18} color={foreground} />
      <Text variant="bodyMedium" style={{ color: foreground, flex: 1 }}>
        {children}
      </Text>
    </View>
  );
}

type SheetButtonProps = {
  variant?: 'primary' | 'secondary' | 'danger';
  icon?: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

export function SheetButton({
  variant = 'primary',
  icon,
  label,
  onPress,
  disabled = false,
  loading = false,
  accessibilityLabel,
  testID,
  style,
}: SheetButtonProps) {
  const { colors, custom } = useTheme<AppTheme>();
  const { spacing, shapes, opacity } = custom;
  const isOutlined = variant === 'secondary';
  const background =
    variant === 'primary' ? colors.primary : variant === 'danger' ? colors.errorContainer : 'transparent';
  const foreground =
    variant === 'primary'
      ? colors.onPrimary
      : variant === 'danger'
        ? colors.onErrorContainer
        : colors.onSurface;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled, busy: loading }}
      style={({ pressed }) => [
        {
          flex: 1,
          height: SHEET_BUTTON_HEIGHT,
          borderRadius: shapes.cornerFull,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing.sm,
          paddingHorizontal: spacing.xxl,
          backgroundColor: background,
          borderWidth: isOutlined ? 1 : 0,
          borderColor: `${colors.onSurface}${opacity.alpha24}`,
          opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size={18} color={foreground} />
      ) : icon ? (
        <Icon source={icon} size={20} color={foreground} />
      ) : null}
      <Text variant="labelLarge" style={{ color: foreground, fontWeight: '600', fontSize: 15 }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Height a footer built from SheetFooterBar occupies, for scroll padding. */
export const getSheetFooterHeight = (bottomInset: number) =>
  SHEET_BUTTON_HEIGHT + 12 + 12 + Math.max(bottomInset, 8);

export function SheetFooterBar({ bottomInset, children }: { bottomInset: number; children: React.ReactNode }) {
  const { custom } = useTheme<AppTheme>();
  const { sheetBackground, hairline } = useSheetChrome();

  return (
    <View
      style={{
        backgroundColor: sheetBackground,
        borderTopWidth: 1,
        borderTopColor: hairline,
        paddingTop: 12,
        paddingBottom: 12 + Math.max(bottomInset, 8),
        paddingHorizontal: custom.spacing.xxl,
        flexDirection: 'row',
        alignItems: 'center',
        gap: custom.spacing.lg,
      }}
    >
      {children}
    </View>
  );
}

type ListeningHeroProps = {
  listening: boolean;
  title: string;
  hint?: string;
};

const HERO_SIZE = 72;

export function ListeningHero({ listening, title, hint }: ListeningHeroProps) {
  const { colors, custom } = useTheme<AppTheme>();
  const { spacing } = custom;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!listening) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1500,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => {
      loop.stop();
      pulse.stopAnimation();
      pulse.setValue(0);
    };
  }, [listening, pulse]);

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] });

  return (
    <View style={{ alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm }}>
      <View style={{ width: HERO_SIZE * 1.6, height: HERO_SIZE * 1.6, alignItems: 'center', justifyContent: 'center' }}>
        {listening ? (
          <Animated.View
            style={{
              position: 'absolute',
              width: HERO_SIZE,
              height: HERO_SIZE,
              borderRadius: HERO_SIZE / 2,
              backgroundColor: colors.primary,
              opacity: ringOpacity,
              transform: [{ scale: ringScale }],
            }}
          />
        ) : null}
        <View
          style={{
            width: HERO_SIZE,
            height: HERO_SIZE,
            borderRadius: HERO_SIZE / 2,
            backgroundColor: listening ? colors.primary : colors.primaryContainer,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon source="microphone" size={32} color={listening ? colors.onPrimary : colors.primary} />
        </View>
      </View>
      <Text variant="titleMedium" style={{ color: colors.onSurface, fontWeight: '600', textAlign: 'center' }}>
        {title}
      </Text>
      {hint ? (
        <Text
          variant="bodyMedium"
          style={{ color: colors.onSurfaceVariant, textAlign: 'center', paddingHorizontal: spacing.xxl }}
        >
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

type SheetLanguagePickerProps<T extends string> = {
  value: T;
  options: readonly { value: T; label: string }[];
  onSelect: (value: T) => void;
  disabled?: boolean;
};

/**
 * Inline picker (a pill that expands a list below it). Menus and portals do
 * not layer reliably above a bottom sheet, so the list is rendered in flow.
 */
export function SheetLanguagePicker<T extends string>({
  value,
  options,
  onSelect,
  disabled = false,
}: SheetLanguagePickerProps<T>) {
  const { colors, custom } = useTheme<AppTheme>();
  const { spacing, shapes, opacity } = custom;
  const { cardBackground, hairline } = useSheetChrome();
  const [open, setOpen] = useState(false);
  const label = options.find((option) => option.value === value)?.label ?? value;

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <View style={{ alignItems: 'center', gap: spacing.sm }}>
      <Pressable
        onPress={() => setOpen((current) => !current)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel="Choose recognition language"
        accessibilityState={{ expanded: open, disabled }}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.xs,
          minHeight: 40,
          paddingHorizontal: spacing.xl,
          borderRadius: shapes.cornerFull,
          borderWidth: 1,
          borderColor: `${colors.onSurface}${opacity.alpha24}`,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        })}
      >
        <Icon source="translate" size={18} color={colors.onSurfaceVariant} />
        <Text variant="labelLarge" style={{ color: colors.onSurface }}>
          {label}
        </Text>
        <Icon source={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.onSurfaceVariant} />
      </Pressable>
      {open ? (
        <View
          style={{
            alignSelf: 'stretch',
            backgroundColor: cardBackground,
            borderRadius: shapes.cornerLarge,
            borderWidth: 1,
            borderColor: hairline,
            overflow: 'hidden',
          }}
        >
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <Pressable
                key={option.value}
                onPress={() => {
                  setOpen(false);
                  onSelect(option.value);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Use ${option.label}`}
                accessibilityState={{ selected }}
                style={({ pressed }) => ({
                  minHeight: 48,
                  paddingHorizontal: spacing.xxl,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  backgroundColor: pressed ? `${colors.primary}${opacity.alpha08}` : 'transparent',
                })}
              >
                <Text
                  variant="bodyLarge"
                  style={{ color: selected ? colors.primary : colors.onSurface, fontWeight: selected ? '600' : '400' }}
                >
                  {option.label}
                </Text>
                {selected ? <Icon source="check" size={20} color={colors.primary} /> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
