# Authorization matrix and endpoint audit

Status: proposed key policy; current behavior is source-inspected, not runtime-tested in this documentation task. Baseline and authority: [problem](00-problem.md). Inventory covers every endpoint declared with `AuthMiddleware` in `packages/api/src` at the inspected baseline, plus raw Better Auth and optional-auth paths. Excluded groups were inventoried for credential boundaries, not exhaustively audited for all existing session authorization defects.

## Key-enabled endpoints

All rows require an active matching-environment key, current active owner with known creator/editor/admin role, one rate-limit slot, and no mixed credentials. `Owned` means the owner is currently in `post_creators`, even when the user's role is admin. All authenticated key responses are private/no-store.

| Existing endpoint ID and route | Observed session enforcement | Proposed PAT scope and restrictions |
| --- | --- | --- |
| `getPostsForEdit`, `GET /api/content/posts/manage` | Session; non-admin query filters by creator; admin sees all | `posts:read`; always filter by owner, retaining existing query filters and pagination |
| `getPostBySlugForEdit`, `GET /api/content/posts/:slug/edit` | Session; creator relation or admin | `posts:read` + Owned; unrelated key gets 404 |
| `previewPostContent`, `POST /api/content/posts/preview` | `canCreatePosts` creator-or-higher | `posts:create` **or** `posts:update`; no publication or persistence; preview does not grant private-media access |
| `createPost`, `POST /api/content/post` | Creator-or-higher; supplied creators allowed; no separate publish gate | `posts:create`; explicit stable slug required for PAT; omitted/empty `creatorIds` means self, otherwise require exactly `[ownerId]`; effective `draft = payload.draft ?? false` |
| `updatePostBySlug`, `PATCH /api/content/posts/:slug` | Creator relation or admin; accepts `creatorIds`; no role/publish gate | `posts:update` + Owned; reject any supplied `creatorIds`, including empty; reject type changes; guard current state/ownership at write |
| `resolvePostMusic`, `POST /api/content/posts/:id/resolve-music-entity` | Creator relation or admin, rechecked after provider work; optimistic `updatedAt` check | `music:resolve` **and** `posts:update` + Owned; current public state also needs publish; recheck key/current user before attachment commit |
| `presignImage`, `POST /api/upload/image/presign` | Any session; server constructs private owner path; declared size checked against 10 MiB | `uploads:images:create`; owner path only, no caller-supplied object key, retain MIME/size validation and 5-minute URL |

Source: [post contracts](../../../packages/api/src/post.ts), [post handlers](../../../apps/server/src/http/post.handlers.ts), [post service](../../../apps/server/src/services/post.service.ts), [post resolution](../../../apps/server/src/services/post-music-resolution.ts), [upload contracts](../../../packages/api/src/upload.ts), [upload handlers](../../../apps/server/src/http/upload.handlers.ts).

### Publication is determined from effective state

| Operation | Effective states | Extra requirement |
| --- | --- | --- |
| Create | `draft: true` | None beyond create scope and creator-or-higher |
| Create | `draft: false` or omitted | `posts:publish` + current editor/admin |
| Update | draft to draft, including omitted `draft` | None beyond update scope, role, ownership |
| Update | draft to public | Publish scope + editor/admin |
| Update | public to public, including omitted `draft`, metadata-only edits, and attachment changes | Publish scope + editor/admin |
| Update | public to draft | Publish scope + editor/admin, since this changes public availability |
| Resolve music | draft | Resolve + update scopes, creator-or-higher, ownership |
| Resolve music | public | Also publish scope + editor/admin |

Compute `nextDraft = payload.draft ?? current.draft`, never default update omission to true. `posts:publish` alone cannot create, update, or resolve. Admin keys get neither scope bypass nor ownership bypass. Normal users and unknown roles cannot use the authoring key surface, even if their account retains an old grant.

For an existing post, authorization must precede media preparation and catalog/provider writes. A post that becomes public or loses ownership while the operation runs must fail the guarded commit rather than use the stale decision. Existing post music resolution already has a concurrency check, but its current check must be extended to the key's policy rather than assumed sufficient.

### Media and catalog caveats

- Image presign's `publicUrl` currently names a **private** object URL. Preserve the response field for compatibility and explain it to clients. Actual publication happens during an authorized content write.
- The declared size gate is not proof that direct PUT bytes are constrained. Before enabling image keys, verify signed PUT enforcement through the existing object-store adapter. If bytes are not constrained, add a signed size constraint or reject unsupported presigning rather than claim a hard 10 MiB enforcement. This is a required delivery check, not a new upload protocol in the docs.
- PAT `uploads:images:create` does not authorize private preview grants, listing objects, or publishing. Presigned URLs are separate bearer capabilities and survive key revocation for at most their existing 5-minute lifetime.
- Retain current attachment/media ownership checks, but remove the admin private-media bypass **for PATs**: no newly attached private media from another owner. Already attached authorized resource media remains governed by resource access. Pass an explicit media authority mode rather than falsifying the actor's role as `creator`.
- `music:resolve` permits canonical provider resolution as a side effect of an owned post. It does not expose catalog CRUD, merge, scrape, playlist imports, or link moderation. A failed post attachment may leave useful shared catalog enrichment; it must not publish the post or overwrite a concurrent edit.

## Complete protected endpoint exclusions

Every endpoint ID below remains **session-only**. A PAT attempt receives `KeyEndpointDenied` before the handler, regardless of scopes or owner role. IDs correspond to the linked API declarations, which own exact paths and HTTP methods. Multiple IDs in a row are deliberate enumeration, not a wildcard permission. A newly added protected endpoint is excluded by default even before this inventory is refreshed.

| Contract source | Excluded endpoint IDs | Reason |
| --- | --- | --- |
| [post.ts](../../../packages/api/src/post.ts) | `createMicroPostReply` | Replies publish through a distinct flow available to ordinary session users; separate role and retry contract required |
| [upload.ts](../../../packages/api/src/upload.ts) | `previewMedia`, `initMultipartUpload`, `presignMultipartPart`, `completeMultipartUpload`, `abortMultipartUpload`, `multipartUploadStatus` | Private preview grants and multipart audio are broader capabilities |
| [audio.ts](../../../packages/api/src/audio.ts) | `createMix`, `getAudioByTypeForEdit`, `getAudioBySlugForEdit`, `updateAudioBySlug`, `createAudio` | Audio/mix authoring and draft reads not needed for tweets |
| [release.ts](../../../packages/api/src/release.ts) | `createRelease`, `getReleaseBySlugForEdit`, `updateReleaseBySlug`, `deleteReleaseBySlug` | Release management excluded |
| [shows.ts](../../../packages/api/src/shows.ts) | `getShowsForEdit`, `getShowBySlugForEdit`, `createShow`, `updateShowBySlug`, `deleteShowBySlug`, `subscribeToShow`, `unsubscribeFromShow`, `getShowSubscriptionStatus` | Show authoring and personal subscriptions excluded |
| [admin.ts](../../../packages/api/src/admin.ts) | `getFeaturedMixSettings`, `setFeaturedMix`, `getAdminOverview`, `getAdminTelemetry`, `simulateFrontendError`, `getNewsletterSubscribers` | No admin delegation or subscriber disclosure |
| [email.ts](../../../packages/api/src/email.ts) | `getMixAnnouncementOptions`, `sendMixNotification`, `getEmailLogs` | No email sending or delivery data access |
| [invite.ts](../../../packages/api/src/invite.ts) | `sendInvite` | No onboarding/admin delegation |
| [file-manager.ts](../../../packages/api/src/file-manager.ts) | `getFileManagerConfig`, `listFileManagerObjects` | No storage configuration/listing access |
| [user.ts](../../../packages/api/src/user.ts) | `updateProfile`, `getProfile`, `getSocialLinks`, `replaceSocialLinks`, `getAdminUserSocialLinks`, `replaceAdminUserSocialLinks`, `updateAdminUserBio`, `getAdminUserBio`, `getEmailPreferences`, `updateEmailPreferences`, `getUserSubscriptions`, `searchUsers` | No account/profile or user-search surface; owner identity comes from authenticated actor |
| [internal.ts](../../../packages/api/src/internal.ts) | `whoami` | Existing session test endpoint is not a PAT API; never manufacture its AuthSession |
| [favorites.ts](../../../packages/api/src/favorites.ts) | `addFavorite`, `removeFavorite`, `removeShowFavorite`, `getFavorites` | Personal listening state excluded |
| [music-reminders.ts](../../../packages/api/src/music-reminders.ts) | `createMusicReminder`, `getMusicReminders`, `updateMusicReminder`, `deleteMusicReminder` | Reminder and delivery side effects excluded |
| [listening.ts](../../../packages/api/src/listening.ts) | `library`, `preview`, `save`, `editMix`, `deleteMix`, `createCollection`, `editCollection`, `deleteCollection`, `membership` | Personal listening-library management excluded |
| [music.ts](../../../packages/api/src/music.ts) | `createArtist`, `updateArtist`, `deleteArtist`, `listArtistLabels` | Artist management excluded |
| music.ts | `addArtistToAlbum`, `removeArtistFromAlbum`, `addArtistToTrack`, `removeArtistFromTrack` | Catalog relationship changes excluded |
| music.ts | `createAlbum`, `updateAlbum`, `deleteAlbum`, `listAlbumLabels`, `createTrack`, `updateTrack`, `deleteTrack` | Album/track management excluded |
| music.ts | `createPlaylist`, `updatePlaylist`, `deletePlaylist`, `addTrackToPlaylist`, `removeTrackFromPlaylist`, `reorderPlaylistTracks`, `addSpotifyTrackToPlaylist`, `importSpotifyPlaylist`, `syncPlaylistLinks` | Playlist creation/import/enrichment is broader than post resolution |
| music.ts | `listLabelsForAdmin`, `createLabel`, `getLabel`, `updateLabel`, `deleteLabel`, `listLabelArtists`, `listLabelAlbums`, `affiliateArtistWithLabel`, `unaffiliateArtistFromLabel`, `affiliateAlbumWithLabel`, `unaffiliateAlbumFromLabel` | Label authorship/administration excluded |
| music.ts | `resolveMusicEntity`, `addEntityLink`, `updateEntityLinkStatus`, `deleteEntityLink`, `rescrapeEntityLinks`, `scrapeEntityLinks` | Only the post-scoped resolver is enabled; no generic resolver/link mutation escape |

## Other request surfaces

| Surface | Current shape | PAT policy |
| --- | --- | --- |
| `/auth/*` | Better Auth raw router, including sign-in/session/admin APIs | Deny PATs before Better Auth; no key-created sessions or key management via auth plugin routes |
| New `/api/user/api-keys` management | Proposed real session endpoints | Deny PATs even alongside a valid session cookie |
| Navigation neighbours/random/seen and `DELETE /api/navigation/reading-history` | [navigation.ts](../../../packages/api/src/navigation.ts) with optional session/anonymous identity | Deny PATs; do not create an anonymous device cookie or mutate reading state |
| Public posts/music/search/profile/site metadata/social cards, health/docs, public listening, newsletter subscribe/unsubscribe, invite confirmation, Spotify proxy, audio play tracking, RSS/site routes | No required `AuthMiddleware`; some public routes have side effects or identity handling | Do not attach PATs. Gate rejects PAT attempts on known excluded routes; unauthenticated requests retain existing behavior |
| R2 presigned PUT | Object-store capability, outside the API router | No GBFM auth header; use only returned signed URL and prescribed upload headers |

“Default deny” concerns **use of the key**, not making public data private. A client may read public data without credentials. A caller cannot turn a denied PAT request into anonymous access by having the server silently ignore the credential.

## Enforcement checkpoints

1. Transport gate rejects excluded/ambiguous PAT use before any optional identity or raw auth route.
2. Key middleware verifies key/environment/current account and claims quota exactly once.
3. Endpoint policy checks scopes and current role before expensive work.
4. Service policy checks current resource ownership and effective publish state before side effects.
5. Guarded persistence detects state/ownership changes; slow provider work also rechecks key validity/current role.
6. Response projection excludes credential material, sets no-store, and retains current successful content schemas.

Scope metadata alone, Better Auth role declarations alone, or UI visibility alone satisfies none of these checkpoints.
