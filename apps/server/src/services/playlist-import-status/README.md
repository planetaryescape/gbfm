# Playlist import status (#200)

The optional `PlaylistExecutionHooks` in `music-entity/playlist-tracks.service.ts`
report actual item outcomes. `checkpoint` is a lazy Effect that must recheck
current authority on every execution; it is not a cached grant. `progress`
receives phase, processed, nullable total and failed count. Provider-item failure
advances processed/failed and still fails the aggregate; authority or status-write
failure stops later work. Unknown total is null, not zero. No hook reports queue
acceptance, durable completion or safe mutation replay.

The old untracked callers retain their signatures and results. No membership,
revision or URL-add SQL was changed for these hooks. Checkpoints do not close the
SQL-time authority gap or guard the existing canonical provider writes. PL2 owns
the future pinned, bounded membership snapshot/CAS; P1 owns executable authority
and central queue/scheduler composition. These hooks are not wired into runtime
status or MCP registration.

## Approved storage direction; implementation still pending

The sole schema owner has allocated 0025 after reviewed 0024; this lane edits no
DDL, migration list or exports. The proposed specialized status/outbox row has
the same common operationId FK, actor CASCADE and trusted client/resource strings,
not another receipt ledger. Session namespace is `gbfm:session`, PAT namespace
`gbfm:pat:${persistedKeyId}` only on existing supported handlers; both use the
configured `/api` resource. Do not manufacture OAuth rows.

Phases: importing, enrichment_pending, enriching, completed, partial, failed,
interrupted, retired. Distinct import/enrichment counters reflect real outcomes;
completed requires known exhausted totals and no failures. Partial requires a
successful completed import and an actual enrichment failure. Interrupted records
an ambiguous/lost attempt, not invented failed items or completion.

Target ID/revision and cursor position/track ID are each all-or-none. Terminal
rows have no cursor, active lease or pending dispatch. Partial's scalar aggregate
proof survives target pruning; there is no artificial pruned flag. Pending
dispatch has a due timestamp, sent has an acceptance timestamp, none has neither.
Queue acceptance never means work completed. Delivery can duplicate; a worker
must acquire a physical UUID/generation/unexpired DB-time fence before work.

Initial importing lease: 60 seconds, renew every 20 seconds, same original attempt
only, no takeover or automatic catalogue reexecution. Expiry becomes interrupted.
Enrichment lease: acquire enrichment_pending → enriching, renew every 20 seconds,
take over only after expiry with a new UUID/generation. Every progress/transition
needs fresh authority and the lease fence. Target paging is bounded to 100 and
pinned to PL2's playlist revision; do not silently rebase a changed playlist.

No raw provider URL, token or provider snapshot is stored. Receipt result TTL
does not expire active work. Terminal pruning clears resumable target/cursor/
lease data while retaining safe aggregates under the common tombstone policy.
Guarded playlist deletion must retire matching statuses, cancel dispatch and
clear resumable data in the SAME parent physical-winner transaction before
DELETE; a standalone pre-delete update or fictional FK cascade is unsafe.

The status-retirement statement helper, job/outbox service and real migrated-D1
proof remain pending the schema owner's exact physical-field handoff and P1's
named combined prerequisite. No existing queue log or enqueue:void result is
treated as persisted status, and no new worker or scheduler is activated here.
