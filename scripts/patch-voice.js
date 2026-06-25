const fs = require('fs');
const path = require('path');

const targetPath = path.join(
  __dirname,
  '..',
  'node_modules',
  '@react-native-voice',
  'voice',
  'android',
  'build.gradle'
);
const voiceModulePath = path.join(
  __dirname,
  '..',
  'node_modules',
  '@react-native-voice',
  'voice',
  'android',
  'src',
  'main',
  'java',
  'com',
  'wenkesj',
  'voice',
  'VoiceModule.java'
);

let didWork = false;

if (!fs.existsSync(targetPath)) {
  console.log('[patch-voice] build.gradle not found, skipping Gradle patch.');
} else {
  const original = fs.readFileSync(targetPath, 'utf8');
  const updated = original.replace(
    /com\.android\.support:appcompat-v7:\$\{supportVersion\}/g,
    'androidx.appcompat:appcompat:1.6.1'
  );

  if (updated !== original) {
    fs.writeFileSync(targetPath, updated, 'utf8');
    didWork = true;
    console.log('[patch-voice] Patched @react-native-voice/voice to use AndroidX appcompat.');
  } else {
    console.log('[patch-voice] Gradle patch not needed.');
  }
}

if (!fs.existsSync(voiceModulePath)) {
  console.log('[patch-voice] VoiceModule.java not found, skipping null-guard patch.');
} else {
  const original = fs.readFileSync(voiceModulePath, 'utf8');
  let updated = original;

  if (!updated.includes('onPartialResults-null-guard')) {
    updated = updated.replace(
      /public void onPartialResults\(Bundle results\) \{\s*WritableArray arr = Arguments\.createArray\(\);\s*/m,
      (match) =>
        `${match}    // onPartialResults-null-guard\n    if (results == null) {\n      return;\n    }\n\n`
    );
  }

  if (!updated.includes('onPartialResults-matches-null-safe')) {
    updated = updated.replace(
      /(public void onPartialResults\(Bundle results\) \{[\s\S]*?ArrayList<String> matches = results\.getStringArrayList\(SpeechRecognizer\.RESULTS_RECOGNITION\);)/m,
      (match) =>
        `${match}\n    // onPartialResults-matches-null-safe\n    if (matches == null) {\n      matches = new ArrayList<String>();\n    }`
    );
  }

  if (!updated.includes('onResults-null-guard')) {
    updated = updated.replace(
      /public void onResults\(Bundle results\) \{\s*WritableArray arr = Arguments\.createArray\(\);\s*/m,
      (match) =>
        `${match}    // onResults-null-guard\n    if (results == null) {\n      return;\n    }\n\n`
    );
  }

  if (!updated.includes('onResults-matches-null-safe')) {
    updated = updated.replace(
      /(public void onResults\(Bundle results\) \{[\s\S]*?ArrayList<String> matches = results\.getStringArrayList\(SpeechRecognizer\.RESULTS_RECOGNITION\);)/m,
      (match) =>
        `${match}\n    // onResults-matches-null-safe\n    if (matches == null) {\n      matches = new ArrayList<String>();\n    }`
    );
  }

  if (updated !== original) {
    fs.writeFileSync(voiceModulePath, updated, 'utf8');
    didWork = true;
    console.log('[patch-voice] Added null guards to VoiceModule results handling.');
  } else {
    console.log('[patch-voice] VoiceModule patch not needed.');
  }
}

if (!didWork) {
  console.log('[patch-voice] No changes applied.');
}
