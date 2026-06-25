import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Platform, Pressable, View } from 'react-native';
import {
  BottomSheetBackdrop,
  BottomSheetFooter,
  BottomSheetModal,
  BottomSheetScrollView,
  type BottomSheetFooterProps,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { Icon, IconButton, Surface, Text, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Voice from '@/utils/voice';
import { router, useLocalSearchParams } from 'expo-router';
import { activateKeepAwake, deactivateKeepAwake } from 'expo-keep-awake';

import { database } from '@/utils/storage/database';
import { Box, Container, House, Item, Room } from '@/utils/storage/models';
import { triggerGlobalRefresh } from '@/utils/hooks/useDatabase';
import { createPowerSyncLocalItem } from '@/utils/powersync/mutations';
import { usePowerSyncReadModeEnabled } from '@/utils/powersync/readMode';
import {
  getPowerSyncRepositoryBoxes,
  getPowerSyncRepositoryContainers,
  getPowerSyncRepositoryHouses,
  getPowerSyncRepositoryRooms,
} from '@/utils/powersync/repository';
import type { AppTheme } from '@/utils/theme/theme';
import {
  ITEM_LIMIT_ERROR,
  getLimitErrorMessage,
  getPlanLimitSnapshot,
  getPlanLimits,
} from '@/utils/limits';
import { SPEECH_LANGUAGE_OPTIONS, useSpeechLanguage } from '@/utils/speechLanguage';
import {
  trackBulkVoiceAddStartListeningPressed,
  trackRecordCreated,
} from '@/utils/analytics/AnalyticsProvider';

type ParentType = 'container' | 'box' | 'room';

type ParentInfo = {
  houseId: string;
  title: string;
  location: string;
  parentType: ParentType;
  parentId: string;
};

const normalizeTranscript = (text: string) => text.replace(/\s+/g, ' ').trim();

export function VoiceBulkAddScreen() {
  const theme = useTheme<AppTheme>();
  const { colors, custom } = theme;
  const { spacing, shapes, opacity, elevation } = custom;
  const insets = useSafeAreaInsets();
  const { parentType, parentId } = useLocalSearchParams();

  const [parentInfo, setParentInfo] = useState<ParentInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [currentTranscript, setCurrentTranscript] = useState('');
  const [recognizedItems, setRecognizedItems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [speechStatus, setSpeechStatus] = useState<'idle' | 'listening' | 'processing' | 'error'>('idle');
  const [speechAvailable, setSpeechAvailable] = useState(true);
  const [useGoogleEngine, setUseGoogleEngine] = useState(false);
  const [hasStartedCapture, setHasStartedCapture] = useState(false);
  const [hasStoppedListeningOnce, setHasStoppedListeningOnce] = useState(false);
  const [languageMenuVisible, setLanguageMenuVisible] = useState(false);
  const { language: speechLanguage, setLanguage: setSpeechLanguage } = useSpeechLanguage();
  const powerSyncReadModeEnabled = usePowerSyncReadModeEnabled();
  const resolvedLanguage = speechLanguage === 'system' ? '' : speechLanguage;

  const desiredListeningRef = useRef(false);
  const restartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartInFlightRef = useRef(false);
  const actionInFlightRef = useRef(false);
  const silenceCommitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCommittedRef = useRef('');
  const isListeningRef = useRef(false);
  const closingRef = useRef(false);
  const resolvedLanguageRef = useRef(resolvedLanguage);
  const useGoogleEngineRef = useRef(useGoogleEngine);
  const sheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ['90%'], []);
  const listeningPulseAnim = useRef(new Animated.Value(0)).current;

  const contentBottomPadding = spacing.lg + Math.max(insets.bottom, 8);
  const actionFooterHeight = 84 + spacing.lg + Math.max(insets.bottom, 8);
  const parentIcon =
    parentInfo?.parentType === 'box'
      ? 'archive-outline'
      : parentInfo?.parentType === 'container'
        ? 'package-variant-closed'
        : 'floor-plan';

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      sheetRef.current?.present();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const closeModal = useCallback(() => {
    if (closingRef.current) {
      return;
    }
    closingRef.current = true;
    router.back();
  }, []);

  const requestCloseModal = useCallback(() => {
    if (closingRef.current) {
      return;
    }
    closingRef.current = true;
    router.back();
  }, []);

  const openLanguagePicker = useCallback(() => {
    if (isListening) return;
    setLanguageMenuVisible(true);
  }, [isListening]);

  const closeLanguagePicker = useCallback(() => {
    setLanguageMenuVisible(false);
  }, []);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
    ),
    []
  );

  useEffect(() => {
    const tag = 'bulk-voice-listening';
    if (isListening) {
      activateKeepAwake(tag);
    } else {
      deactivateKeepAwake(tag);
    }
    return () => {
      deactivateKeepAwake(tag);
    };
  }, [isListening]);

  useEffect(() => {
    if (!isListening) {
      listeningPulseAnim.stopAnimation();
      listeningPulseAnim.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(listeningPulseAnim, {
          toValue: 1,
          duration: 850,
          useNativeDriver: true,
        }),
        Animated.timing(listeningPulseAnim, {
          toValue: 0,
          duration: 850,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();

    return () => {
      loop.stop();
      listeningPulseAnim.stopAnimation();
      listeningPulseAnim.setValue(0);
    };
  }, [isListening, listeningPulseAnim]);

  const loadParentInfo = useCallback(async () => {
    const rawParentType = String(parentType || '');
    const rawParentId = String(parentId || '');
    if (!rawParentId || (rawParentType !== 'container' && rawParentType !== 'box' && rawParentType !== 'room')) {
      setLoading(false);
      return;
    }

    try {
      if (powerSyncReadModeEnabled) {
        const [houses, rooms, containers, boxes] = await Promise.all([
          getPowerSyncRepositoryHouses(),
          getPowerSyncRepositoryRooms(),
          getPowerSyncRepositoryContainers(),
          getPowerSyncRepositoryBoxes(),
        ]);

        if (rawParentType === 'container') {
          const container = containers.find((candidate) => candidate.id === rawParentId);
          if (!container) throw new Error('PowerSync container not found.');
          const room = rooms.find((candidate) => candidate.id === container.roomId);
          const house = houses.find((candidate) => candidate.id === container.houseId);
          setParentInfo({
            houseId: container.houseId,
            title: container.name,
            location: [house?.name, room?.name, container.name].filter(Boolean).join(' > '),
            parentType: 'container',
            parentId: container.id,
          });
        } else if (rawParentType === 'box') {
          const box = boxes.find((candidate) => candidate.id === rawParentId);
          if (!box) throw new Error('PowerSync box not found.');
          const house = houses.find((candidate) => candidate.id === box.houseId);
          const parts = [house?.name];

          if (box.parentType === 'container' && box.parentId) {
            const container = containers.find((candidate) => candidate.id === box.parentId);
            const room = container?.roomId ? rooms.find((candidate) => candidate.id === container.roomId) : null;
            parts.push(room?.name, container?.name);
          } else if (box.parentType === 'room' && box.parentId) {
            const room = rooms.find((candidate) => candidate.id === box.parentId);
            parts.push(room?.name);
          }
          parts.push(box.name);

          setParentInfo({
            houseId: box.houseId,
            title: box.name,
            location: parts.filter(Boolean).join(' > '),
            parentType: 'box',
            parentId: box.id,
          });
        } else {
          const room = rooms.find((candidate) => candidate.id === rawParentId);
          if (!room) throw new Error('PowerSync room not found.');
          const house = houses.find((candidate) => candidate.id === room.houseId);
          setParentInfo({
            houseId: room.houseId,
            title: room.name,
            location: [house?.name, room.name].filter(Boolean).join(' > '),
            parentType: 'room',
            parentId: room.id,
          });
        }
        return;
      }

      if (rawParentType === 'container') {
        const container = await database.collections.get<Container>('containers').find(rawParentId);
        const room = await database.collections.get<Room>('rooms').find(container.roomId);
        const house = await database.collections.get<House>('houses').find(container.houseId);
        setParentInfo({
          houseId: container.houseId,
          title: container.name,
          location: [house.name, room.name, container.name].filter(Boolean).join(' > '),
          parentType: 'container',
          parentId: container.id,
        });
      } else if (rawParentType === 'box') {
        const box = await database.collections.get<Box>('boxes').find(rawParentId);
        const house = await database.collections.get<House>('houses').find(box.houseId);
        const parts = [house.name];

        if (box.parentType === 'container' && box.parentId) {
          const container = await database.collections.get<Container>('containers').find(box.parentId);
          const room = await database.collections.get<Room>('rooms').find(container.roomId);
          parts.push(room.name, container.name);
        } else if (box.parentType === 'room' && box.parentId) {
          const room = await database.collections.get<Room>('rooms').find(box.parentId);
          parts.push(room.name);
        }
        parts.push(box.name);

        setParentInfo({
          houseId: box.houseId,
          title: box.name,
          location: parts.filter(Boolean).join(' > '),
          parentType: 'box',
          parentId: box.id,
        });
      } else {
        const room = await database.collections.get<Room>('rooms').find(rawParentId);
        const house = await database.collections.get<House>('houses').find(room.houseId);
        setParentInfo({
          houseId: room.houseId,
          title: room.name,
          location: [house.name, room.name].filter(Boolean).join(' > '),
          parentType: 'room',
          parentId: room.id,
        });
      }
    } catch (error) {
      console.error('Failed to load parent info', error);
      Alert.alert('Error', 'Failed to load target location.');
    } finally {
      setLoading(false);
    }
  }, [parentId, parentType, powerSyncReadModeEnabled]);

  useEffect(() => {
    loadParentInfo();
  }, [loadParentInfo]);

  useEffect(() => {
    let isActive = true;
    const loadSpeechInfo = async () => {
      try {
        const available = await Voice.isAvailable();
        if (!isActive) return;
        setSpeechAvailable(Boolean(available));
        const services = await Voice.getSpeechRecognitionServices();
        if (!isActive) return;
        const hasGoogle = (services || []).some((service: string) => {
          const lower = service.toLowerCase();
          return lower.includes('googlequicksearchbox') || lower.includes('voicesearch') || lower.includes('speech');
        });
        setUseGoogleEngine(hasGoogle);
      } catch (error) {
        console.warn('Speech availability check failed', error);
        if (isActive) {
          setSpeechAvailable(false);
        }
      }
    };
    loadSpeechInfo();
    return () => {
      isActive = false;
    };
  }, []);

  const handleTranscriptUpdate = useCallback((text?: string) => {
    if (!isListeningRef.current) return;
    const normalized = normalizeTranscript(text ?? '');
    if (!normalized) {
      setCurrentTranscript('');
      return;
    }

    setCurrentTranscript(normalized);

    if (silenceCommitTimeoutRef.current) {
      clearTimeout(silenceCommitTimeoutRef.current);
    }
    silenceCommitTimeoutRef.current = setTimeout(() => {
      if (!isListeningRef.current) return;
      setRecognizedItems((prev) => {
        let commitText = normalized;
        if (Platform.OS === 'ios') {
          const committed = lastCommittedRef.current;
          if (committed && normalized.startsWith(committed)) {
            const remainder = normalized.slice(committed.length).trim();
            if (remainder) {
              commitText = remainder;
            }
          }
          lastCommittedRef.current = normalized;
        }
        if (!commitText.trim()) return prev;
        if (prev.includes(commitText)) return prev;
        return [...prev, commitText];
      });
      setCurrentTranscript('');
    }, 1200);
  }, []);

  useEffect(() => {
    resolvedLanguageRef.current = resolvedLanguage;
  }, [resolvedLanguage]);

  useEffect(() => {
    useGoogleEngineRef.current = useGoogleEngine;
  }, [useGoogleEngine]);

  useEffect(() => {
    if (isListeningRef.current) {
      return;
    }
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }
    if (silenceCommitTimeoutRef.current) {
      clearTimeout(silenceCommitTimeoutRef.current);
      silenceCommitTimeoutRef.current = null;
    }
    desiredListeningRef.current = false;
    restartInFlightRef.current = false;
    setCurrentTranscript('');
    setSpeechStatus('idle');
    Voice.cancel().catch(() => undefined);
  }, [speechLanguage]);

  useEffect(() => {
    const restartListening = () => {
      if (!desiredListeningRef.current || restartInFlightRef.current) return;
      restartInFlightRef.current = true;
      restartTimeoutRef.current = setTimeout(async () => {
        try {
          await Voice.cancel().catch(() => undefined);
          await Voice.start(resolvedLanguageRef.current, {
            EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 60000,
            EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 60000,
            EXTRA_MAX_RESULTS: 7,
            EXTRA_PARTIAL_RESULTS: true,
            ...(useGoogleEngineRef.current ? { RECOGNIZER_ENGINE: 'GOOGLE' } : {}),
          });
        } catch (error) {
          console.error('Failed to restart voice recognition', error);
          desiredListeningRef.current = false;
          isListeningRef.current = false;
          setIsListening(false);
          setSpeechStatus('error');
        } finally {
          restartInFlightRef.current = false;
        }
      }, 400);
    };

    Voice.onSpeechPartialResults = (event) => {
      handleTranscriptUpdate(event.value?.[0]);
      setSpeechStatus('listening');
    };
    Voice.onSpeechResults = (event) => {
      handleTranscriptUpdate(event.value?.[0]);
      setSpeechStatus('processing');
    };
    Voice.onSpeechError = (event) => {
      console.warn('Speech error', event.error);
      if (desiredListeningRef.current) {
        restartListening();
        return;
      }
      setSpeechStatus('error');
      setIsListening(false);
      isListeningRef.current = false;
    };
    Voice.onSpeechEnd = () => {
      if (desiredListeningRef.current) {
        setSpeechStatus('listening');
        restartListening();
      } else {
        setIsListening(false);
        isListeningRef.current = false;
        setSpeechStatus('idle');
      }
    };

    return () => {
      if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
      if (silenceCommitTimeoutRef.current) clearTimeout(silenceCommitTimeoutRef.current);
      restartInFlightRef.current = false;
      desiredListeningRef.current = false;
      isListeningRef.current = false;
      Voice.destroy().then(Voice.removeAllListeners);
    };
  }, [handleTranscriptUpdate]);

  const stopListening = useCallback(async () => {
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    desiredListeningRef.current = false;
    isListeningRef.current = false;
    setIsListening(false);
    setHasStoppedListeningOnce(true);
    setSpeechStatus('idle');
    setCurrentTranscript('');
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }
    if (silenceCommitTimeoutRef.current) {
      clearTimeout(silenceCommitTimeoutRef.current);
      silenceCommitTimeoutRef.current = null;
    }

    const finalTranscript = normalizeTranscript(currentTranscript);
    if (finalTranscript) {
      setRecognizedItems((prev) => {
        if (prev.includes(finalTranscript)) return prev;
        return [...prev, finalTranscript];
      });
    }

    try {
      await Voice.cancel();
    } catch (error) {
      console.warn('Failed to cancel speech recognition', error);
    } finally {
      actionInFlightRef.current = false;
    }
  }, [currentTranscript]);

  const startListening = useCallback(async () => {
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    trackBulkVoiceAddStartListeningPressed({ source: 'voice_bulk_add' });
    setHasStartedCapture(true);
    setHasStoppedListeningOnce(false);
    setCurrentTranscript('');
    setIsListening(true);
    desiredListeningRef.current = true;
    isListeningRef.current = true;
    setSpeechStatus('listening');
    try {
      await Voice.cancel().catch(() => undefined);
      await Voice.start(resolvedLanguage, {
        EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 60000,
        EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 60000,
        EXTRA_MAX_RESULTS: 7,
        EXTRA_PARTIAL_RESULTS: true,
        ...(useGoogleEngine ? { RECOGNIZER_ENGINE: 'GOOGLE' } : {}),
      });
    } catch (error) {
      console.error('Failed to start voice recognition', error);
      desiredListeningRef.current = false;
      isListeningRef.current = false;
      setIsListening(false);
      setSpeechStatus('error');
      Alert.alert('Error', 'Unable to start voice recognition.');
    } finally {
      actionInFlightRef.current = false;
    }
  }, [resolvedLanguage, useGoogleEngine]);

  const handleToggleListening = useCallback(async () => {
    const isCapturing =
      desiredListeningRef.current ||
      isListeningRef.current ||
      restartInFlightRef.current ||
      restartTimeoutRef.current !== null;
    if (isCapturing) {
      await stopListening();
      return;
    }
    await startListening();
  }, [startListening, stopListening]);

  const handleRemoveItem = useCallback((index: number) => {
    setRecognizedItems((prev) => prev.filter((_, idx) => idx !== index));
  }, []);

  const handleAddItems = useCallback(async () => {
    if (!parentInfo || recognizedItems.length === 0) return;

    setSaving(true);
    try {
      const snapshot = await getPlanLimitSnapshot();
      if (snapshot.usage.items + recognizedItems.length > snapshot.limits.items) {
        Alert.alert(
          'Limit reached',
          getLimitErrorMessage(ITEM_LIMIT_ERROR, snapshot.limits) ?? 'Plan limit reached.'
        );
        return;
      }

      if (powerSyncReadModeEnabled) {
        for (const name of recognizedItems) {
          await createPowerSyncLocalItem({
            houseId: parentInfo.houseId,
            name: name.trim(),
            description: null,
            parentType: parentInfo.parentType,
            parentId: parentInfo.parentId,
            imagePath: null,
            tags: '',
            purchasePriceCents: null,
            notes: null,
          });
        }
        triggerGlobalRefresh();
        trackRecordCreated('item', { source: 'voice_bulk', count: recognizedItems.length });
        if (parentInfo.parentType === 'container') {
          router.replace(`/containers/${parentInfo.parentId}?entry=direct` as any);
        } else if (parentInfo.parentType === 'box') {
          router.replace(`/boxes/${parentInfo.parentId}?entry=direct` as any);
        } else {
          router.replace(`/rooms/${parentInfo.parentId}?entry=direct` as any);
        }
        return;
      }

      await database.write(async () => {
        for (const name of recognizedItems) {
          await database.collections.get<Item>('items').create((item) => {
            item.houseId = parentInfo.houseId;
            item.name = name.trim();
            item.description = null;
            item.parentType = parentInfo.parentType;
            item.parentId = parentInfo.parentId;
            item.imagePath = null;
            item.tags = '';
            item.purchasePriceCents = null;
            item.notes = null;
          });
        }
      });
      trackRecordCreated('item', { source: 'voice_bulk', count: recognizedItems.length });
      if (parentInfo.parentType === 'container') {
        router.replace(`/containers/${parentInfo.parentId}?entry=direct` as any);
      } else if (parentInfo.parentType === 'box') {
        router.replace(`/boxes/${parentInfo.parentId}?entry=direct` as any);
      } else {
        router.replace(`/rooms/${parentInfo.parentId}?entry=direct` as any);
      }
    } catch (error: any) {
      if (error?.message === ITEM_LIMIT_ERROR) {
        let message = getLimitErrorMessage(ITEM_LIMIT_ERROR);
        try {
          const limits = await getPlanLimits();
          message = getLimitErrorMessage(ITEM_LIMIT_ERROR, limits);
        } catch {
          // Fallback to defaults if backend limits cannot be loaded.
        }
        Alert.alert('Limit reached', message ?? 'Plan limit reached.');
      } else {
        Alert.alert('Error', 'Failed to add items.');
      }
    } finally {
      setSaving(false);
    }
  }, [parentInfo, powerSyncReadModeEnabled, recognizedItems]);

  const renderPrimaryAction = useCallback(
    ({
      icon,
      label,
      onPress,
      disabled,
      accessibilityLabel,
    }: {
      icon: string;
      label: string;
      onPress: () => void;
      disabled: boolean;
      accessibilityLabel: string;
    }) => (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => ({
          flex: 1,
          height: 52,
          borderRadius: shapes.cornerFull,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: `${colors.primary}${opacity.alpha16}`,
          backgroundColor: colors.primaryContainer,
          opacity: disabled ? 0.45 : pressed ? 0.9 : 1,
          justifyContent: 'center',
        })}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: spacing.sm,
          }}
        >
          <Icon source={icon} size={20} color={colors.onPrimaryContainer} />
          <Text variant="labelLarge" style={{ color: colors.onPrimaryContainer, fontWeight: '600' }}>
            {label}
          </Text>
        </View>
      </Pressable>
    ),
    [
      colors.onPrimaryContainer,
      colors.primary,
      colors.primaryContainer,
      opacity.alpha16,
      shapes.cornerFull,
      spacing.sm,
    ]
  );

  const renderSecondaryAction = useCallback(
    ({
      icon,
      label,
      onPress,
      disabled,
      accessibilityLabel,
    }: {
      icon: string;
      label: string;
      onPress: () => void;
      disabled: boolean;
      accessibilityLabel: string;
    }) => (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => ({
          flex: 1,
          height: 52,
          borderRadius: shapes.cornerFull,
          borderWidth: 1,
          borderColor: `${colors.onSurface}${opacity.alpha24}`,
          backgroundColor: colors.surface,
          opacity: disabled ? 0.45 : pressed ? 0.9 : 1,
          justifyContent: 'center',
        })}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: spacing.sm,
          }}
        >
          <Icon source={icon} size={20} color={colors.onSurface} />
          <Text variant="labelLarge" style={{ color: colors.onSurface, fontWeight: '500' }}>
            {label}
          </Text>
        </View>
      </Pressable>
    ),
    [colors.onSurface, colors.surface, opacity.alpha24, shapes.cornerFull, spacing.sm]
  );

  const languageLabel =
    SPEECH_LANGUAGE_OPTIONS.find((option) => option.value === speechLanguage)?.label || 'English';
  const listeningDotScale = listeningPulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.45],
  });
  const listeningDotOpacity = listeningPulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.45, 1],
  });

  const renderActionFooter = useCallback(
    (props: BottomSheetFooterProps) => {
      return (
        <BottomSheetFooter {...props} bottomInset={0}>
          <Surface
            elevation={0}
            style={{
              backgroundColor: colors.surface,
              borderTopWidth: 1,
              borderTopColor: `${colors.onSurface}${opacity.alpha12}`,
              paddingTop: spacing.sm,
              paddingBottom: spacing.sm + Math.max(insets.bottom, 8),
            }}
          >
            <View style={{ alignItems: 'center', gap: spacing.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, width: '90%' }}>
                {hasStoppedListeningOnce ? (
                  <>
                    {renderSecondaryAction({
                      icon: 'reload',
                      label: 'Try again',
                      onPress: () => {
                        void startListening();
                      },
                      disabled: !speechAvailable || saving || loading || !parentInfo,
                      accessibilityLabel: 'Try again',
                    })}
                    {renderPrimaryAction({
                      icon: saving ? 'loading' : 'check',
                      label: saving ? 'Adding...' : 'Add',
                      onPress: () => {
                        void handleAddItems();
                      },
                      disabled: saving || isListening || recognizedItems.length === 0 || loading || !parentInfo,
                      accessibilityLabel: 'Add items',
                    })}
                  </>
                ) : (
                  renderPrimaryAction({
                    icon: isListening ? 'microphone-off' : 'microphone',
                    label: isListening ? 'Stop listening' : 'Start listening',
                    onPress: () => {
                      void handleToggleListening();
                    },
                    disabled: !speechAvailable || saving || loading || !parentInfo,
                    accessibilityLabel: isListening ? 'Stop listening' : 'Start listening',
                  })
                )}
              </View>
            </View>
          </Surface>
        </BottomSheetFooter>
      );
    },
    [
      colors.onSurface,
      colors.surface,
      handleAddItems,
      handleToggleListening,
      hasStoppedListeningOnce,
      insets.bottom,
      isListening,
      loading,
      opacity.alpha12,
      parentInfo,
      recognizedItems.length,
      renderPrimaryAction,
      renderSecondaryAction,
      saving,
      spacing.md,
      spacing.sm,
      speechAvailable,
      startListening,
    ]
  );

  return (
    <>
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enablePanDownToClose
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      enableBlurKeyboardOnGesture
      onDismiss={closeModal}
      backdropComponent={renderBackdrop}
      footerComponent={renderActionFooter}
      handleStyle={{ paddingTop: spacing.xs }}
      handleIndicatorStyle={{
        backgroundColor: `${colors.onSurface}${opacity.alpha30}`,
        width: 36,
        height: 5,
      }}
      backgroundStyle={{
        backgroundColor: colors.surface,
        borderTopLeftRadius: 22,
        borderTopRightRadius: 22,
      }}
    >
      <BottomSheetScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: contentBottomPadding + actionFooterHeight,
          gap: spacing.lg,
        }}
      >
        <>
            <View style={{ gap: spacing.sm, paddingBottom: spacing.xs }}>
              <View style={{ minHeight: 40, justifyContent: 'center', alignItems: 'center' }}>
                <IconButton
                  icon="close"
                  size={22}
                  onPress={requestCloseModal}
                  style={{
                    position: 'absolute',
                    left: -spacing.xs,
                    margin: 0,
                  }}
                  accessibilityLabel="Close bulk voice add"
                />
                <Text
                  variant="titleMedium"
                  style={{
                    color: colors.onSurface,
                    fontWeight: '500',
                    fontSize: 18,
                  }}
                >
                  Bulk voice add
                </Text>
              </View>
              <Text
                variant="bodySmall"
                style={{
                  color: colors.onSurface,
                  textAlign: 'left',
                  lineHeight: 19,
                  paddingHorizontal: spacing.xs,
                }}
              >
                Speak item names one by one. Pause briefly between items.
              </Text>
            </View>

            {loading ? (
              <Surface
                elevation={elevation.level1}
                style={{
                  backgroundColor: colors.surface,
                  borderRadius: shapes.cornerLarge,
                  padding: spacing.md,
                }}
              >
                <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
                  Loading target location...
                </Text>
              </Surface>
            ) : !parentInfo ? (
              <Surface
                elevation={elevation.level1}
                style={{
                  backgroundColor: colors.errorContainer,
                  borderRadius: shapes.cornerMedium,
                  padding: spacing.sm,
                }}
              >
                <Text variant="bodySmall" style={{ color: colors.onErrorContainer }}>
                  Could not load target location.
                </Text>
              </Surface>
            ) : (
              <Surface
                elevation={elevation.level2}
                style={{
                  backgroundColor: colors.surface,
                  borderRadius: shapes.cornerLarge,
                  padding: spacing.md,
                  gap: spacing.sm,
                  borderWidth: 1,
                  borderColor: `${colors.onSurface}${opacity.alpha12}`,
                }}
              >
                <Text variant="labelMedium" style={{ color: colors.onSurface }}>
                  Adding to:
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                  <Icon source={parentIcon} size={24} color={colors.onSurface} />
                  <Text variant="headlineSmall" style={{ color: colors.onSurface, fontSize: 18 }}>
                    {parentInfo.title}
                  </Text>
                </View>
                <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
                  {parentInfo.location}
                </Text>
              </Surface>
            )}

            {!hasStartedCapture ? (
              <View style={{ gap: spacing.sm }}>
                <Text variant="labelLarge" style={{ color: colors.onSurface }}>
                  Recognition language:
                </Text>
                <View style={{ alignSelf: 'stretch', gap: spacing.sm }}>
                  <Pressable
                    onPress={openLanguagePicker}
                    disabled={isListening || saving}
                    accessibilityRole="button"
                    accessibilityLabel="Choose recognition language"
                    style={({ pressed }) => ({
                      alignSelf: 'flex-start',
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: spacing.xs,
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.sm,
                      borderRadius: shapes.cornerFull,
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: `${colors.primary}${opacity.alpha24}`,
                      opacity: isListening || saving ? 0.5 : pressed ? 0.9 : 1,
                    })}
                  >
                    <Text variant="bodyMedium" style={{ color: colors.onSurface }}>
                      {languageLabel}
                    </Text>
                    <Icon source="chevron-down" size={18} color={colors.onSurfaceVariant} />
                  </Pressable>
                  {languageMenuVisible ? (
                    <Surface
                      elevation={elevation.level3}
                      style={{
                        alignSelf: 'flex-start',
                        minWidth: 220,
                        backgroundColor: colors.surface,
                        borderRadius: shapes.cornerMedium,
                        borderWidth: 1,
                        borderColor: `${colors.onSurface}${opacity.alpha12}`,
                        overflow: 'hidden',
                      }}
                    >
                      <View style={{ paddingVertical: spacing.xs }}>
                        {SPEECH_LANGUAGE_OPTIONS.map((option) => {
                          const isSelected = option.value === speechLanguage;
                          return (
                            <Pressable
                              key={option.value}
                              onPress={() => {
                                void setSpeechLanguage(option.value);
                                closeLanguagePicker();
                              }}
                              accessibilityRole="button"
                              accessibilityLabel={`Use ${option.label}`}
                              style={({ pressed }) => ({
                                minHeight: 44,
                                paddingHorizontal: spacing.md,
                                paddingVertical: spacing.sm,
                                flexDirection: 'row',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                backgroundColor: pressed
                                  ? `${colors.primary}${opacity.alpha08}`
                                  : 'transparent',
                              })}
                            >
                              <Text
                                variant="bodyMedium"
                                style={{
                                  color: colors.onSurface,
                                  fontWeight: isSelected ? '600' : '400',
                                }}
                              >
                                {option.label}
                              </Text>
                              {isSelected ? (
                                <Icon source="check" size={16} color={colors.primary} />
                              ) : null}
                            </Pressable>
                          );
                        })}
                      </View>
                    </Surface>
                  ) : null}
                </View>
              </View>
            ) : null}

            {!speechAvailable ? (
              <Surface
                elevation={elevation.level1}
                style={{
                  backgroundColor: colors.errorContainer,
                  borderRadius: shapes.cornerMedium,
                  padding: spacing.sm,
                }}
              >
                <Text variant="bodySmall" style={{ color: colors.onErrorContainer }}>
                  Speech recognition is not available on this device.
                </Text>
              </Surface>
            ) : null}

            {hasStartedCapture ? (
              <Surface
                elevation={elevation.level2}
                style={{
                  backgroundColor: colors.surface,
                  borderRadius: shapes.cornerLarge,
                  padding: spacing.md,
                  gap: spacing.sm,
                  borderWidth: 1,
                  borderColor: `${colors.onSurface}${opacity.alpha12}`,
                }}
              >
                {isListening ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <Animated.View
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 999,
                        backgroundColor: colors.primary,
                        opacity: listeningDotOpacity,
                        transform: [{ scale: listeningDotScale }],
                      }}
                    />
                    <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
                      Listening...
                    </Text>
                  </View>
                ) : null}
                <Text variant="labelLarge" style={{ color: colors.onSurface }}>
                  Recognized items:
                </Text>
                {recognizedItems.length === 0 ? (
                  <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                    {isListening
                      ? currentTranscript || 'Listening...'
                      : speechStatus === 'processing'
                        ? 'Processing...'
                        : 'No items recognized yet.'}
                  </Text>
                ) : (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                    {recognizedItems.map((item, index) => (
                      <Pressable
                        key={`${item}-${index}`}
                        onPress={() => handleRemoveItem(index)}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${item}`}
                        style={({ pressed }) => ({
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: spacing.xs,
                          paddingHorizontal: spacing.md,
                          paddingVertical: spacing.sm,
                          borderRadius: shapes.cornerSmall,
                          backgroundColor: colors.surface,
                          borderWidth: 1,
                          borderColor: `${colors.onSurface}${opacity.alpha24}`,
                          opacity: pressed ? 0.85 : 1,
                        })}
                      >
                        <Text style={{ color: colors.onSurface }}>{item}</Text>
                        <Icon source="close" size={14} color={colors.onSurface} />
                      </Pressable>
                    ))}
                  </View>
                )}
              </Surface>
            ) : null}

          </>
      </BottomSheetScrollView>
    </BottomSheetModal>
    </>
  );
}
