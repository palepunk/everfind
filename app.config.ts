// app.config.ts
import 'dotenv/config';

const variant = process.env.APP_VARIANT ?? 'development';
const isDev = variant === 'development';
const isTest = variant === 'test';
const isProd = variant === 'production';

const androidVersionCode = (() => {
  if (isProd) return Number(process.env.ANDROID_VERSION_CODE ?? 50);
  if (isTest) return Number(process.env.ANDROID_VERSION_CODE_TEST ?? 1001);
  return Number(process.env.ANDROID_VERSION_CODE_DEV ?? 2001);
})();

const config = {
  name: 'everfind',
  slug: 'everfind',
  version: '1.5.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'everfind-foss',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,

  ios: {
    icon: './assets/images/ios-icon.png',
    supportsTablet: false,
    bundleIdentifier: 'online.everfind.app.foss',
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSCameraUsageDescription:
        'Take photos of items, boxes, or storage locations to attach them to your home inventory.',
      NSPhotoLibraryUsageDescription:
        'Select existing photos to attach to items or import a CSV file to your home inventory.',
      NSPhotoLibraryAddUsageDescription:
        'Save exported CSV files from your home inventory to your device or Files app.',
      NSMicrophoneUsageDescription: 'Use your voice to add items to your home inventory.',
      NSSpeechRecognitionUsageDescription:
        'Convert your spoken item names into text to quickly add them to your home inventory.',
    },
  },

  android: {
    package: 'online.everfind.app.foss',
    versionCode: androidVersionCode,
    adaptiveIcon: {
      backgroundColor: '#ffffff',
      foregroundImage: './assets/images/android-icon-foreground.png',
    },
    permissions: ['RECORD_AUDIO'],
    intentFilters: [],
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
  },

  web: {
    output: 'static',
    favicon: './assets/images/favicon.ico',
  },

  plugins: [
    'expo-router',
    ...(isDev ? [['expo-dev-client', { launchMode: 'launcher' }]] : []),
    [
      'expo-splash-screen',
      {
        image: './assets/images/splash-icon.png',
        imageWidth: 200,
        resizeMode: 'contain',
        backgroundColor: '#ffffff',
        dark: {
          backgroundColor: '#000000',
        },
      },
    ],
    [
      'expo-build-properties',
      {
        ios: {
          deploymentTarget: '16.0',
        },
      },
    ],
    './plugins/withReactNativeVoice.js',
  ],

  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },

  extra: {
    router: {},
    appVariant: variant,
  },
};

export default config;
