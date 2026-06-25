module.exports = {
  dependencies: {
    '@react-native-voice/voice': {
      platforms: {
        android: {
          sourceDir: 'node_modules/@react-native-voice/voice/android',
        },
        ios: {
          podspecPath: 'node_modules/@react-native-voice/voice/react-native-voice.podspec',
        },
      },
    },
  },
};
