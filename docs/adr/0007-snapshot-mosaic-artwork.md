# ADR-0007: Snapshot mosaic artwork

Status: Proposed for review, implemented on this branch.

Date: 2026-10-31

## Context

Posts can contain several album covers and inline images, but their artwork and social cards accept one image. Authors want playlist-style artwork without selecting layouts, crops, or tile order.

The owner confirmed two rules: artwork changes only on regeneration, and the service owns simple recipes. Regeneration refreshes current content rather than shuffling an unchanged selection.

## Decision

Use one versioned recipe, `reading-order-grid-v1`. Discover up to sixteen distinct, approved image sources in reading order, including nested content. Resolve source images in bounded batches and take the first four usable distinct images. An attached music entity contributes a final music reference after the post body; repeated references do not get extra tiles.

Render a square 1200px master in the existing social-image Worker. One image fills the square. Two images split it vertically. Three use a large left tile and two right tiles. Four use a 2×2 grid. All tiles use centred cover crops, with no text, gaps, or branding.

The author previews the result and chooses **Use mosaic** or **Keep existing artwork**. Generate and Regenerate never save a post or replace its artwork themselves. Post edits never trigger generation.

Store the finished PNG through the existing private image-upload path, then attach and publish it through the existing content save path. The frozen PNG is the saved composition in this version, not a new database record. Different delivery sizes resize that master rather than selecting sources again. Social-card templates consume it as ordinary artwork.

Keep the recipe/discovery rules in `@gbfm/rich-content/mosaic`. Keep image fetching and rasterization in `apps/social-image`. WWW owns the authenticated authoring action and preview state. Production rasterization remains behind the existing service binding; local development loads the same renderer and WASM assets directly.

## Safety and limits

- The public action requires a same-origin JSON POST and a successful creator-authorized content preview before rendering.
- The social-image Worker has no public mosaic route in WWW and no workers.dev route. Its internal endpoint accepts only bounded, parsed image candidates.
- Only approved HTTPS image hosts qualify. Validate every redirect before following it. Do not forward cookies or authorization headers to source hosts.
- Reject private GBFM image paths, SVG, arbitrary remote hosts, oversized requests, and images above 8 MiB. Each source request has a five-second timeout and receives caller cancellation.
- No usable images produces a recoverable error. Existing artwork remains unchanged. Rendering and upload failures likewise leave the post alone.
- Generated previews use normal upload lifecycle bookkeeping. A dismissed preview may remain an unattached upload; this change does not add a second cleanup policy.
- No migration, deployment, production data change, or new paid image transformation binding is required by the code change.

## Alternatives

- Live mosaics would change shared artwork after ordinary edits, against the owner's decision.
- A layout editor would add choices the owner explicitly does not want.
- A separate deployed service or mosaic table would duplicate existing rendering and media lifecycle infrastructure.
- A normalized source manifest would support recomposing old revisions at new aspect ratios, but the current requirement only needs a frozen master and regeneration from current content.

## Consequences

The capability works for editorial artwork, mix artwork, and tweet social exports. Existing cards retain their templates and dimensions. An explicit saved tweet artwork URL takes precedence over the attached music cover; the music identity and listening links do not change.

External media embeds without a resolved thumbnail do not contribute an image. This version does not scrape embed pages, inspect iframe DOM, use private uploads as tile sources, or fetch arbitrary HTTPS images. It does not promise identical bytes when a provider replaces artwork at the same source URL: the saved master remains fixed, while regeneration fetches current bytes.

Revisit a separate manifest when independently art-directed aspect ratios or reopening an old source snapshot becomes a real requirement. Revisit image-source resolution when external embeds gain an owned thumbnail contract.

## References

- [Existing social-card architecture](0005-hybrid-site-wide-social-cards.md)
- [Mosaic service contract](../specs/mosaic.md)
