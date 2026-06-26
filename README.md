# everfind FOSS

everfind is a home inventory app for keeping track of what you own and where it is stored.
It helps you organize houses, rooms, containers, boxes, and items, then search your inventory
when you need to find something.

<p align="center">
<img src="icon-192.png" alt="everfind icon" height="80">
</p>
<p align="center">
<img src="app screenshots.png" alt="App screenshots" height="310">
</p>

This repository contains the open-source FOSS edition of everfind. It is the local-first
edition: no account is required, data is stored on your device, and the app can be used
offline. The commercial everfind app is also available on:

- Google Play: https://play.google.com/store/apps/details?id=online.everfind.app
- App Store: https://apps.apple.com/us/app/everfind-home-inventory/id6756936410
- Website: https://everfind.online/

The store version includes extra cloud and premium features that are not part of this
public FOSS repository.

## Features

- Create a searchable home inventory.
- Organize items by rooms, containers, boxes, and storage locations.
- Add names, descriptions, notes, prices, tags, and photos.
- Import and export inventory data with CSV.
- Export inventory views to PDF.
- Use bulk voice add for faster item entry when speech recognition is available on the device.
- Use the app offline without signing in.

## Requirements

- Node.js 20
- npm
- JDK 17
- Android Studio and Android SDK for local Android native builds

Expo Go is not enough for this app because it uses native modules. Use an Expo dev client
or a native Android build.

## Development

Install dependencies after cloning:

```bash
npm ci
```

Start Metro for the FOSS dev client:

```bash
npm run start:foss
```

Run tests and lint:

```bash
npm test
npm run lint
```

## Local Android Builds

Generate the native Android project and build locally:

```cmd
set APP_VARIANT=production
npx expo prebuild --platform android --clean
cd android
gradlew.bat :app:assembleRelease --no-daemon
```

On PowerShell, use:

```powershell
$env:APP_VARIANT = "production"
npx expo prebuild --platform android --clean
Set-Location android
.\gradlew :app:assembleRelease --no-daemon
```