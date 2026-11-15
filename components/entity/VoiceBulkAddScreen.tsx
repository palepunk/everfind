import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, Pressable, View } from 'react-native';
import {
  BottomSheetBackdrop,
  BottomSheetFooter,
  BottomSheetModal,
  BottomSheetScrollView,
  type BottomSheetFooterProps,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { Icon, Text, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Voice from '@/utils/voice';
import { router, useLocalSearchParams } from 'expo-router';
import { activateKeepAwake, deactivateKeepAwake } from 'expo-keep-awake';

import { triggerGlobalRefresh } from '@/utils/hooks/useDatabase';
import { createPowerSyncLocalItem } from '@/utils/powersync/mutations';
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

import {
  ListeningHero,
  SheetButton,
  SheetCard,
  SheetFooterBar,
  SheetHeader,
  SheetLanguagePicker,
  SheetNotice,
  SheetRow,
  SheetTheme,
  getSheetFooterHeight,
  useSheetChrome,
} from '@/components/sheets/SheetKit';

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
  const { spacing, shapes } = custom;
  const chrome = useSheetChrome();
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
  const { language: speechLanguage, setLanguage: setSpeechLanguage } = useSpeechLanguage();
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

  const loadParentInfo = useCallback(async () => {
    const rawParentType = String(parentType || '');
    const rawParentId = String(parentId || '');
    if (!rawParentId || (rawParentType !== 'container' && rawParentType !== 'box' && rawParentType !== 'room')) {
      setLoading(false);
      return;
    }

    try {
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
    } catch (error) {
      console.error('Failed to load parent info', error);
      Alert.alert('Error', 'Failed to load target location.');
    } finally {
      setLoading(false);
    }
  }, [parentId, parentType]);

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

    Voice.onSpeechPartialResults = (event: any) => {
      handleTranscriptUpdate(event.value?.[0]);
      setSpeechStatus('listening');
    };
    Voice.onSpeechResults = (event: any) => {
      handleTranscriptUpdate(event.value?.[0]);
      setSpeechStatus('processing');
    };
    Voice.onSpeechError = (event: any) => {
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
  }, [parentInfo, recognizedItems]);

  const footerDisabled = !speechAvailable || saving || loading || !parentInfo;
  const recognizedCount = recognizedItems.length;

  const renderActionFooter = useCallback(
    (props: BottomSheetFooterProps) => (
      <BottomSheetFooter {...props} bottomInset={0}>
<SheetTheme theme={theme}>
        <SheetFooterBar bottomInset={insets.bottom}>
          {hasStoppedListeningOnce ? (
            <>
              <SheetButton
                variant="secondary"
                icon="microphone-plus"
                label="Add more"
                onPress={() => {
                  void startListening();
                }}
                disabled={footerDisabled}
              />
              <SheetButton
                icon="check"
                label={
                  saving
                    ? 'Adding...'
                    : recognizedCount > 0
                      ? `Add ${recognizedCount} ${recognizedCount === 1 ? 'item' : 'items'}`
                      : 'Add'
                }
                loading={saving}
                onPress={() => {
                  void handleAddItems();
                }}
                disabled={saving || isListening || recognizedCount === 0 || loading || !parentInfo}
                accessibilityLabel="Add items"
              />
            </>
          ) : (
            <SheetButton
              icon={isListening ? 'stop' : 'microphone'}
              label={isListening ? 'Stop listening' : 'Start listening'}
              onPress={() => {
                void handleToggleListening();
              }}
              disabled={footerDisabled}
            />
          )}
        </SheetFooterBar>
</SheetTheme>
      </BottomSheetFooter>
    ),
    [
      footerDisabled,
      handleAddItems,
      handleToggleListening,
      hasStoppedListeningOnce,
      insets.bottom,
      isListening,
      loading,
      parentInfo,
      recognizedCount,
      saving,
      startListening,
      theme,
    ]
  );

  return (
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
      {...chrome.modalProps}
    >
      <SheetTheme theme={theme}>
      <BottomSheetScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: spacing.xxl,
          paddingTop: spacing.xs,
          paddingBottom: spacing.xxl + getSheetFooterHeight(insets.bottom),
          gap: spacing.xxl,
        }}
      >
        <SheetHeader title="Bulk voice add" onClose={requestCloseModal} closeLabel="Close bulk voice add" />

        {loading ? (
          <SheetCard>
            <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
              Loading target location...
            </Text>
          </SheetCard>
        ) : !parentInfo ? (
          <SheetNotice>Could not load target location.</SheetNotice>
        ) : (
          <SheetCard>
            <SheetRow
              icon={parentIcon}
              overline="Adding to"
              title={parentInfo.title}
              subtitle={parentInfo.location}
            />
          </SheetCard>
        )}

        {!speechAvailable ? (
          <SheetNotice>Speech recognition is not available on this device.</SheetNotice>
        ) : null}

        {!hasStoppedListeningOnce ? (
          <ListeningHero
            listening={isListening}
            title={isListening ? 'Listening...' : 'Ready when you are'}
            hint={
              isListening
                ? currentTranscript || 'Say an item name, then pause briefly.'
                : 'Speak item names one by one. Pause briefly between items.'
            }
          />
        ) : null}

        {!hasStartedCapture ? (
          <SheetLanguagePicker
            value={speechLanguage}
            options={SPEECH_LANGUAGE_OPTIONS}
            onSelect={(next) => {
              void setSpeechLanguage(next);
            }}
            disabled={isListening || saving}
          />
        ) : null}

        {hasStartedCapture ? (
          <SheetCard
            label="Recognized items"
            trailing={
              recognizedCount > 0 ? (
                <View
                  style={{
                    minWidth: 24,
                    height: 24,
                    borderRadius: shapes.cornerFull,
                    paddingHorizontal: spacing.sm,
                    backgroundColor: colors.primaryContainer,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text variant="labelMedium" style={{ color: colors.onPrimaryContainer, fontWeight: '600' }}>
                    {recognizedCount}
                  </Text>
                </View>
              ) : null
            }
          >
            {recognizedCount === 0 ? (
              <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
                {isListening
                  ? 'Nothing yet. Say an item name.'
                  : speechStatus === 'processing'
                    ? 'Processing...'
                    : 'No items recognized yet.'}
              </Text>
            ) : (
              <>
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
                        minHeight: 36,
                        paddingLeft: spacing.xl,
                        paddingRight: spacing.md,
                        borderRadius: shapes.cornerFull,
                        backgroundColor: colors.secondaryContainer,
                        opacity: pressed ? 0.75 : 1,
                      })}
                    >
                      <Text variant="bodyMedium" style={{ color: colors.onSecondaryContainer, flexShrink: 1 }}>
                        {item}
                      </Text>
                      <Icon source="close" size={16} color={colors.onSecondaryContainer} />
                    </Pressable>
                  ))}
                </View>
                <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                  Tap an item to remove it.
                </Text>
              </>
            )}
          </SheetCard>
        ) : null}
      </BottomSheetScrollView>
      </SheetTheme>
    </BottomSheetModal>
  );
}
