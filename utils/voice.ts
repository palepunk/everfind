import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

const NativeVoice = NativeModules.Voice || NativeModules.RCTVoice;
const voiceEmitter =
  Platform.OS !== 'web' && NativeVoice ? new NativeEventEmitter(NativeVoice) : null;

const createVoiceWrapper = () => {
  const events: Record<string, (...args: any[]) => void> = {
    onSpeechStart: () => {},
    onSpeechRecognized: () => {},
    onSpeechEnd: () => {},
    onSpeechError: () => {},
    onSpeechResults: () => {},
    onSpeechPartialResults: () => {},
    onSpeechVolumeChanged: () => {},
  };

  let listeners: any[] | null = null;

  const ensureListeners = () => {
    if (!listeners && voiceEmitter) {
      listeners = Object.keys(events).map((key) =>
        voiceEmitter.addListener(key, events[key])
      );
    }
  };

  const invokeCallback = (callback: (error?: string | false) => void, error?: any) => {
    if (error) {
      callback(String(error));
    } else {
      callback(false);
    }
  };

  const start = (locale: string, options: Record<string, any> = {}) =>
    new Promise<void>((resolve, reject) => {
      if (!NativeVoice) {
        reject(new Error('Voice module not available'));
        return;
      }

      ensureListeners();
      const callback = (error?: string | false) => {
        if (error) {
          reject(new Error(String(error)));
        } else {
          resolve();
        }
      };

      if (Platform.OS === 'android') {
        NativeVoice.startSpeech(
          locale,
          {
            EXTRA_LANGUAGE_MODEL: 'LANGUAGE_MODEL_FREE_FORM',
            EXTRA_MAX_RESULTS: 5,
            EXTRA_PARTIAL_RESULTS: true,
            REQUEST_PERMISSIONS_AUTO: true,
            ...options,
          },
          callback
        );
      } else {
        NativeVoice.startSpeech(locale, callback);
      }
    });

  const stop = () =>
    new Promise<void>((resolve, reject) => {
      if (!NativeVoice) {
        resolve();
        return;
      }
      NativeVoice.stopSpeech((error: string | false) => {
        if (error) {
          reject(new Error(String(error)));
        } else {
          resolve();
        }
      });
    });

  const cancel = () =>
    new Promise<void>((resolve, reject) => {
      if (!NativeVoice) {
        resolve();
        return;
      }
      NativeVoice.cancelSpeech((error: string | false) => {
        if (error) {
          reject(new Error(String(error)));
        } else {
          resolve();
        }
      });
    });

  const destroy = () => {
    if (!listeners && !voiceEmitter) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      if (!NativeVoice) {
        resolve();
        return;
      }
      NativeVoice.destroySpeech((error: string | false) => {
        if (error) {
          reject(new Error(String(error)));
          return;
        }
        if (listeners) {
          listeners.forEach((listener) => listener.remove());
          listeners = null;
        }
        resolve();
      });
    });
  };

  const isAvailable = () =>
    new Promise<number>((resolve) => {
      if (!NativeVoice) {
        resolve(0);
        return;
      }
      NativeVoice.isSpeechAvailable((available: boolean, error?: string) => {
        resolve(available && !error ? 1 : 0);
      });
    });

  const getSpeechRecognitionServices = () => {
    if (!NativeVoice?.getSpeechRecognitionServices) {
      return Promise.resolve([]);
    }
    return NativeVoice.getSpeechRecognitionServices();
  };

  const isRecognizing = () =>
    new Promise<number>((resolve) => {
      if (!NativeVoice) {
        resolve(0);
        return;
      }
      NativeVoice.isRecognizing((recognizing: boolean) => {
        resolve(recognizing ? 1 : 0);
      });
    });

  const voiceWrapper: any = {
    start,
    stop,
    cancel,
    destroy,
    isAvailable,
    getSpeechRecognitionServices,
    isRecognizing,
  };

  Object.keys(events).forEach((key) => {
    Object.defineProperty(voiceWrapper, key, {
      set: (handler: (...args: any[]) => void) => {
        events[key] = handler;
        if (listeners) {
          listeners.forEach((listener) => listener.remove());
          listeners = null;
          ensureListeners();
        }
      },
    });
  });

  return voiceWrapper;
};

const Voice = createVoiceWrapper();

if (__DEV__) {
  const moduleKeys = Object.keys(NativeModules || {}).sort();
  const voiceKeys = ['Voice', 'RCTVoice'].filter((key) => key in NativeModules);
  console.log('[voice] NativeModules keys:', moduleKeys);
  console.log('[voice] Voice module keys:', voiceKeys);
  console.log('[voice] Using native module:', NativeVoice ? 'available' : 'missing');
}

export default Voice;
