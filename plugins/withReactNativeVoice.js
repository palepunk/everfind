const { withSettingsGradle, withAppBuildGradle, withMainApplication } = require('@expo/config-plugins');

const VOICE_PACKAGE = 'com.wenkesj.voice.VoicePackage';
const SETTINGS_SNIPPET = [
  "include ':react-native-voice'",
  "project(':react-native-voice').projectDir = new File(rootProject.projectDir, '../node_modules/@react-native-voice/voice/android')",
].join('\n');

function ensureSettingsGradle(contents) {
  if (contents.includes("react-native-voice")) {
    return contents;
  }
  return `${contents}\n${SETTINGS_SNIPPET}\n`;
}

function ensureAppBuildGradle(contents) {
  if (contents.includes("react-native-voice")) {
    return contents;
  }
  return contents.replace(
    /dependencies\s*\{/,
    "dependencies {\n    implementation project(':react-native-voice')"
  );
}

function withReactNativeVoice(config) {
  config = withSettingsGradle(config, (config) => {
    config.modResults.contents = ensureSettingsGradle(config.modResults.contents);
    return config;
  });

  config = withAppBuildGradle(config, (config) => {
    config.modResults.contents = ensureAppBuildGradle(config.modResults.contents);
    return config;
  });

  config = withMainApplication(config, (config) => {
    let contents = config.modResults.contents;

    if (!contents.includes(VOICE_PACKAGE)) {
      contents = contents.replace(
        /package\s+[\w.]+\s*\n/,
        (match) => `${match}import ${VOICE_PACKAGE}\n`
      );
    }

    const hasVoicePackageAdd =
      contents.includes('add(VoicePackage())') || contents.includes('new VoicePackage()');

    if (!hasVoicePackageAdd) {
      if (contents.includes('new PackageList(this).getPackages()')) {
        contents = contents.replace(
          /List<ReactPackage>\s+packages\s+=\s+new PackageList\(this\)\.getPackages\(\);/,
          (match) => `${match}\n    packages.add(new VoicePackage());`
        );
      } else if (contents.includes('PackageList(this).packages.apply')) {
        contents = contents.replace(
          /PackageList\(this\)\.packages\.apply\s*\{\s*/,
          (match) => `${match}  add(VoicePackage())\n`
        );
      } else if (contents.includes('PackageList(this).packages')) {
        contents = contents.replace(
          /val\s+packages\s+=\s+PackageList\(this\)\.packages/,
          (match) => `${match}\n        packages.add(VoicePackage())`
        );
      }
    }

    config.modResults.contents = contents;
    return config;
  });

  return config;
}

module.exports = withReactNativeVoice;
