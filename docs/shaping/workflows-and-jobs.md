# Workflows and jobs in Goosebumps

Status: discussion draft; candidate work tracked in GitHub issues
Scope: `apps/server`

The Bluesky integration discussed in the original draft was removed in
[#347](https://github.com/planetaryescape/gbfm/pull/347). Its remaining provenance
cleanup and preserved-storage boundary are documented in
[Bluesky retirement](../operations/bluesky-retirement.md).

## The distinction

A **job** is a unit of work that can run outside an HTTP request, such as delivering one reminder or resolving one batch of tracks. A **workflow** is the longer-lived process those jobs serve, such as importing an account or playlist. A workflow may need durable progress, retries, and a way for a user to see its outcome. A scheduled trigger is neither by itself: it can discover work and start jobs or workflows.

The useful question is not “what can run in the background?” but “what work must survive a timeout, interruption, duplicate delivery, or external provider failure?” Moving work to a queue does not, by itself, solve those problems.

Adam Rankin's [saved Jobs vs. Workflows post](https://read.readwise.io/later/read/01m32drv0n6h10hg4bs3yz6pjm) suggests **jobs** for deferred work and fan-out across many items, and **workflows** for business processes that branch, wait, and carry state over time. That fits this server: sending reminders and enriching a set of tracks are job-shaped; an import that waits for a user's choice or resumes across several phases could be workflow-shaped. A multi-page sync is not automatically a workflow-engine problem. Effect Cluster, effect-mq, Cloudflare Queues, and Cloudflare Workflows are implementation choices after the behavior is clear, not synonyms for these concepts. The supplied X link could not be verified independently; the Readwise item is the source used here.

## What the server already does

| Area | Current shape | Workflow relevance |
| --- | --- | --- |
| Music reminders | A minute cron finds due reminders, enqueues IDs, then a queue consumer claims and sends each reminder. Failed messages are retried. | An existing example of scheduled discovery plus individual jobs. |
| Music identity resolution | Entity resolution has claim leases and retry-aware handling of concurrent resolution. Spotify import resolution also uses a Durable Object. | A concurrency-sensitive process, but not evidence that every resolution needs a separate workflow run. |
| Spotify playlist import and enrichment | Import fetches a playlist, resolves tracks, and updates membership in the request path; subsequent link enrichment is detached. Manual link sync is detached too. | The import has a meaningful result today; enrichment is best-effort, not a durable queued job. |
| Sitemap and maintenance | Hourly sitemap regeneration and maintenance are cron-triggered. Maintenance includes navigation retention and QR PDF cleanup. | Scheduled jobs are adequate until they need independent progress or recovery. |

Sources: [`scheduled.ts`](../../apps/server/src/scheduled.ts), [`worker.ts`](../../apps/server/src/worker.ts), [`reminder-queue.ts`](../../apps/server/src/services/reminder-queue.ts), [`reminder-processor.ts`](../../apps/server/src/services/reminder-processor.ts), [`playlist-tracks.service.ts`](../../apps/server/src/services/music-entity/playlist-tracks.service.ts), [`canonical-music-identity`](../../apps/server/src/services/canonical-music-identity), [`spotify-import-resolver.do.ts`](../../apps/server/src/durable-objects/spotify-import-resolver.do.ts).

## Interface and implementation: where to put the seam

Your concern is valid, but a service having one production Layer does not mean its interface is one-to-one with its implementation. The question is what its **caller** must know. The external interface should describe an outcome in Goosebumps terms; the implementation should own the sequencing, retries, and platform mechanics. Separate, narrower interfaces are useful where a real adapter varies, for example the Worker versus a local runtime, a provider versus a test substitute, or a queue versus a test sender. `Layer` composes those adapters; it does not itself make a pass-through interface deep.

| Existing interface | Assessment | Suggested direction |
| --- | --- | --- |
| `ReminderQueue.enqueue(ReminderJob)` | A real, narrow seam between reminder scheduling and Cloudflare Queues. The message uses a stable reminder ID. | Keep it. Name its guarantee precisely: accepted by the queue is not delivered to the user. Do not create a generic `JobQueue` for unrelated features yet. |
| `MusicEntityService.importSpotifyPlaylist` | A domain-shaped result and substantial implementation. It currently imports all tracks in the request path and detaches link enrichment. | Keep synchronous import if it meets latency needs. If it must be backgrounded, expose `requestPlaylistImport` with a run handle and a separate read-side status. Do not expose `fetchPage`, `resolveTrack`, or `advanceCursor` merely because the implementation uses them. |
| `CanonicalMusicIdentityService` | Real depth: claims, lookup, scraping, and reconciliation are hidden. Some parameters and methods expose mechanism (`importProviderEntityLazy` accepts an Effect to load a snapshot; `enrichEntity` and `refreshEntity` need caller knowledge). | Keep the capability; assess whether the lazy import operation can be internal to playlist import while preserving the necessary provider-call optimization. Do not rewrite the whole interface just to make it look uniform. |
| `SpotifyImportResolver` | `resolveTrack`/`resolvePlaylist` describe resolution, with a local serializing Layer and a Worker Durable Object adapter. The seam has real runtime variation. | Keep as coordination adapter while needed; do not add a second generic job interface around it. |
| `EmailDelivery.deliver` | Owns a provider-neutral delivery attempt, receipt, and failure log. | Keep delivery as one attempt. A future notification job can call it; the transport should not own reminder scheduling or notification policy. |

An illustrative interface for **playlist link enrichment**, if durable progress is needed:

```ts
interface PlaylistEnrichment {
  readonly request: (playlistId: string) => Effect.Effect<EnrichmentHandle, RequestError>
}

interface PlaylistEnrichmentRunner {
  readonly run: (runId: string) => Effect.Effect<EnrichmentSummary, EnrichmentError>
}
```

The request module would authorize the operation, create or reuse an enrichment run, and arrange durable delivery. The runner would load its targets and process bounded batches with `CanonicalMusicIdentity`. HTTP only calls `request`; a queue consumer only calls `run`. These are **two distinct authorities**, not an interface and its mechanical copy. The exact errors and delivery guarantee need design before implementation. D1 commit plus queue send is not atomic; if acceptance must guarantee eventual execution, explicitly choose a recovery sweep or outbox-like mechanism instead of assuming a queue call closes the gap.

For **playlist enrichment**, a smaller first step is enough: after the playlist is saved, request link enrichment for a `playlistId`; a worker reloads the targets and processes a bounded batch. Keep the existing `CanonicalMusicIdentity` behavior inside the runner. If enrichment is intentionally best-effort, describe it that way and do not claim the response means work was queued. Only add a user-visible import run if the whole import itself needs durable progress.

The **Layer shape** should reflect these ownership choices: application modules own the behavior-shaped contract and sequencing; a queue adapter translates an accepted domain command to a Cloudflare message; `worker.ts` binds the queue and wires Layers. Tests can substitute the dispatch adapter or exercise real D1 and queue boundaries. Keep raw `Queue`, `D1Database`, and `ExecutionContext` out of application contracts. Pure scheduling calculations (such as backoff) remain pure functions, not injectable services. Use existing Effect services for time where its value affects observable policy.

## Where it might help next

These are candidates to assess, not a commitment to build them.

| Candidate | Why consider jobs or a workflow? | Start only when... |
| --- | --- | --- |
| Spotify playlist import and track resolution | A playlist fans out into many provider calls and identity resolutions. One bad track should not necessarily fail the whole import. | Real imports exceed request limits or users need an import status and partial-failure report. [#342](https://github.com/guidefari/gbfm/issues/342); existing UI progress request [#200](https://github.com/guidefari/gbfm/issues/200). |
| Music metadata and link refresh | External links can go stale; refreshes can be deferred and rate-limited. | There is evidence that stale links are a user problem, and refreshes can preserve known-good data on failure. [#341](https://github.com/guidefari/gbfm/issues/341); existing metadata review proposal [#89](https://github.com/guidefari/gbfm/issues/89). |
| Downloadable user exports | Building a large file can outlive an HTTP request and may need temporary storage and expiry. | A useful export is defined and proves too large for one request. [#344](https://github.com/guidefari/gbfm/issues/344). |
| More email or notification delivery | Individual sends benefit from retries and delivery records. | A concrete notification feature needs it; reuse the reminder and email-delivery patterns before generalizing them. [#340](https://github.com/guidefari/gbfm/issues/340). |
| Search reindexing or data audits | A broad rebuild or audit may need bounded batches and checkpoints. | An operational run is too large for one invocation or must resume after interruption. [#343](https://github.com/guidefari/gbfm/issues/343). |

Keep cheap, immediate actions such as saving a favorite, editing a post, or reading a feed in the request path. A queue adds delayed results and the need to represent pending and failed states.

## Suggested first decision

With the Bluesky integration removed, playlist link enrichment [#342](https://github.com/guidefari/gbfm/issues/342) is the next concrete candidate. Describe its trigger, expected duration, user-visible result, failure modes, retry policy, and whether it needs cancellation. Then decide whether the current D1 state plus Cloudflare Cron/Queues/Durable Objects is enough. The immediate correctness question is what the HTTP response promises when it says `queuedTrackCount`.

Avoid a generic `workflow_run` table or shared job union before that decision. A queue message should carry stable identifiers rather than a full mutable snapshot; processing should be safe under duplicate delivery; any multi-step process should checkpoint progress at a meaningful boundary. Those are design requirements to validate per feature, not proof that a workflow framework is needed.

## Questions for the next iteration

1. Which user action is currently slow, times out, or leaves an unclear result?
2. Should partial success be visible, especially for imports with individual failed tracks or posts?
3. What should a user be able to retry or cancel?
4. Is one-minute reminder granularity acceptable, and are there actual delivery failures that need attention?
5. For playlist link enrichment, should the user see progress and retry failures, or is best-effort work enough?
