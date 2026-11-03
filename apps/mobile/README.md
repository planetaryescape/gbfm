# gbfm mobile

Expo SDK 58, React Native 0.88, and NativeWind 5.

## iOS simulator

Install workspace dependencies with `bun install` from the repository root. Use Xcode 27 for the iOS 27 simulator.

From `apps/mobile`:

```sh
bun run ios --port 8082
```

This builds and installs the native development client, starts Metro, and opens the simulator. `expo start` alone cannot install a missing native build. Keep one Metro process per port.

The API comes from `EXPO_PUBLIC_API_URL` in the mobile environment. The simulator can reach the host through `127.0.0.1`.

## Disposable local smoke tests

Start the fixture API from `apps/server`:

```sh
bun run dev:e2e
```

Then start the app from `apps/mobile`:

```sh
EXPO_PUBLIC_API_URL=http://127.0.0.1:3003 EXPO_NO_DEV_MENU=1 bun run ios --port 8082
```

The fixture API uses a disposable database, test accounts, and a 30-second silent audio file with byte-range support for native playback. It does not use production data. `EXPO_NO_DEV_MENU=1` keeps Expo's floating tools button from covering app controls during checks.

## Standalone iPhone build

Use the Expo account `guidefari` and the Apple Developer account `apple@guidefari.com`. Apple signing uses the GUIDE TENDAI FARI team, not the iCloud personal team or the work account.

From `apps/mobile`:

```sh
EXPO_APPLE_ID=apple@guidefari.com bunx eas-cli build --platform ios --profile preview
```

The preview profile creates an internally distributed Release build with the production API at `https://api.goosebumps.fm`. It does not require Metro. EAS handles signing and device registration; only registered devices can install this build.

The app identifier is `fm.goosebumps.gbfm`, and the signing team is `78328YPS5M`.

For a connected, trusted iPhone, build and install a standalone app locally with Expo CLI:

```sh
EXPO_PUBLIC_API_URL=https://api.goosebumps.fm bunx expo run:ios --device --configuration Release --no-bundler
```

## Tweet authoring and incoming shares

Tap the Tweets tab again while it is active (its icon becomes a compose icon), or choose **Write a tweet** in Settings. A tweet is one piece of text with a 280-character limit, where each link counts as 23 characters. On one of your own tweets, tap the **…** button beside the author and choose **Edit tweet** to change it in the same composer. Any signed-in listener can tap **Post your reply** under a tweet. Replies keep hashtags as plain text, and a reply that timed out may already be posted, so check the thread before retrying.

Write `#tags` inline as single words, using `_` for spaces (`#hip_hop`). Typing `#` suggests up to five existing tags. On save, tags are removed from the text and stored as the post's tags: spellings that differ only by case, spaces, `_` or `-` resolve to the existing tag, and new tags are stored in lowercase with `_` as a space.

The first music link in the text is resolved into an album, track, or playlist card. While the card is attached, the link is removed from the saved text, unless the link is the whole tweet. Remove the card to keep the link as plain text. Publishing requires creator permissions. **Save to drafts** saves a private draft to your account without publishing.

Local drafts save as you type, are scoped to the signed-in account, and survive restarts. A share received while signed out stays as a guest draft and joins your account draft after sign-in. New shares append without replacing existing text. Settings can discard the current account's local draft without deleting server content.

The `expo-sharing` config plugin enables incoming text and URL shares on iOS and Android. On iPhone, use another app's Share menu, then choose **gbfm**. Add it through **More** if needed. Files, photos, audio files, and videos are not accepted in this slice. A shared music link becomes a card in the composer, like a typed one.

This requires a native rebuild, not an OTA update or Expo Go. The iOS extension is `fm.goosebumps.gbfm.share` and uses the App Group `group.fm.goosebumps.gbfm.sharing`. Both targets must be provisioned on the configured Apple team. Expo's plugin declares the extension to EAS automatically. Local signing must use team `78328YPS5M` for both targets, not Expo CLI's automatically selected certificate from another team.

Settings remains available while signed out. Appearance choices persist across restarts. Sign-out and Spotify disconnection both ask for confirmation.

## SDK maintenance

```sh
bunx expo install --check
bunx expo-doctor
bun run test
```

Run `bun precommit` from the repository root before committing.

NativeWind uses its Babel preset with `globalClassNamePolyfill: false` in Metro. The global wrapper does not forward every React Native 0.88 export, which can break Expo native views and font loading.

The app icon is `assets/icon.png`, rendered from `assets/icon.svg`. It is an opaque 1024-pixel square; iOS applies the corner mask.
