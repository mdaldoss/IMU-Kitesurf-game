# KiteBar — native shell (Capacitor)

Wraps the web pages in a native iOS/Android app so they get **real OS haptics**
(`@capacitor/haptics`) — the thing mobile browsers can't do from a background
event. The pages auto-detect the native shell and use the native plugin; in a
plain browser they fall back to the web haptic paths.

The app launches into the **standalone game** (`public/game.html` → `index.html`):
a single-device kite game with on-device IMU, physics, native haptics, real-spot
wind presets, bar-pull power and jumps — **no laptop or network needed**. A link
on the start screen opens **Trainer mode** (`public/phone.html` → `trainer.html`),
the IMU-sensor page that steers a laptop display over **cleartext `ws://` on the
LAN** (a native WebView can't bypass the self-signed cert the browser path uses).
Enter the laptop's address (printed by `npm start` in the repo root) there.

## Prerequisites

- Node 18+ and the laptop relay running (`npm start` in the repo root).
- **iOS:** a Mac with Xcode + an Apple ID for signing. (iOS apps can only be
  built on macOS — this cannot be done from Linux/Windows.)
- **Android:** Android Studio (or the SDK + a connected device/emulator).

## Build & run

```bash
cd mobile
npm install
npm run copy:web            # bundles ../public/phone.html into www/

# pick your platform(s):
npm run add:ios             # creates ios/  (macOS only)
npm run add:android         # creates android/
npm run sync                # copies web + installs native plugins

npm run open:ios            # opens Xcode  → set Signing team → Run on device
npm run open:android        # opens Android Studio → Run on device
# or directly:
npm run run:android
```

After editing `public/game.html` / `public/phone.html` (or the shared `*.js`
modules), re-run `npm run sync` to push the change into the native projects.

## Required native settings

### iOS (in Xcode, on the generated `ios/` project)

Connecting to a LAN IP triggers iOS's local-network privacy prompt and ATS, so
add to `ios/App/App/Info.plist`:

```xml
<key>NSLocalNetworkUsageDescription</key>
<string>Connect to the kite simulator running on your laptop.</string>
<key>NSAppTransportSecurity</key>
<dict>
  <key>NSAllowsLocalNetworking</key>
  <true/>
</dict>
```

`NSAllowsLocalNetworking` permits cleartext `ws://` to LAN hosts without
disabling ATS globally. Also set your **Signing Team** under Signing &
Capabilities so it runs on a physical device.

### Android

`cleartext: true` in `capacitor.config.json` already enables cleartext traffic,
so no manual manifest edit is needed. Run on a real device for haptics
(emulators don't vibrate).

## Using it

1. Start the relay on the laptop (`npm start`) and note the printed
   `laptop address to enter in the app`, e.g. `192.168.1.42:8080`.
2. Open the app, type that address, tap **Enable sensors & connect**, grant
   motion + local-network permissions.
3. Open the laptop display (`https://<ip>:8443/`) and steer — the haptic line
   shows `haptic mode: native`, and crossing 12 o'clock fires a real tap.
4. Use **Test haptic now** to confirm the OS haptic independently.

## Notes

- `www/` and the native `ios/`/`android/` folders are generated and gitignored;
  recreate them with the commands above.
- Haptic strength: tweak `ImpactStyle` in `public/phone.html`
  (`Haptics.impact({ style: 'MEDIUM' })` → `LIGHT` / `HEAVY`).
