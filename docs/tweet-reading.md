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

## Mobile handoff

Mobile reader and pager files were already being edited by another agent during this work. They were inspected but not changed, staged, committed, built or installed by this task. The following observations describe that in-progress working tree, not a verified mobile release:

- `apps/mobile/src/tweets/readerPosition.ts` already writes a per-account position to persistent device files through `store/localStorage.ts`.
- `useReadingProgress.ts` saves as reading progresses; `useTweetReader.ts` and `TweetPager.tsx` read the saved position.
- Align the pager with the rules above: show a visible Latest/newer-unread affordance with a temporary return point, and refresh discovery on foreground return.
- The pager currently searches at most 300 loaded tweets for its resume target. Review the fallback: an unfound or failed target must not silently jump to the beginning and overwrite the saved place.
- Review account changes while the pager remains mounted: its initially captured resume target must not carry across identities.
- Verify force-close/relaunch, signed-out versus signed-in positions, deleted targets, offline restore, incoming links, newer posts and return-to-place on the physical iPhone before handing off mobile changes.
