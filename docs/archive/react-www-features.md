# `@gbfm/www` — Features and Affordances

Historical inventory of the retired React WWW app. This is not current implementation guidance. See [EFFECT-UI.md](../../EFFECT-UI.md) and the [Design System](../design-system.md) for the current UI owners.

`apps/www` is the public web app for **goosebumps.fm** — a curated archive of DJ mixes, radio shows, editorial writing, and music discovery. It is a Vite + React 19 SPA that talks to a separate Effect-TS backend (`@gbfm/vps`) and uses TanStack Router for client-side routing.

This document describes what the app *does* (features) and what surfaces the user can *interact with* (affordances).

---

## 1. Stack at a glance

- **Build**: Vite 8, React 19, TypeScript 6, TSX/TS strict mode.
- **Routing**: TanStack Router v1 (file-based, with type-safe `routeTree.gen.ts`).
- **Server state**: TanStack Query v5 (REST), with a shared `fetcher` that auto-reports 5xx and network failures to Sentry.
- **Client state**: Zustand (audio player, UI, onboarding, content, auth prompt).
- **Styling**: Tailwind v4, Radix UI primitives, Lucide icons, custom `goosebumps.fm` theme tokens from `@gbfm/theme`.
- **MDX**: `@mdx-js/rollup` at build time, `@mdx-js/mdx` runtime-compiled in the browser via `MDXRendrr` for server-rendered content.
- **Auth**: `better-auth` (admin + username plugins) with `cookie` sessions proxied to the VPS.
- **Audio**: native HTML5 `<audio>` driven by a Zustand `audioPlayer` store; Spotify via `@spotify-effect/browser`; OS media keys via `navigator.mediaSession`.
- **Uploads**: Resumable, chunked S3 uploads with localStorage-backed checkpoints (`useResumableUpload`).
- **Observability**: Sentry (browser tracing + replay on errors), with a `SentryAnalyticsLayer` for analytics.
- **Testing**: Vitest for units, Playwright (mobile Chrome) for E2E.

Vite plugins worth knowing:

- `plugins/repo-changelog.ts` — exposes the repo-root `CHANGELOG.md` as a virtual module so the `/changelog` route can compile it as MDX.
- `plugins/theme-colors.ts` — replaces `<!-- theme-color:dark -->` / `<!-- theme-color:light -->` placeholders in `index.html` with the real hex values, preventing a flash of the wrong background on first paint.
- Tailwind v4 via `@tailwindcss/vite` is wired in `vite.config.ts`.
- `vite.config.ts` proxies `/api`, `/auth`, `/health`, `/rss.xml`, `/sitemap.xml`, `/s/` to the VPS at `http://127.0.0.1:3003` during dev.

---

## 2. Surface map (routes)

Routes live under `src/routes/`. The root layout (`__root.tsx`) wraps the app with `ErrorBoundary`, `ThemeProvider`, `QueryClientProvider`, `AppShell`, plus a few global portals (`OfflineBanner`, `VerifyEmailBanner`, `WelcomeModal`, `AuthPromptDialog`, `Toaster`).

### Public surface

| Path | Purpose |
| --- | --- |
| `/` | Minimal landing page: brand wordmark + `FeaturedMixHero` (one-click play of the latest mix, links to `/shows`). |
| `/mixes` | Infinite-scroll feed of all mixes, with tag filter (URL-bound via `?tag=`), sort toggle (date/title asc/desc from `useUIStore`), context menu, and per-item play/queue/favorite/share actions. |
| `/mixes/$mixId` | Mix detail page: cover art, play/pause button, action bar (favorite, add to queue, share, QR PDF, edit), show attribution, MDX body. SEO head (`music.song` + `og:audio`). |
| `/tracks/$trackId` | Long-form track page using the `LongPost` layout (sticky left art + YouTube embed, MDX body on the right). |
| `/releases/$slug` | Release page (albums), `LongPost` layout. |
| `/labels` and `/labels/$labelSlug` | Record label directory and label page with releases table. |
| `/shows` | Two-pane shows directory (sidebar list, selected show with `SubscribeButton`, `EpisodeGrid`). |
| `/shows/$showSlug` | Show page: sticky metadata column (favorite, share, QR, metadata manager), MDX description, `EpisodeGrid` of mixes on the right. |
| `/editorial` and `/editorial/$slug` | Editorial list and post pages (long-form articles, MDX bodies, tag filter, share). |
| `/tweet` and `/tweet/$slug` | Micro-post list and detail (`TweetListCard` with optional `TweetMusicEntityCard` showing album/track/playlist preview + verified stream links). |
| `/djs` | Index of all DJs/residents with their published mix count. |
| `/profile/$username` | Public profile (avatar, bio, social links, horizontal-scroll grids of their mixes, shows, editorials, tweets). |
| `/$slug` | Catch-all "resolve a slug" route. The backend returns either a profile or a show; the route renders the appropriate page. |
| `/subscribe` | Newsletter subscription form (name + email). |
| `/unsubscribe` | Two flows: token-based one-click unsubscribe (`?token=`) and an email-form to request an unsubscribe link. |
| `/changelog` | Renders the repo-root `CHANGELOG.md` as MDX (sourced via the `virtual:repo-changelog` Vite plugin). |
| `/reminders` | "Listen to this later" — paste a music URL, server enriches it, schedule an email reminder. |
| `/privacy`, `/terms` | Placeholder legal pages. |
| `/invite/charlie3000` | A bespoke pitch page (not behind auth). Demonstrates the visual style for one-off content. |

### Auth surface

| Path | Purpose |
| --- | --- |
| `/auth/sign-in` | Identifier-or-username + password sign in, with `?redirect=` support. |
| `/auth/sign-up` | Email/name/username/password sign up with live username availability check, password checklist, post-signup verification-email confirmation screen. |
| `/auth/forgot-password` and `/auth/reset-password` | Password reset by email link. |
| `/auth/verify-email` | Confirms the `?token=` from the verification email and redirects. |

### Authenticated surface (any signed-in user)

| Path | Purpose |
| --- | --- |
| `/dashboard` | Welcome view: name + favorites list (with hover-to-play) and upcoming/recent music reminders. |
| `/dashboard/profile` | Edit profile: avatar upload, username, email; "change password" triggers a reset email. |
| `/dashboard/appearance` | Theme: light / dark / system. |
| `/dashboard/player` | Toggle for the bottom mini player (full bar vs. menu-only). |
| `/dashboard/email` | Email preferences: mix-release, promotional, system, global unsubscribe. |

### Authenticated surface (admin or editor only)

| Path | Purpose |
| --- | --- |
| `/mix-upload` | Upload a mix: title, description, slug, MDX body, thumbnail, tags, tracklist timestamps, optional show + episode number. Resumable S3 audio upload + draft autosave (`useMixUploadDraft`). Editor + admin only (guarded in `nav-access.ts` and on the route). |
| `/label-upload` | Add or edit a record label (admin only). |

### Admin surface (admin only)

A dedicated sidebar layout (`SidebarLayout` with `AdminPage` wrapper) for `/admin/**`.

| Path | Purpose |
| --- | --- |
| `/admin` | High-level dashboard: 4 KPI cards (users, newsletter subscribers, published mixes, total plays) + "what changed" callouts. |
| `/admin/overview` | Deeper dashboard with publishing pulse per content type, community snapshot, operational health, recent content, top mixes, recent email failures, newest users, newest subscribers. |
| `/admin/users` | User search, role editing, profile editing, ban actions. |
| `/admin/content` | Operate mixes, editorials, tweets, labels from one place. |
| `/admin/shows` | Create/edit shows, manage hosts and metadata. |
| `/admin/newsletter` | Audience + campaign tools. |
| `/admin/email-logs` | Filterable email delivery log (status, recipient, date range). |
| `/admin/sessions` | Inspect active sessions, sign-out, cleanup. |
| `/admin/music` | Tabbed music catalog: artists, albums, tracks, playlists (inline edit buttons → `/admin/music-entity/$entityType/$id`). |
| `/admin/playlists` | Spotify playlist import + reordering. |
| `/admin/search` | Test the content search endpoint. |
| `/admin/frontend-errors` | Six-button "fault injector" + a network-failure scenario that confirms which responses get reported to Sentry. |
| `/admin/music-entity/$entityType/$id` | Music-entity detail editor (artists/albums/tracks and their streaming links). |
| `/new/tweet` | Capture a tweet into the editorial feed (admin). |
| `/new/editorial` | Create / edit a long-form editorial post (admin). |

---

## 3. The audio player

The audio player is the heart of the app. Everything else is there to feed it.

### State model

`src/store/audioPlayer.ts` is a Zustand store that holds:

- `audioRef` — the singleton `HTMLAudioElement` (created by `useAudioPlayerInitializer` and wired in `AppShell`).
- `audioSrc`, `thumbnailUrl`, `nowPlayingContext`, `currentTrackId`, `currentTime`, `duration`, `progress`.
- `volume`, `isMuted`.
- `queue` + `currentIndex` + `isQueueVisible`.
- `isFullscreenVisible` and `isInitialized`.
- A pure-function `playerReducer` (`src/services/audio-player/machine.ts`) with actions for `PLAY`, `PAUSE`, `LOAD_TRACK`, `PRELOAD_TRACK`, `UPDATE_PROGRESS`, `SET_VOLUME`, `TOGGLE_MUTE`, `SET_TIME`, queue ops, visibility toggles, `TRACK_ENDED`, and `SET_INITIALIZED`.

A separate `workflow.ts` decouples the *decision* of what should happen on `loadTrack`, `pause`, seek, and progress update from the state itself, so it can be unit tested without React.

### Service layer (`src/services/audio-player/`)

- `AudioStorage` — Effect Context service for persisting per-track resume positions in `localStorage` (`gbfm:audio:position:{trackId}`). Has `Live` (real), `Test` (no-op), and `InMemory` layers.
- `MediaSessionService` — Effect service that wraps `navigator.mediaSession` (metadata, playback state, position state, action handlers). The store binds its action handlers (play/pause, seek, prev/next) back to the same Zustand actions.
- `events.ts` — typed analytics event names + property shapes.

The runtime is wired in `src/runtime/index.ts` via `Layer.mergeAll` of all these services plus the Spotify and analytics layers, exposed as `RuntimeClient.runPromise(effect)`.

### Player surfaces

- **Bottom bar (`BaseAudioPlayer`)** — fixed to the bottom of the viewport on desktop (≥ `lg`). Three columns: track info + favorite, transport controls + scrubber, volume + queue toggle. Hidden on `lg` if `isFullscreenVisible` or no audio is loaded.
- **Fullscreen player (`FullscreenAudioPlayer`)** — animated slide-up overlay (framer-motion `AnimatePresence`) with large cover, prev/play/next, scrubber, volume slider. Reachable from the bottom bar's cover art or with the `F` hotkey.
- **Queue panel (`QueueColumn`)** — `Sheet` from the right with the "Now Playing" entry and a `SortableContext` from `@dnd-kit/sortable` for drag-to-reorder, plus per-item play/remove.
- **Floating menu mini (`NowPlayingMini`)** — when the floating menu is open, a compact now-playing card sits above the tile grid.
- **Now playing on every list card** — `MixListItem`, `Track`, `MultiTrack`, and the queue `SharedQueueItem` all reflect whether they are the active track and show play/pause accordingly.

### Player affordances (per track)

- One-click play from any list, card, or context menu.
- Right-click context menu (`TrackContextMenu`, `MixMenu`): play now, add to queue, favorite, share.
- Drag-to-reorder inside the queue.
- Resume from the last saved position per track (`AudioStorage`).
- Media Session metadata + hardware media keys.
- `M` mutes, `Space` toggles play/pause, `←/→` prev/next, `Alt+←/→` ±10s seek, `Alt+↑/↓` volume, `Q` opens the queue, `F` toggles fullscreen, `Esc` closes fullscreen.
- Scrolling on the volume icon or slider adjusts volume (exponential curve).
- `useMixPlayTracking` posts a `POST /content/audio/{id}/play` once per 30-minute dedup window.
- `useDefaultTrackPreloader` primes the latest mix on app load so a tap on play is instant.
- `useMediaHotkeys` is mounted at the `AppShell` level; the same hotkeys work from anywhere.

### Play tracking and dedup

`useMixPlayTracking` watches `currentTrackId` + `isPlaying`, dedups in `localStorage` (key `gbfm_play_sessions`) within a 30-minute window per track, then `POST`s to the VPS.

---

## 4. Auth + permissions

`src/lib/auth-client.ts` exposes a `better-auth` React client with the `username` and `admin` plugins. Roles (`user`, `creator`, `editor`, `admin`) are defined in `src/lib/auth-permissions.ts` and granted the corresponding statements (`audio`, `post`, `mix`, `release`, `label` × create/read/update/delete/publish/manage).

`useSession()` powers the `useAuthGuard` hook — any unauthenticated attempt (e.g. tapping the heart to favorite) opens the `AuthPromptDialog` modal instead of throwing. The dialog has three modes: choice, sign-in, sign-up, and on success it runs the original action.

The router carries an `auth` context (`{ user, isAuthenticated }`) set in `App` based on `useSession()`. Routes that need protection use `beforeLoad`:

- `/mix-upload`, `/new/editorial`, `/new/tweet` — require auth and admin.
- `/label-upload` — require auth and admin.
- `/admin/**` — wrapped in `AdminAccessGuard` (UI-level) and gated by `nav-access.ts` (`canSeeNavItem`).

`nav-access.ts` also gates the floating menu tiles: `adminOnly` for the Admin tile, `minRole: 'editor'` for "Create" tiles, `authOnly` for Dashboard vs. Login.

On sign-in, the new session re-renders the app, and a `WelcomeModal` (if not previously dismissed in `onboarding` Zustand store) walks the new user through favorites, notifications, and contributing.

A persistent `VerifyEmailBanner` shows at the top of the page for unverified users, with a 30s resend cooldown (`useCooldown`).

---

## 5. Content model surfaces

The app reads from a small set of content types:

- **Audio** — three subtypes: `mix`, `track`, `misc` (defined in `http-query-keys.ts`). All rendered through `MixListItem` or `LongPost` depending on whether they have a body.
- **Editorial posts** — long-form, MDX, optional thumbnail, tags. Rendered via `MDXRendrr` with the `mdx-components` custom element map.
- **Micro posts (tweets)** — short-form, MDX-compiled, optional `musicEntityType` + `musicEntityId` for an inline `TweetMusicEntityCard`.
- **Radio shows** — a show has many episodes (which are `audio` rows). Shows have hosts, a description, MDX content.
- **Record labels** — label profile + associated `releases` table.
- **DJs / users** — see `useDjs()` and the public profile page.

Custom MDX components (`src/components/mdx-components.tsx`):

- `Album` and `Playlist` — server-enriched Spotify album/playlist via the proxy, rendered as `MultiTrack` with inline preview.
- `Track` — server-enriched Spotify track, rendered as `MinimalCard`.
- `Tracklist` — plain list of searchable text links.
- `HorizontalScrollCards` and `YoutubeEmbed` from `@gbfm/ui`.
- `HorizontalScrollCards` is also used on the public profile content grid (mixes, editorials, tweets).

The `MDXRendrr` component compiles the string at runtime via `@mdx-js/mdx`'s `run` so server-rendered MDX can be displayed without a build step. It surfaces compile errors inline with a "show raw content" affordance.

---

## 6. Uploads and drafts

The mix upload flow is the most complex non-audio surface.

- `useResumableUpload` (`src/hooks/useResumableUpload.ts`) — Effect-based, chunked S3 upload with pause/resume/cancel. Stores checkpoints in `ResumableUploadStorage` (also an Effect service) keyed by file fingerprint. Phases: `idle → preparing → uploading → paused → finalizing → completed / aborted / error`. When the device goes offline (`useOnlineStatus`), the upload auto-pauses.
- `useMixUploadDraft` (`src/hooks/useMixUploadDraft.ts`) — debounces (600ms) every form change into a `MixUploadDraft` (title, slug, content, tags, tracklist, audio + artwork fingerprint and file name) and persists via `MixUploadDraftStorage` so a long upload survives a refresh. Supports `clearDraft` on submit.
- `useFileUpload` — `File` + `URL.createObjectURL` for local previews.
- `S3AudioFilePicker` — wrapper around the shared `S3MediaFilePicker` UI that fetches the bucket config + object list and lets the editor pick an existing S3 audio file.

The mix-upload page itself (`/mix-upload`) uses an editor (MDX with `react-mde` write/preview tabs and Spotify/SoundCloud/Bandcamp/YouTube embed shortcuts), a tracklist editor with timestamps, a thumbnail picker, and a series of save/publish actions.

---

## 7. Public profile and resolution

- `/profile/$username` renders `PublicProfilePage` (`PublicProfilePage`), with a sticky user column (`ProfileUserColumn`) and a horizontal-scroll content grid (`ProfileContentGrid`).
- `/$slug` is the resolve route. The backend returns `{ type: 'profile' | 'show', data }`; the page branches accordingly. This is what makes "click someone's username anywhere" go to the right place.
- `useResolveSlug` is the underlying query.

The profile page exposes per-platform social links (Bandcamp, Substack, SoundCloud, Instagram, Twitter, TikTok) rendered by `ProfileSocialLinks` with custom inline SVG icons, plus a one-click "copy profile link" affordance using `navigator.clipboard.writeText`.

---

## 8. Search, tags, filters

- `/mixes` and `/editorial` both implement a `?tag=` search param validated by Zod and pushed through the router (`navigate({ search: { tag } })`). The select component is a Radix `Select`.
- `/shows` uses `?show=` to select which show is in the right pane (auto-redirects to the first one if none is selected).
- `/tweet` uses `?tag=` and renders a horizontal tag strip.
- The `LoadMoreTrigger` (`src/components/LoadMoreTrigger.tsx`) drives infinite scroll for paginated lists using `IntersectionObserver`.

---

## 9. Editor and content authoring

Two routes in `/new/**` are admin-only and use bespoke editor components:

- `/new/tweet` — `TweetCapturePage` is a short-form capture UI for tweets (URL or text, optional music entity link).
- `/new/editorial` — `EditorialPage` wraps the long-form editor: MDX via `react-mde`, a thumbnail upload, tags, and publish/unpublish.

The admin `/admin/content` page ties them together as a "publish across types" hub.

---

## 10. Theming

- `ThemeProvider` (`src/components/ThemeProvider.tsx`) reads `localStorage['vite-ui-theme']`, supports light/dark/system, and updates the `<html data-theme>` + `<meta name="theme-color">` on change.
- The Vite `theme-colors` plugin keeps the initial paint from flashing the wrong background by replacing the placeholders in `index.html` with the actual hex from `@gbfm/theme` tokens.
- Tokens are defined in `src/styles/main.css` as Tailwind v4 `@theme` block, which map to `bg-*`, `text-*`, `border-*` classes throughout.
- Light, dark, and `studio` palettes live in `@gbfm/theme` (used by `dark`/`light` exports here).
- Custom `bg-vinyl-rings` background utility for the auth layout vinyl effect; `overflow-title-marquee` for animated now-playing titles.

---

## 11. Observability

- Sentry initialized in `main.tsx` (browser tracing, replay on errors only, `tracePropagationTargets` filtered to known origins). `beforeSend` and `beforeSendTransaction` strip local URLs so dev traffic never hits production dashboards.
- The shared `fetcher` (`src/lib/http-client.ts`) calls `reportFailure` for 5xx responses and `TypeError` (network) failures — wired in `lib/http.ts` to `RuntimeClient.runPromise(captureException(...))`.
- The Sentry `Analytics` layer (`src/services/analytics/sentry.ts`) is provider-agnostic (track / identify / page / reset). A `NoopAnalyticsLayer` is used when Sentry is disabled (e.g. local dev with no DSN).
- `ErrorBoundary` reports caught exceptions with the component stack to Sentry.

---

## 12. Global UX

- `OfflineBanner` — appears when `navigator.onLine` flips to `false`.
- `VerifyEmailBanner` — sticky banner on top for unverified accounts; 30s resend cooldown.
- `WelcomeModal` — shown once after sign-up; persists in `useOnboardingStore`.
- `AuthPromptDialog` — `Dialog` triggered by `useAuthGuard` when an unauthenticated user taps a guarded action.
- `FloatingMenu` (`src/components/Layout/FloatingMenu/index.tsx`) — a 56px circular menu button in the bottom-right, opening a fullscreen overlay with roving-grid keyboard navigation (arrow keys + `Mod+K` to toggle). The overlay shows a `NowPlayingMini` (if audio is active) plus categorized tiles: Browse, Create, Account. Tiles are filtered by `canSeeNavItem` so admin/create tiles only appear for the right role.
- `Toaster` — global toast surface (success/error), called from all auth/upload/action flows.
- Keyboard hotkeys are summarised in the audio section above.

---

## 13. Data hooks cheat sheet

`src/lib/http.ts` is the single source of truth for typed REST hooks. Highlights:

- Content: `useAudioByType`, `useAudioBySlug`, `useAudioTags`, `useEditorialPosts`, `useMicroPosts`, `useEditorialPostBySlug`, `useMicroPostBySlug`, `useAllLabels`, `useLabelBySlug`, `useReleasesByLabel`, `useReleaseBySlug`, `useAllShows`, `useShowBySlug`, `useShowById`, `useShowEpisodes`.
- User: `useUserLOL`, `useUpdateProfile`, `useAdminUserSocialLinks`, `useReplaceAdminUserSocialLinks`, `useUpdateAdminUserBio`, `useAdminUserBio`, `useEmailPreferences`, `useUpdateEmailPreferences`.
- Engagement: `useFavorites`, `useAddFavorite`, `useRemoveFavorite`, `useAddShowFavorite`, `useRemoveShowFavorite`, `useUserSubscriptions`, `useSubscribeToShow`, `useUnsubscribeFromShow`.
- Profiles & DJs: `useDjs`, `usePublicProfile`, `useResolveSlug`.
- Spotify: `useSpotifyProxy` (album/track/playlist), `useEnrichTrackFromUrl`, `useResolveMusicEntity`.
- Admin: `useAdminOverview`, `useAdminEmailLogs`, `useAdminNewsletterSubscribers`, plus the music-entity CRUD hooks for artists, albums, tracks, links, and artist↔album / artist↔track associations.
- Communication: `useSendMixNotification`, `useNewsletterSubscribe`, `useNewsletterUnsubscribe`, `useRequestNewsletterUnsubscribe`, `useMixQRPdf`, `useShowQRPdf`.

Query keys are centralized in `src/lib/http-query-keys.ts` so invalidations stay consistent.

---

## 14. Utilities worth knowing

- `cn(...)` — `twMerge + clsx`.
- `formatSeconds` — `mm:ss` or `h:mm:ss` for the player.
- `attachVolumeScroll` — exponential wheel-to-volume on any element.
- `useCooldown(seconds)` — for resend/throttle buttons.
- `useIntersectionObserver` / `LoadMoreTrigger` — infinite scroll.
- `useHorizontalScroll` — wires a Radix `ScrollArea` viewport to prev/next chevrons.
- `useOnlineStatus` — drives both the offline banner and the auto-pause of resumable uploads.
- `getShareUrl(type, slug)` — canonical `/s/{type}/{slug}` URLs used by every `ShareButton` and `MixMenu`.
- `useFeaturedMix` — single query used by the homepage hero.
- `useMixRecencyLabel` (from `@gbfm/core/utils`) — `new` / recent labels for the `MixListItem` and `EditorialListItem` chips.

---

## 15. What is intentionally not in the app

- No built-in comments, likes, or social features beyond favorites + subscriptions.
- No client-side analytics beyond Sentry breadcrumbs. The Effect `Analytics` service is wired but the app only emits events around audio play/pause/seek/queue.
- The admin SPA is route-first, not tab-first: every admin feature is its own URL (`/admin/users`, `/admin/content`, etc.) so the tools are deep-linkable.
- Theme is intentionally minimal: a single dark accent (`--highlight`) with `pastel-green` as a secondary, no separate "branded" sub-themes besides the `studio` palette token in `@gbfm/theme`.
- Most of the heavy state lives in the VPS — the SPA is a thin read/write client over a small REST surface.

---

## 16. File map (one-line each)

- `src/main.tsx` — React + Sentry + QueryClient + Theme bootstrap, mounts the router.
- `src/routes/` — file-based routes (see surface map).
- `src/components/` — UI atoms and feature blocks (player, queue, dashboard, profile, shows, mix-uploader, auth, layout, common).
- `src/store/` — Zustand stores (`audioPlayer`, `ui`, `onboarding`, `content`, `authPrompt`).
- `src/services/` — Effect service layers + pure workflow (audio-player, analytics, resumable-upload, mix-upload-draft).
- `src/runtime/` — builds the merged Effect layer and exposes `RuntimeClient.runPromise`.
- `src/hooks/` — React hooks (audio init, hotkeys, resumable upload, mix play tracking, draft autosave, online status, horizontal scroll, intersection observer, file upload).
- `src/lib/` — `http.ts` (REST hooks), `http-client.ts` (fetcher + failure reporting), `http-pagination.ts`, `http-query-keys.ts`, `http-url.ts`, `auth-client.ts` (better-auth), `auth-permissions.ts` (roles), `seo.ts`, `share.ts`, `spotify-pkce.ts`, `cookies.ts`, `response.ts`, `constants.ts`, `utils.ts`, plus small composables (`useCooldown`, `useFeaturedMix`, etc.).
- `src/styles/` — `main.css` (Tailwind v4 + tokens), `fonts.css`, `scrollbar.css`.
- `src/mdx/` — landing copy.
- `src/types/` — `auth.ts`, `index.ts` (Spotify-shape types).
- `plugins/` — Vite plugins for repo changelog and theme color injection.

---

## 17. Scripts

From `package.json`:

- `bun dev` — Vite dev server, proxies to VPS at `127.0.0.1:3003`.
- `bun run build` — production build.
- `bun run preview` — preview the build.
- `bun run bio` — `oxlint ./src --fix && oxfmt ./src --write`.
- `bun run typecheck` — `tsgo --noEmit`.
- `bun run test` — Playwright E2E (mobile Chrome).
- `bun run test:unit` / `bun run test:unit:watch` — Vitest.
- `bun run test:ui` — Playwright with the UI runner.

`bun precommit` runs typecheck, oxlint, and oxfmt.
