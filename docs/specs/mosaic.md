# Mosaic artwork

Status: Implemented on this branch, pending owner review. Not deployed.

## Author workflow

In the WWW creator, open Artwork and choose **Generate mosaic**. Preview the result, then choose **Use mosaic** to update the local draft or **Keep existing artwork** to dismiss it. Save or publish normally to persist the chosen image. **Regenerate mosaic** reads the current draft again; unchanged source images and recipe produce the same composition.

The service owns selection and layout. There are no layout, order, crop, spacing, or randomization controls. A preview generated before further edits is labelled as an earlier version; the author can still use it or regenerate it.

## Terms

| Term | Meaning |
| --- | --- |
| Candidate | A supported image URL and stable source identity discovered in resolved content |
| Recipe | A versioned service-owned rule for selecting and arranging images |
| Composition | The recipe's selected images and tile geometry |
| Master | The frozen 1200×1200 PNG uploaded as ordinary artwork |
| Output | The master at a delivery size, or a social card that contains it |

## Source rules

Walk paragraphs, headings, nested inline formatting, quotes, lists, tables, and card groups in reading order. Music embeds contribute their snapshot image. Inline images contribute their source URL. Deduplicate both source identity and canonical URL. An attached music reference follows body sources.

Keep up to sixteen candidates so failed requests can fall through to later images. Resolve in batches of four and select at most four usable distinct images in their original order. The allowlist covers GBFM's CDN and supported music-artwork providers. Private GBFM paths, relative URLs, arbitrary hosts, and embeds without thumbnails do not qualify.

## Public authoring boundary

`POST /actions/mosaic`

```json
{ "content": "Canonical rich-content source, including any attached music reference" }
```

Requires an exact same-origin `Origin`, JSON content type, a signed-in user with post-creation rights, and a body no larger than 128,000 bytes. WWW asks the existing authenticated post-preview endpoint to resolve the content, discovers candidates from that result, then invokes the image Worker. Callers do not submit layouts or trusted image lists.

Success returns a 1200×1200 PNG, `Cache-Control: no-store`, a recipe revision fingerprint in `X-Mosaic-Revision`, and the selected image count in `X-Mosaic-Images`. The client uploads it through the normal image-upload service before showing a preview. Uploads receive unique object keys; the revision fingerprint is not a storage key or a guarantee about mutable remote source bytes.

| Status | Meaning |
| --- | --- |
| 400 | Invalid request |
| 401 / 403 | Session, creator permission, or origin denied |
| 405 / 415 | Wrong method or content type |
| 413 | Request exceeds the byte limit |
| 422 | No usable images |
| 502 | Invalid upstream preview response |
| 503 | Resolution or rendering unavailable |

The normal preview API can also return its own validation or availability status. Errors do not update artwork or save content.

## Ownership

| Responsibility | Code |
| --- | --- |
| Discovery, recipe, tile geometry, fingerprint | `packages/rich-content/src/mosaic.ts` |
| Bounded remote loading and redirects | `apps/social-image/src/mosaic-image.ts` |
| Satori and Resvg rasterization | `apps/social-image/src/mosaic.ts` |
| Internal renderer protocol | `apps/social-image/src/mosaic-handler.ts` |
| Public authenticated action | `apps/www/src/server/mosaic.ts` |
| Preview, acceptance, and regeneration | `apps/www/src/page/creator/mosaic-view.ts` and `update.ts` |
| Upload, attachment, and publication | Existing creator, upload, and media-publication services |

## Verification

Focused tests cover discovery, deduplication, geometry, source policy, bounded bodies, redirect validation, authorization ordering, and editor transitions. Workerd tests render real one-to-four-image PNGs with the shipped WASM assets. The browser journey uses generated fixture artwork and a disposable storage server to check preview, acceptance, unchanged artwork during edits, draft persistence, reload, and regeneration. It does not depend on live music-provider availability.

See [ADR-0007](../adr/0007-snapshot-mosaic-artwork.md) for scope and trade-offs.
