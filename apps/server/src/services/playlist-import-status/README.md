# Playlist import status composition

This layer consumes schema0025 on P1's named `b1b3345` prerequisite. It does not
start imports, admit a provider, create receipts, enqueue work, or wire a worker.

`playlistImportRetirementStatements({ playlistId, ctx, parentWinner, liveGuard,
now })` returns prepared statements only. PL2 must put them after its playlist CAS
and before parent DELETE in the **same** common-operation batch. `parentWinner`
must prove the playlist marker equals `ctx.attemptId`; the receipt fence alone
does not prove the playlist CAS won. The final delete assertion must require live
authority, the physical command winner, parent deletion, and no status still
referencing the deleted playlist. There is deliberately no playlist FK or
standalone retirement call.

Retirement applies across all namespaces attached to the deleted playlist. It
sets `phase=retired`, timestamps and the physical marker; increments revision;
clears target/revision, cursor, worker attempt/lease and dispatch timestamps; and
sets dispatch to `none`. Safe aggregate counts, generation and dispatch attempts
remain. Revision exhaustion must fail the entire coupled batch, never be filtered
out as a skipped status.

`playlistImportWorkerFence({ operationId, namespace, attemptId, generation,
phase })` returns SQL checking the trusted actor/client/resource tuple, UUID,
generation, worker phase and an unexpired **database-current-time** lease. It is
ownership evidence, not authorization. Every worker mutation must additionally
include fresh live SQL authority, its operation fence, status revision CAS and
any target revision/physical winner needed by that mutation. It cannot fence
remote provider effects or replace transport admission.

The migrated-D1 tests exercise these statements inside the real common receipt
store: concurrent retry/lost-response replay, changed payload conflict, authority
revocation after lookup, stale/wrong parent winners, missing receipt fence,
cross-namespace whole-batch capacity rollback, and stale/expired worker fencing.
The test delete plan is a controlled composition seam, **not** PL2's eventual
service integration or production-provider proof.
