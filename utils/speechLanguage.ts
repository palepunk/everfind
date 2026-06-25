import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { emitSettingsUpdate, subscribeToSettingsUpdates } from './sync/settingsSyncEvents';
import { touchSettingsUpdatedAt } from './sync/settingsMetadata';

export type SpeechLanguage =
  | 'system'
  | 'en-US'
  | 'de-DE'
  | 'nb-NO'
  | 'sv-SE'
  | 'da-DK'
  | 'fi-FI'
  | 'hu-HU';

export const SPEECH_LANGUAGE_OPTIONS: { label: string; value: SpeechLanguage }[] = [
  { label: 'System default', value: 'system' },
  { label: 'English', value: 'en-US' },
  { label: 'German', value: 'de-DE' },
  { label: 'Norwegian', value: 'nb-NO' },
  { label: 'Swedish', value: 'sv-SE' },
  { label: 'Danish', value: 'da-DK' },
  { label: 'Finnish', value: 'fi-FI' },
  { label: 'Hungarian', value: 'hu-HU' },
];

const STORAGE_KEY = 'speechRecognitionLanguage';

const localeToSpeechLanguage = (locale: string): SpeechLanguage => {
  const lower = locale.toLowerCase();
  const base = lower.split('-')[0];
  switch (base) {
    case 'de':
      return 'de-DE';
    case 'nb':
    case 'no':
      return 'nb-NO';
    case 'sv':
      return 'sv-SE';
    case 'da':
      return 'da-DK';
    case 'fi':
      return 'fi-FI';
    case 'hu':
      return 'hu-HU';
    case 'en':
    default:
      return 'en-US';
  }
};

const getDeviceLocale = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return 'en-US';
  }
};

export const resolveSpeechLanguageTag = (language: SpeechLanguage): string => {
  if (!language || language === 'system') {
    return getDeviceLocale() || 'en-US';
  }
  return language;
};

export const loadSpeechLanguage = async (): Promise<SpeechLanguage> => {
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  if (stored) {
    const matched = SPEECH_LANGUAGE_OPTIONS.find((option) => option.value === stored);
    if (matched) {
      return matched.value;
    }
  }
  const locale = getDeviceLocale();
  const inferred = localeToSpeechLanguage(locale);
  return inferred || 'system';
};

export const saveSpeechLanguage = async (
  language: SpeechLanguage,
  options?: { touchUpdatedAt?: boolean }
) => {
  await AsyncStorage.setItem(STORAGE_KEY, language);
  if (options?.touchUpdatedAt ?? true) {
    const updatedAt = await touchSettingsUpdatedAt();
    emitSettingsUpdate({
      speechLanguage: language,
      updatedAt,
      source: 'local',
    });
  }
};

export const useSpeechLanguage = () => {
  const [language, setLanguage] = useState<SpeechLanguage>('en-US');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let isActive = true;
    loadSpeechLanguage()
      .then((value) => {
        if (isActive) {
          setLanguage(value);
          setReady(true);
        }
      })
      .catch(() => {
        if (isActive) {
          setLanguage('system');
          setReady(true);
        }
      });
    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    return subscribeToSettingsUpdates((update) => {
      if (!update.speechLanguage) return;
      const matched = SPEECH_LANGUAGE_OPTIONS.find((option) => option.value === update.speechLanguage);
      if (matched) {
        setLanguage(matched.value);
      }
    });
  }, []);

  const updateLanguage = useCallback(async (next: SpeechLanguage) => {
    setLanguage(next);
    await saveSpeechLanguage(next);
  }, []);

  return { language, setLanguage: updateLanguage, ready };
};
