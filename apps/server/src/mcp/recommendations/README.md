# R2 catalogue recommendations (#535): first runtime slice

This slice implements **`find_similar_music` only** from the owner-reviewed P3
contract in PR #545. It does not close #535. Editorial connections and playlist
sequencing still need E1/PL1 on one named cumulative prerequisite. No placeholder
handlers for those capabilities are registered.

Input is `{seed:{entityType:artist|album|track,entityId},limit?:1..20}`; default 10.
The live grant is `catalogue:read`. Algorithm `catalogue_relations_v1` finds
catalogue-related music, **not sonic similarity**. Ranking is same album, shared
recorded artist, explicit music-label affiliation, then shared direct genre ID.
The lowest applicable tier wins; ties use opaque ID, then the lowest witness ID.
No album genre/label inheritance, playlist membership, saves, private listening,
provider fetches, models or writes are used.

Seeds, candidates and music witnesses must have non-null publication no later
than captured observation time. Genre labels qualify through eligible endpoints.
Missing/ineligible seeds return indistinguishable `not_found`; empty evidence
returns `insufficient_evidence`, no candidates, and applicable missing relation
kinds. Bounds are 50 seed edges per kind, 200 visible candidates plus a sentinel,
and 20 returned candidates. Candidate and seed-edge truncation are explicit.

Every candidate resolves local evidence IDs and receives a bounded explanation.
Typed locators identify relationship kind, entity type, endpoints and witness.
Fingerprints cover the relationship values actually used. Basis digests use the
canonical P0 keys `entityType`/`entityId`, include `result.status`, preserve array
order and exact Unicode, sort object keys by code point, and exclude observation
times, endpoint and explanation text. No hidden server-side suggestion handles
or approval/write token is created.

`MusicRecommendationToolkit`, `MusicRecommendationHandlersLayer` and
`MusicRecommendationServiceLayer` are independently composable. The service needs
`Database` and `EditorialMcpConfig`, and uses the bounded E2 evidence reader.
The E2 README documents physical-query limits and verification commands. P1 owns
central registration, persisted OAuth tests and the final composed test head.
The design leaf and all production publication/policy gates remain unchanged.
