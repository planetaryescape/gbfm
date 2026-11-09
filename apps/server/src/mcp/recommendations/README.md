# R2 catalogue recommendations (#535)

This module implements all three selected tools from the owner-reviewed P3 contract
in PR #545, on named cumulative prerequisite `b1b3345d`. It does not close #535:
updated-head review and central registration remain integration gates.

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

`suggest_editorial_connections` takes exactly one music seed or explicit post seed
(optional expectedVersion), default 10/max20. The object-root schema rejects both,
neither, excess fields and a version without a post seed. Public scopes are
`catalogue:read` + `content:read`; own draft seeds additionally need `posts:read`.
It uses E1's coherent snapshot/version and E2's structured primary-reference query.
Published candidate posts rank exact reference first, then related entity tier,
then post ID; posts are deduplicated before the 200+1 window. Only returned candidates
and their qualifying relation/reference evidence are projected. Artist and playlist
relations return explicit unsupported insufficient evidence; missing/nonqualifying
primary references are distinct typed limits, not implicit body/album traversal.

`suggest_playlist_sequence` requires playlistId, expectedRevision and exact strategy
`album_blocks_v1`. PL1 supplies one complete captured-time membership/revision snapshot,
at most100 members. Every track must qualify; hidden albums become unknown singleton
relations and are absent from evidence/digest. Blocks retain first appearance; positive
recorded numbers sort within blocks, unknown/nonpositive numbers last, stable ties.
Output is the complete permutation, contiguous positions, basis revision, cited block
evidence and digest. Tied stored positions are explicit. No supported block returns
unchanged insufficient evidence; an already ordered supported block is sufficient
with changed:false. Stale revisions conflict; oversized or hidden-member calls fail
without a partial proposal. The tool never calls a playlist writer.

All successful outputs recheck actual request authority before disclosure. The pure
sequence tests cover asymmetric ordering and stable ties; migrated-D1 official tool
calls cover source access, unsupported relations, publication gates, deterministic
digests, no writes and the 100/101 boundary. E2 continuation tests use real persisted
OAuth, including a grant revoked after preflight. No central OAuth discovery or
production readiness is claimed by this leaf.
