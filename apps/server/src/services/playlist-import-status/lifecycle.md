# Specialized lifecycle — not activated

This layer depends on PR595's corrected helper head42632b1, on the exact named
b1b3345 prerequisite. It introduces no schema, second ledger, raw provider data,
queue send, scheduler, runtime registration or provider admission.

`playlistImportAcceptanceStatement({ ctx, authority })` attaches generation1
importing state to the same pending common receipt, using SQL database time for
its 60-second lease. The accepting caller must include the physical status marker
in its final assertion. This is acceptance only, never imported/created success.
The fixture exercises a controlled admitted source, not an external provider.

`makePlaylistImportStatusService` requires Database and request-scoped P1
CommandAuthority. Every call checks catalogue-write authority; SQL includes the
fresh guard and immutable trusted actor/client/resource tuple; disclosure checks
authority again. Mutations additionally require expected status revision and an
existing complete/expired common receipt. Receipt TTL does not cancel inflight
work. No browser or PAT OAuth rows are fabricated, and current PAT catalogue
capabilities are not extended.

- `renew` checks the exact UUID/generation/phase and DB-time lease, never reviving
  an expired worker. Callers should renew on the agreed 20-second cadence.
- `enqueueEnrichment` requires a live importing lease, complete successful actual
  import counters and the pinned playlist revision. Enrichment total stays
  unknown until an actual pinned work snapshot exists.
- `noteDispatchAttempt` leaves the outbox pending and advances the retry time by
  60seconds before the send. `acknowledgeDispatch` is called only after a real
  successful queue send. Neither operation means enrichment completed.
- `acquireEnrichment` accepts delivery before the dispatch acknowledgment, or an
  expired enrichment worker. It CASes the generation and pinned parent revision,
  preserving committed cursor and outcomes on takeover. It never takes over an
  importing operation.
- `interruptExpiredImport` records ambiguity without inventing a failed item.
- `pruneTerminal` clears terminal target references only after receipt TTL, and
  preserves safe aggregate outcomes. It never prunes an inflight worker.

P1 still owns real queue/scheduler composition and durable worker authority.
Workers without reconstructible genuine authority must fail before providers.
Per-item progress/cursor/terminal outcomes must join guarded canonical persistence;
that seam is NOT implemented by a standalone progress setter here. PL2 still
owns parent deletion and consumes PR595 only after P1 names serial adoption.
