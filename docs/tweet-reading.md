# Tweet reading: resume and discovery

## Navigation rules for both platforms

- Opening Tweets resumes the last successfully displayed tweet for the current account on that device. Signed-out reading has its own position. A first visit opens Latest.
- Save progress when a tweet is actually displayed, not when it is prefetched. Save during reading, not only when the app closes, because a force-close may never run cleanup.
- A direct tweet link opens that tweet, regardless of the saved position. Back navigation retains its normal meaning.
- A deleted automatic resume target falls back to Latest. A network failure must retain the saved target. Do not turn a failed restore into a successful visit to the first feed item.
- Newer unread tweets are discoverable without moving the reader automatically. Older unread archive posts are not labelled as newly published posts. Do not invent a “new since last visit” count from the total unread count.
- Latest is an explicit action. Within the current reading session, provide **Back to where I was** after that jump. The durable resume position still follows the last successfully displayed tweet.
- Refresh discovery metadata when the app returns to the foreground. Shared reading history can span devices; the last-viewed position is local, not a cross-device bookmark sync feature.

## Web implementation

`apps/www/src/page/tweet/position.ts` stores a validated slug in `localStorage` under `gbfm:tweet-checkpoint:<encoded-account-id>`. Storage denial degrades to in-memory progress and Latest on a fresh session. The former tab-only `sessionStorage` checkpoint was not durable.

The reader already had chronological navigation, next unread, Latest, random unread, month navigation, reading-history writes and missing-checkpoint fallback. The resume change retains those behaviors while separating accounts. A visible **Newer unread tweets available** notice offers **View latest**. The earlier position is retained in memory during that visit, not advertised as a permanent saved bookmark. Focus, visibility and page-show events refresh neighbours without replacing the current tweet.

## Mobile implementation

`apps/mobile/src/tweets/readerPosition.ts` stores a position per account in persistent device files through `store/localStorage.ts`. `useReadingProgress.ts` saves settled pager posts; the thread reader saves successful visits. Prefetching does not change that position.

The pager loads the saved tweet directly through `loadReaderEntry`, without scanning an arbitrary number of archive pages. Only a confirmed missing saved tweet falls back to Latest. Network, server and decoding failures leave the bookmark untouched and offer Retry. Direct thread links use `loadReaderPost`, which does not apply the automatic fallback.

`useAnchoredFeed.ts` continues towards older tweets through chronological neighbours. This trades bulk offset pagination for loading from any saved position immediately, without changing the server API. Older posts load ahead of the visible page and retain a separate retryable footer on failure.

The reading session is keyed by account, so its captured target, feed and temporary return point cannot cross an account change. Returning from another screen checks whether that screen changed the saved position. Both the pager and thread reader show Latest, a newer-unread notice when authoritative navigation reports one, and **Back to where I was** after a Latest jump. A successful return clears the temporary point; failed navigation does not.

`useReaderDiscovery.ts` refreshes neighbours on screen focus and foreground return. Discovery does not replace the displayed tweet or turn total unread history into a newly published count. Account-scoped reading positions remain local to the device.

### Verification

- Mobile API seam tests cover direct old-tweet restore, deleted automatic targets versus direct links, failure without Latest fallback, chronological paging, exhaustion and failures, and prefetch without seen writes.
- Reader-state tests cover return points across repeated Latest jumps, failures, stale results and successful return.
- The implementation passed 114 mobile tests and `bun precommit` before the interrupted device handoff.
- Final physical iPhone installation and navigation checks remain unverified. The first build process completed, but its log was lost during a server restart and its bundle preceded the final source changes. On resuming, the iPhone was unavailable and `origin/prod` contained newer overlapping reader work. Reconcile that work and build the final source before installing; do not replace a newer installed app with this older snapshot.
