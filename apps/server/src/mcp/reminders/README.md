# Reminder MCP lane (#538)

Partial delivery on P1 #548, exact prerequisite
`2d1b5592826e66e3a198dc117c153e062264fc5c`. No production registration,
OAuth policy, schema or scheduler changes are included. #538 stays open.

## Capability mapping

| Selected capability | Scope | Delivery |
| --- | --- | --- |
| `list_music_reminders` | `reminders:read` | Owner-only summary page; default 20, max 50, offset 0–10,000, UTC dates, date/ID order, sentinel `hasMore`, 64 KiB result-payload budget. Listener accounts eligible; admin cannot read others. |
| `create_music_reminder` | `reminders:write` | Withheld pending durable create identity and atomic receipt/mutation. Not a registered placeholder. |
| `reschedule_music_reminder` | `reminders:write` | Withheld pending expected-revision CAS, durable replay and send arbitration. |
| `cancel_music_reminder` | `reminders:write` | Withheld pending expected-revision CAS, cancellation tombstone/replay and send arbitration. |

Writes must derive recipient from the actor; never accept an arbitrary recipient.
Read authority is independent of write authority. Future UTC input should accept
an explicit RFC 3339 UTC `Z` instant, reject local/offsetless dates and invalid
calendar values, and normalize to a millisecond UTC instant before hashing.
Reschedule/cancel require current command revision; missing →
`precondition_required`, stale → `conflict`, hidden/other-owner → `not_found`.
Do not pretend the current processor claim generation is a command revision.
The read summary intentionally has no writable version until that seam exists.
Offset pages are not snapshots during concurrent changes. Notes, URLs, recipients,
owner IDs and provider internals are not projected.

The inner 64 KiB UTF-8 JSON result budget is separate from P1's final 256 KiB
transport cap. MCP sends the result twice, once as structured content and once
as escaped text; at most three times the result bytes plus small fixed framing
fits below the outer cap. Oversized pages return typed `unavailable` with a
smaller-page instruction rather than reaching the outer untyped HTTP 413.

## P1 composition recipe

- Import `ReminderToolkit` and `ReminderToolHandlersLayer` from `./toolkit`.
- Import `ReminderReadServiceLayer` from `./reads`.
- Provide `MusicReminderServiceLayer` from the existing reminder service, backed
  by `Database`. The read layer supplies `McpAuthorizationLive`, also needing
  `Database`. `McpActor` remains request-local and belongs to P1's transport.
- Compose the toolkit with `composeMcpToolkits` and provide the handler/read
  layers. Central registry, OAuth, consent and persisted-grant fixtures stay P1.
- `protocol.d1.test.ts` uses persisted OAuth and the real `makeMcpRoutes` path
  with lane-local composition: discovery names/hints/private-field exclusion,
  owner-only reads, write-only denial, and escape-heavy multibyte results near
  and above the inner budget. Shared fixtures and production policy are unchanged.
  P1 must still prove final combined registration/discovery/revocation at its
  integration head before activation.

## Consolidated persistence gate: evidence and required decision

Five deterministic probes ran against real migrated disposable D1 on 2026-11-07,
using the existing writers at exact P1 base above and recording-only
`EmailDelivery`. Reproducible code is retained in `storage-gates.repro.ts`,
excluded from normal tests because its assertions describe current failures,
not a contract that unsafe behavior must preserve. No notification or remote
provider was invoked. Reproduce from the repository root (temporary test removed
on exit):

```sh
probe=apps/server/src/mcp/reminders/storage-gates-probe.d1.test.ts
test ! -e "$probe" || exit 1
trap 'rm -f "$probe"' EXIT
cp apps/server/src/mcp/reminders/storage-gates.repro.ts "$probe"
bun run --filter @gbfm/server test:d1 src/mcp/reminders/storage-gates-probe.d1.test.ts --reporter=verbose
```

1. Two concurrent same-payload creates returned distinct IDs and persisted two rows.
2. Pause a stale reschedule just before SQL UPDATE (after owner read), commit a
   newer schedule, then release: stale request overwrites the newer schedule.
3. The same barrier before DELETE: stale cancellation deletes the newer schedule.
4. Pause **after** the processor's final eligibility SELECT but before delivery,
   complete reschedule to the future, then release: one old delivery occurs;
   stale terminal update cannot overwrite the new pending schedule.
5. Same final-read barrier, then cancel: one old delivery occurs after deletion.

The existing reschedule/recovery tests also cover edits before the final check,
stale claim suppression, recovery at the new due time and terminal generation
ownership. These are inherited behavior, not proof of safe MCP writes.

P1 must consolidate the following with other lanes; these paths/guards are
**REQUESTED, not reserved, approved or allocated a migration/ledger**:

- Durable unique key `(actor, client, operation, requestId)`; UUIDv4 request IDs.
  Canonical payload hash includes target, expected command revision, normalized
  UTC instant and null/omitted distinctions. Same key+hash replays the original
  result; changed payload conflicts; concurrent retries apply once.
- Store stable created reminder identity and saved outcome atomically with the
  mutation. Recheck current authorization and owner before replay/status lookup.
  Replay lifetime is 24 hours. Expired keys never execute again: retain a small
  tombstone after pruning response bodies, including after reminder cancellation.
  Account deletion/privacy retention must be decided centrally. Post-bound
  `editorial_operations`/draft-store is not generic reminder receipt storage.
- Independent monotonic command revision, or an equally sound approved guard,
  across **all** reminder writers. Atomic mutation predicates must include
  owner + ID + expected revision + legal unsent state. Current `updatedAt` is
  also a claim generation and is deliberately unchanged for some processing
  edits, so it is not a general edit revision.
- Persisted send fence/state arbitrates mutation against claim-to-send. A cancel
  winning before the fence suppresses pending delivery; after it, return an
  honest in-flight/not-recalled outcome. A final SELECT alone does not close the
  race. Reserve service/processor/shared-writer methods through P1 before edits.
- Reuse existing queue/sweeper recovery. No second scheduler. Provider acceptance
  cannot be atomic with terminal D1 commit: the existing at-least-once duplicate
  window remains. Cancelling pending work never promises recall of accepted mail.

After approval, write tests must cover request replay/hash conflicts/expiry and
restart, version conflicts, other owners, and both sides of the send fence on
real migrated D1. No production scheduling or real sends without separate approval.

## Recommended revision/fence candidate (REQUESTED only)

Add exactly two columns to `music_reminder`, not a second scheduler or reminder
ledger. This is a candidate for the migration coordinator, not tracked schema:

| Column | SQLite type/default | Constraint |
| --- | --- | --- |
| `command_revision` | INTEGER NOT NULL DEFAULT 1 | `typeof(command_revision) = 'integer' AND command_revision BETWEEN 1 AND 9007199254740991` |
| `dispatch_state` | TEXT NOT NULL DEFAULT 'open' | `dispatch_state IN ('open','fenced','accepted','cancelled')` |

Keep the existing four-value `status` and `is_sent` for processor compatibility;
`dispatch_state` is authoritative for mutability and suppression. Cancel keeps
a row/tombstone (`dispatch_state='cancelled'`, unsent, legacy status `pending`),
not a physical delete. Read/API/admin projections must show/exclude cancellation
explicitly, never report that row as an active pending schedule. Historical sent
rows must be initialized to `accepted` by the coordinator; the default is only
for newly created rows. Conservative historical classification recommendation:

- `is_sent=1 AND status='sent'` → `accepted`, no further sends or schedule edits.
- `is_sent=0 AND status IN ('pending','processing','failed')` → `fenced`, never
  `open`: even a pending row may have been rescheduled after an earlier dispatch.
  No existing durable negative evidence proves that no provider attempt began.
  This deliberately denies later cancel/reschedule on historical unsent rows;
  existing recovery can still deliver their current schedule at least once.
- With this proposed classification, the dashboard's DELETE returns HTTP 409
  for **every existing reminder**, including future reminders never processed:
  sent rows are `accepted`, and all historical unsent rows are `fenced`. This is
  an owner-gated loss of deletion, not a shipped behavior change.
- Inconsistent sent/status combinations or unknown states → stop that migration
  decision for those rows and require explicit classification, not silent repair.

That conservative loss of historical editability needs owner approval. An
alternative that claims those rows are safely cancellable needs new evidence,
not a heuristic based on timestamps or absent delivery logs. No production data
is inspected or migrated here; previously deleted rows cannot be reconstructed.

- **Create:** revision 1, state `open`; receipt and row insertion commit together.
- **Edit/reschedule while open:** SQL predicates include actor owner, ID,
  expected revision, state `open`, unsent, legal status, revision below max.
  Increment revision even if the user repeats the same desired date with a new
  command. Invalidate old preparation claims using the existing generation;
  any claim must carry its observed command revision too. A replay does not
  increment again. Overflow fails closed as conflict.
- **Cancel wins:** same predicates; increment revision and set `cancelled` in
  the same atomic mutation/receipt transaction. No future claim may deliver it.
- **Dispatch wins:** immediately before `EmailDelivery.deliver`, atomically
  change `open → fenced` using ID + owned processing claim generation + observed
  command revision + unsent/due predicates. Only the winner may attempt delivery.
  Keep `fenced` sticky across failed/unknown outcomes and stale-claim recovery;
  recovery can claim a new attempt but must not reopen user mutation. Reschedule
  and cancel after this fence return `conflict` with a truthful
  `delivery_may_have_started` outcome, not guaranteed suppression or recall.
- **Accepted:** terminal guarded update sets `accepted`, `status='sent'`,
  `is_sent=1`. Do not increment command revision for processor claim/recovery/
  terminal updates. Stale workers cannot overwrite newer generations.
- **Crash:** a fence can precede a crash before send, or provider acceptance can
  precede a crash before terminal persistence. The existing sweeper retries
  fenced attempts under a new owned claim; duplicates remain possible. This is
  at-least-once, never exactly-once, and `fenced` means *may have started*, not
  proof of acceptance. Retaining this conservative fence sacrifices later edit/
  cancellation convenience rather than lying about delivery suppression.

`guard-candidate.repro.ts` tests the revision/state SQL on a separate disposable
proof table in real migrated D1, without altering `music_reminder`: cancel-first
blocks the fence; fence-first blocks cancel and reschedule; revision change
blocks stale commands and old preparation; foreign owner fails; recovery changes
claim generation without resetting command revision/fence; invalid values fail
CHECK constraints. Run with the same copy/trap procedure using
`guard-candidate.repro.ts` instead. This proves SQL arbitration only, **not**
receipt durability, production integration or provider atomicity.

### Concrete integration paths requiring P1 reservations

- `apps/server/src/db/music-reminder.schema.ts`: two fields/checks. Migration
  allocation/replay/exports remain solely with the coordinator.
- `apps/server/src/services/music-reminder.service.ts`: `createEffect`,
  `updateEffect`, `deleteEffect`, interface/layer and both reads. Browser/PAT
  writers must increment revisions and respect the fence; MCP expected-version
  methods must use atomic CAS. Existing input compatibility does **not** prove
  stale-browser-intent rejection; see the explicit cutover request below.
- `apps/server/src/services/reminder-processor.ts`: `eligibleReminder`,
  `ownsClaim`, `claimReminderRow`, `deliverReminderEmail`,
  `sendClaimedReminder`, `queryDueReminders`, `queryNextDueReminder`,
  `getReminderStats`, `findReminderById`: exclude cancelled/accepted; carry
  revision in preparation; atomically fence; retain sticky fence on retry.
- `apps/server/src/worker.ts`: `enqueueDueReminders` and `processReminderMessage`
  continue using the same queries/processor; no extra scheduling mechanism.
- `apps/server/src/http/music-reminders.handlers.ts`: `toReminderResponse`,
  `createMusicReminder`, `updateMusicReminder`, `deleteMusicReminder`,
  `getMusicReminders`: truthful fence/conflict/cancelled outcomes and revisions.
- `packages/api/src/music-reminders.ts`: response revision/dispatch state,
  observed expected-revision/request-ID envelopes and typed precondition/conflict
  outcomes. This is a coordinated API contract change, not approved here.
- `apps/server/src/http/admin.handlers.ts`: `getAdminOverview` reminder counts must exclude
  cancelled rows from pending/due counts. Actual caller/client changes must be
  inventoried when this request is approved; none are reserved by this document.
- This lane's future MCP command handlers and the P1-owned consolidated receipts
  must use these same guards. Central registry/consent/auth remain P1.

### Caller inventory and observed-revision cutover request

At the pinned foundation plus this read-only lane:

- `packages/api/src/music-reminders.ts` POST/PUT/DELETE currently have no
  request key or expected revision. GET returns `updatedAt`, not a command revision.
- `apps/server/src/http/music-reminders.handlers.ts` derives the actor from
  `AuthSession`; PUT/DELETE call unconditional-version service methods. Their
  `AuthMiddlewareLive` (`apps/server/src/middleware/auth.impl.ts`) resolves
  cookie/bearer sessions through `auth.api.getSession`. No distinct reminder PAT
  route or repository PAT reminder caller was found; external callers are not
  inventoried by repository search and must be treated as unknown consumers.
- The only in-repo browser writer found is dashboard deletion:
  `apps/www/src/page/dashboard/document.ts` discards revision when mapping GET
  rows; `update.ts` `DeleteRequested` emits a DELETE with an empty body;
  `command.ts` `Write` sends it through `service.ts`. `section.ts` owns the GET
  endpoint. No in-repo web POST/PUT reminder caller was found.
- `apps/mobile/src/app/music-reminders.tsx` only opens the website. It has no
  direct reminder API writer; it inherits the browser's eventual cutover.

Recommend a coordinated, explicitly approved write-contract cutover before MCP
writes are enabled: GET/POST/PUT return `commandRevision`; POST requires a stable
UUIDv4 `requestId`; PUT and DELETE require `{ requestId, expectedRevision, ... }`,
where expectedRevision is the positive safe integer **observed by the caller**,
not obtained by a fresh server read. Use that value in the atomic SQL predicate.
Missing revision returns `precondition_required` (HTTP 428), stale revision or
post-fence state returns conflict (HTTP 409), without fetching a current version
and silently retrying the user's old intent. Retries reuse the original request
ID and payload. Refreshing and issuing a new command is an explicit user action.

The dashboard must retain each row's observed revision and bind it plus a stable
request ID into the delete command. API/PAT clients must fetch an observed
revision and send the same envelope; do not grandfather a versionless bypass.
This request changes existing write inputs and needs owner approval and caller
tests. If compatibility is retained instead, stale-browser/API intent safety
remains **unresolved**, even if an internal read/CAS fixes processor races. This
PR changes no browser inputs and claims no stale-form rejection.
