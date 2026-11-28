# Rich Content Architecture

## Summary

Replace executable MDX and the Foldkit regex renderer with a project-wide rich content pipeline:

```text
GFM source plus allowlisted directives
  -> shared parser
  -> typed unresolved document
  -> server embed resolver
  -> versioned render document
  -> platform renderer
```

The single forward source format is portable UTF-8 text: CommonMark plus GitHub Flavored Markdown, abbreviated GFM, with an allowlisted directive vocabulary. Existing `content` text columns can hold it without a schema change. The typed render document is derived and regenerable, not the only durable record. The server parses on read, caches the render result, resolves embeds into render-ready snapshots, and adds `richContent` to existing API responses. Existing `content` and `compiledContent` fields remain during the additive transition so deployed clients keep working.

The project converts every existing MDX-shaped source record to that canonical format in a coordinated hard cut after verification against a read-only exported corpus and separate approval for the production update. The literal-only MDX reader exists only in migration tooling. Runtime readers and writers accept only canonical source after cutover. No authored JavaScript, JSX expression, raw HTML, or compiled function body is evaluated or sent to a renderer.

This design requires no database schema change, although storage implementation is not part of the public contract. A future store may use files, text columns, or another system if it can losslessly import and export the canonical source. Spotify track, album, and playlist references resolve only through GBFM music entities. Catalog creation and enrichment happen before cutover, never during a public read. The design removes the stored XSS path, restores standard Markdown features, removes reader-side Spotify metadata waterfalls, keeps SSR and hydration deterministic, and leaves a direct path for a future mobile renderer.

## Context and Current State

The inventory in this section records the migration-planning baseline, including the former React app and UI package. It is not the current UI ownership map: `packages/ui` has been retired. See [EFFECT-UI.md](../../EFFECT-UI.md) for the current native WWW structure. Foldkit renderer paths and checkpoint language below retain their historical context, not current implementation guidance.

### Current data model

Raw authored content is stored in existing text columns:

| Content kind | Storage | Nullability |
| --- | --- | --- |
| Editorial posts, tweets, replies | `apps/server/src/db/post.schema.ts`, `posts.content` | Nullable because micro posts may contain only attached music |
| Mixes, tracks, miscellaneous audio | `apps/server/src/db/audio.schema.ts`, `audio.content` via `defaultContentFields` | Required |
| Shows | `apps/server/src/db/show.schema.ts`, `shows.content` via `defaultContentFields` | Required |
| Releases | `apps/server/src/db/release.schema.ts`, `releases.content` via `defaultContentFields` | Required |
| Music labels | `apps/server/src/db/music-entity.schema.ts`, `music_labels.content` | Required with an empty default |

`apps/server/src/db/util.ts` owns the shared `defaultContentFields.content` definition. Tags, titles, descriptions, artwork, audio, and post-level music attachments are separate structured fields and are not rich content syntax.

### Current processing

`apps/server/src/lib/mdx.ts` compiles each non-empty content string with `@mdx-js/mdx` into a JavaScript function body. Its Effect cache has capacity 256 and a one-hour success TTL. Compilation failure is converted to an empty `compiledContent` by most callers.

The compiler is consumed by:

- `apps/server/src/services/post.service.ts`
- `apps/server/src/services/audio.service.ts`
- `apps/server/src/services/show.service.ts`
- `apps/server/src/services/release.service.ts`
- `apps/server/src/services/music-entity/label.service.ts`
- `apps/server/src/services/resolve.service.ts`
- `apps/server/src/runtime/services.ts`, which provides `MdxServiceLayer`

The API schemas in `packages/api/src/post.ts`, `audio.ts`, `shows.ts`, `release.ts`, `music.ts`, and `resolve.ts` expose `compiledContent` alongside raw `content` on applicable responses.

On `prod`, `apps/www/src/components/MDXRendrr.tsx` calls `runSync` in the browser and supplies `react/jsx-runtime`. This evaluates stored editor-authored content as JavaScript in every reader's origin. `apps/www/src/components/mdx-components.tsx` exposes eight component names to that code:

1. `Track`
2. `Album`
3. `Playlist`
4. `MusicEntity`
5. `YoutubeEmbed`
6. `ExternalMedia`
7. `Tracklist`
8. `HorizontalScrollCards`

`Track`, `Album`, and `Playlist` call the Spotify proxy independently in the browser. `MusicEntity` also loads entity data, links, and sometimes tracks in the browser. `ExternalMedia` may perform a Bandcamp oEmbed request in the browser. These paths create layout shift and a request count proportional to embeds.

On `feat/foldkit-www`, `apps/www/src/rich-content.ts` safely renders inert markup but recognizes only a small regex-defined subset. It loses emphasis, images, ordered and nested lists, tables, and other standard Markdown. Legacy JSX prints as text. The exact failure is visible on `/editorial/lack`, where a legacy `Track` element is not interpreted.

The Foldkit WWW now ignores `compiledContent`, maps raw API `content` through `contentItems` in `apps/www/src/entry.server.ts`, and renders it through:

- `apps/www/src/application.ts` for editorial, mix, track, release, label, and generic detail content
- `apps/www/src/tweet-card.ts` for tweets and replies
- `apps/www/src/application.ts` plus `virtual:repo-changelog` for `CHANGELOG.md`

The same Foldkit `Flags` payload drives SSR hydration and client navigation. This makes a serializable render document a natural boundary.

### Producer and consumer inventory

#### Active authoring producers on `feat/foldkit-www`

- `apps/www/src/creator/model.ts`: stores creator draft `content`, including local autosave state.
- `apps/www/src/creator/services.ts`: loads and saves editorial, tweet, reply, and mix content through existing APIs.
- `apps/www/src/creator/view.ts`: plain textarea authoring for editorial, tweets, and mixes.
- `apps/www/src/dashboard/shows.ts`: show content authoring and save commands.
- `apps/www/src/dashboard/catalog.ts`: music label content authoring and updates.
- `packages/ui/src/components/music-entity-metadata-form.tsx`: reusable label content textarea, currently used by the legacy React dashboard and stories.
- `CHANGELOG.md` plus `apps/www/plugins/repo-changelog.ts`: repository-authored Markdown loaded into WWW at build time.

#### Legacy authoring producers on `prod` that define compatibility requirements

- `apps/www/src/components/simple-markdown-editor.tsx`: CodeMirror Markdown editor, toolbar, split preview, browser MDX compilation, and music embed widgets.
- `apps/www/src/components/markdown-editor-commands.ts`: bold, italic, link, heading, quote, unordered list, ordered list, code, and strikethrough editing commands.
- `apps/www/src/components/editor/music-entity/music-entity-markdown.ts`: serializes and parses `<MusicEntity type="..." id="..." />`.
- `apps/www/src/components/editorial/editorial-paste.ts`: recognizes standalone and linked Spotify URLs, writes temporary `<MusicEntityPending ... />` markers, and resolves them into catalog references.
- `apps/www/src/components/editorial/music-entity-editor-embeds.ts`: CodeMirror decorations for pending and resolved music entities.
- `apps/www/src/components/editorial/music-entity-editor-widgets.ts`: mounts React music cards over source lines.
- `apps/www/src/components/editorial/external-media.ts`: validates Spotify, SoundCloud, Bandcamp, and YouTube URLs and serializes `<ExternalMedia ... />`.
- `apps/www/src/components/editorial/ExternalMediaPickerDialog.tsx`: inserts external media markup.
- `apps/www/src/routes/new/-ComposerPage.tsx`, `editorial.tsx`, and `tweet.tsx`: save editor content into post APIs.
- `apps/www/src/routes/mix-upload.lazy.tsx`: authors mix `content`; its `TracklistEditor` state is draft and preview data, not an existing server content column.
- `packages/ui/src/components/tracklist-editor.tsx`: structured timestamp editor used by the legacy mix uploader. It does not currently persist through an API schema.
- `apps/www/src/components/editor.tsx`: an older generic MDX editor calling legacy `/content` endpoints.

#### Server consumers and transport contracts

- Database schemas listed under Current data model.
- `apps/server/src/lib/mdx.ts` and `apps/server/src/lib/mdx.test.ts`.
- Post, audio, show, release, label, and resolve services listed under Current processing.
- `apps/server/src/http/post.handlers.ts`, `audio.handlers.ts`, `shows.handlers.ts`, `release.handlers.ts`, `music.handlers.ts`, and `resolve.handlers.ts` serialize service results through `packages/api`.
- `packages/api/src/post.ts`, `audio.ts`, `shows.ts`, `release.ts`, `music.ts`, and `resolve.ts` define create, update, detail, listing, thread, and screen wire schemas.
- `apps/server/src/services/site-presentation.service.ts` reads content entities for metadata and social cards but currently uses titles and descriptions rather than rich content rendering.
- `apps/server/src/services/search.service.ts` searches raw content text. It should continue doing so.
- `apps/server/src/routes/rss/rss.template.ts` does not render rich content and should continue using escaped descriptions.

#### WWW consumers on `prod`

- `apps/www/src/components/MDXRendrr.tsx` and `mdx-components.tsx`.
- `apps/www/src/components/Layout/LongPost.tsx`.
- `apps/www/src/components/TweetReplyCard.tsx`.
- `apps/www/src/routes/editorial/$slug.tsx`.
- `apps/www/src/routes/tweet/$slug.tsx`.
- `apps/www/src/routes/mixes/$mixId.tsx`.
- `apps/www/src/routes/tracks/$trackId.tsx`.
- `apps/www/src/routes/releases/$slug.tsx`.
- `apps/www/src/routes/labels/$labelSlug.tsx`.
- `apps/www/src/routes/tags/$tag.tsx`.
- `apps/www/src/routes/changelog.tsx`.
- `apps/www/src/components/simple-markdown-editor.tsx` preview mode.
- `apps/www/src/lib/mdx-music-references.ts` statically scans `Album`, `Track`, and `Playlist` URLs for editorial prefetch.
- `Track.tsx`, `Album.tsx`, `Playlist.tsx`, `MusicEntity.tsx`, `ExternalMedia.tsx`, `Tracklist.tsx`, `YoutubeEmbed`, and `HorizontalScrollCards` perform or present embed work.

#### WWW consumers on `feat/foldkit-www`

- `apps/www/src/entry.server.ts`: SSR API orchestration and raw content projection.
- `apps/www/src/application.ts`: generic detail and changelog rendering.
- `apps/www/src/tweet-card.ts`: tweet and reply rendering.
- `apps/www/src/rich-content.ts`: current inert mini-renderer.
- `apps/www/src/entry.client.ts`: hydrates the same serializable Foldkit flags and handles client navigation.

#### Mobile and package consumers

- `apps/mobile/src/api/shows.ts`, show atoms, and show screens consume show and episode schemas.
- `apps/mobile/src/components/Home/FeaturedMixCard.tsx` and the player consume `AudioResponse`.
- Mobile currently does not render `content` or `compiledContent`, and has no Markdown or MDX parser. Additive response fields will therefore not change current behavior.
- `packages/api` is the shared wire-contract owner.
- `packages/ui` owns legacy React editor and display components, but it must not own parsing or server resolution.
- No other package currently produces or consumes the stored rich content language.

## Goals

1. Make editor-authored content inert. No source text may become executable JavaScript or arbitrary HTML.
2. Restore GFM features, including emphasis, images, ordered and nested lists, task lists, tables, strikethrough, links, quotes, and fenced code.
3. Preserve the meaning of all live legacy content, including the eight allowlisted JSX component forms, by statically converting it before the hard cut without evaluating MDX.
4. Resolve embed data on the server and return a render-ready, versioned document.
5. Keep SSR, hydration, and client navigation on the same data and rendering path.
6. Avoid per-embed browser metadata requests and reserve stable layout before the page reaches the client.
7. Keep all API changes additive until deployed clients have migrated.
8. Keep canonical source portable, editable, searchable, and losslessly exportable independently of GBFM runtime code.
9. Make malformed content degrade locally without breaking an API response or page.
10. Provide a shared contract that WWW and a future mobile surface can render without shipping a parser.

## Non-Goals

- A general component or plugin system for authors.
- Arbitrary HTML, JavaScript expressions, imports, exports, or runtime component registration.
- A block editor or collaborative editor.
- Persisting the derived render AST as the only durable representation.
- Automatically mutating the music catalog during a public read.
- Rebuilding the dormant mix tracklist persistence model.
- Rendering rich content in mobile before a mobile product surface needs it.
- Removing `content` or `compiledContent` in the same release that introduces `richContent`.
- Running the proposed migration against production while implementing this project. The production operation is a later, explicitly approved rollout step.

## Invariants

1. Canonical GFM-plus-directives source is the durable, portable source of truth. In the current schema it remains in raw `content` text columns.
2. A reader never evaluates author-controlled source, generated code, JSX, HTML, URLs, or style values.
3. Only finite, Effect Schema-validated tagged unions cross API and Foldkit hydration boundaries.
4. Raw HTML is never represented as renderable HTML. It becomes inert text or a typed unsupported node.
5. Runtime readers and writers accept one source language. Legacy JSX is recognized only by pre-cutover audit and conversion tooling, for the eight allowlisted component names and literal props.
6. An unknown component, expression, spread prop, event handler, identifier, template literal, function call, or nested expression is inert text.
7. Link, image, and media URLs pass centralized protocol and provider validation before entering the render document.
8. Public reads do not write to the database or import catalog entities.
9. One malformed block or failed embed does not fail the surrounding document or page.
10. `content` remains in every existing response where it exists today.
11. Old clients may ignore `richContent` and continue using their current fields.
12. WWW renders a server-produced document for SSR and client navigation. It does not parse source.
13. The editor preview uses the same server pipeline and renderer as a public page.
14. Cache keys include source content and render schema version. A content edit cannot reuse a stale document.
15. Telemetry never records source text, directive props, external URLs with query strings, or rendered document payloads.
16. Importing and exporting canonical source does not require the parser, resolver, database schema, or a GBFM client.

## Design Constraints

- Use Bun and the existing monorepo workspaces.
- Follow the current Effect service, Layer, Schema, typed error, and tracing patterns in `apps/server`.
- Keep Foldkit side effects in Commands and server work in `entry.server.ts` or API services, not in `view`.
- The API and WWW run on Cloudflare-compatible runtimes. Raw bindings remain at composition seams.
- Current deployed mobile and WWW clients must continue to decode existing responses.
- The runtime implementation must not require a database schema migration. The later content normalization operation updates text values only.
- Tests must not use regex in assertions.
- Route and page files receive end-to-end coverage, not unit tests.
- The solution should favor a small, deep parser package and one orchestration service over per-entity implementations.

## Alternatives Considered

### Option 1: Keep MDX but parse without evaluation

Use `remark-mdx` or the MDX parser to build an AST, reject expressions and imports, and translate allowlisted JSX nodes into render nodes.

```ts
type ParsedMdx = {
  readonly markdown: ReadonlyArray<MarkdownNode>
  readonly jsx: ReadonlyArray<AllowlistedJsxNode>
}
```

Advantages:

- Highest surface compatibility with existing JSX-shaped content.
- Reuses already installed MDX parsing dependencies.
- Requires less source migration at first.

Disadvantages:

- Authors remain exposed to MDX grammar even though JavaScript is forbidden.
- Ordinary `{` and `<` in prose can make the whole document invalid.
- The accepted language is a surprising subset of MDX and is harder to explain in the editor.
- Security depends on continuously rejecting every executable or nonliteral AST form.
- It preserves a format whose primary value, executable JSX, the product explicitly cannot use.

Conclusion: use MDX JSX parsing only in the one-off conversion tool for isolated legacy component candidates. Do not ship it in a runtime reader or keep MDX as a canonical language.

### Option 2: GFM plus directives and standalone URLs

Use CommonMark and GFM for prose. Use directives for explicit embeds and recognize a supported provider URL only when it is the sole content of a paragraph.

```md
## A heading

Normal prose with *emphasis*, tables, and images.

https://open.spotify.com/track/2Mf7...

::track{url="https://open.spotify.com/track/2Mf7..." genres="dnb, experimental" blurb="..."}

::music{type="album" id="catalog-uuid" tracks="false"}

::media{url="https://www.youtube.com/watch?v=..."}

:::tracklist
1. Artist A - Track A
2. Artist B - Track B
:::

:::cards
::album{url="https://open.spotify.com/album/..."}
::track{url="https://open.spotify.com/track/..."}
:::
```

Advantages:

- Prose follows a familiar, documented, non-executable language.
- GFM covers the missing formatting features.
- Directives are explicit, statically parseable, and naturally allowlisted.
- Standalone URLs provide a low-friction authoring path.
- Source remains readable without a specialized editor.
- The parser can return a platform-neutral domain model.

Disadvantages:

- Existing JSX needs a verified one-off conversion before the hard cut.
- Directive attributes are strings, so richer values need explicit parsers.
- WWW and mobile still need separate view mappings.

Conclusion: recommended.

### Option 3: Structured JSON blocks as the canonical stored format

Store a versioned block document directly and make the editor the only authoring surface.

```ts
type StoredDocument = {
  readonly version: 1
  readonly blocks: ReadonlyArray<StoredBlock>
}
```

Advantages:

- Strongest structural guarantees.
- No prose parser is needed at read time.
- Embeds and future block-editor operations are explicit.

Disadvantages:

- Requires a schema change or repurposes `content` into opaque JSON.
- Makes direct editing, Git-authored changelog content, search, exports, and operational repair worse.
- Requires a real block editor before source can be safely authored.
- Creates a migration and long-term stored schema commitment for a solo project.
- Adds version upgrades and dual-write concerns now.
- Couples the only durable representation to GBFM's internal node vocabulary, reducing portability.

Conclusion: reject for this project stage. Reconsider only if a block editor becomes a concrete requirement.

## Recommendation

Adopt Option 2 as the only runtime and forward source format. Use a narrow static extractor from Option 1 only in pre-cutover audit and conversion tooling.

### Authoring language

- Canonical prose is CommonMark plus GFM.
- Canonical embeds use the directives shown above.
- A supported Spotify, YouTube, SoundCloud, or Bandcamp URL in a paragraph by itself auto-embeds.
- The same URL inside prose or a Markdown link remains a normal link.
- Raw HTML is not supported.
- The editor inserts canonical directives, never JSX.
- Existing legacy JSX is normalized to directives by the planned content migration. It is not retained as an alternative authoring syntax.

### Processing placement

- Parse on read and cache.
- Validate on write using the same parser, but store only source.
- Resolve embeds on the server.
- Parse `CHANGELOG.md` at WWW build time through the same package because it is repository-authored and has no server API record.
- Preview editor content through an authenticated server endpoint and render the returned document.

### Storage decision

Store canonical UTF-8 source text as the durable representation. Continue using the existing `content` columns because they already satisfy this contract and avoid a schema migration. Run a planned one-off value migration to replace statically convertible legacy JSX with canonical directives. Records that cannot be converted without semantic uncertainty are reported for manual correction and block the hard cut.

In this spec, "content migration" means rewriting text values from the old syntax to the new syntax. It does not mean a schema migration, dual storage, or a period where the product supports two authoring formats.

Do not store the render AST as the only durable representation. A persisted AST couples exports to an internal schema, duplicates or replaces human-readable source, must be upgraded when parser versions change, and still cannot safely persist time-varying provider snapshots. Parse-on-read is already cheaper than the current MDX compilation and can use the same bounded Effect cache pattern. If profiling later proves that a durable parse cache is necessary, store it only as disposable derived data keyed by source hash and schema version.

Portability means:

- every canonical record exports as plain UTF-8 text;
- prose remains useful in any CommonMark or GFM reader, while unknown directives remain visible text;
- directives contain stable literal references, not serialized provider responses or executable expressions;
- import and export preserve source bytes and do not require database-specific identifiers except explicit catalog embed IDs;
- the parser and typed render schema may evolve without rewriting source unless the directive language itself changes.

### Embed snapshot decision

Do not persist embed metadata into authored source or a new table. Resolve a snapshot for each response:

1. Catalog ID references read the corresponding GBFM entity, verified links, artwork, artists, description, and optional tracks.
2. Spotify track, album, and playlist URLs normalize to canonical provider identities and look up an existing resolved identity claim.
3. A matching GBFM entity produces a `MusicEmbed` snapshot. A missing, stale, or mismatched identity produces `UnavailableEmbed`.
4. Public reads never call Spotify to fill a snapshot and never scrape, import, create, or update a catalog record.
5. The pre-cutover bootstrap resolves every Spotify music identity through the existing authenticated resolution API. Existing import services scrape provider metadata, persist artwork and links, and create or reuse the GBFM entity. Playlist sync jobs are then queued through the existing `sync-links` endpoint.
6. External media resolution normalizes the URL and builds a trusted player URL on the server. Spotify episodes and shows may remain external media because GBFM has no corresponding music entity type.
7. Successful render documents use a one-hour in-process cache. Missing entities return a local unavailable block without failing the document.
8. Catalog edits may remain stale for at most one hour in the first implementation. Explicit catalog-driven cache invalidation is not worth a reverse dependency index yet.

The API document is a response snapshot. Clients do not refresh individual embeds. A page or navigation refresh receives a newer snapshot.

## Proposed Design

### Module shape

```text
packages/rich-content
  src/schema.ts          Render document DTO and Effect Schemas
  src/source.ts          GFM/directive parsing and source validation
  src/legacy-mdx.ts      Migration-only static JSX and iframe extraction
  src/normalize.ts       Migration-only canonical source conversion
  src/limits.ts          Shared parser limits

apps/server
  src/lib/mdx.ts                          Existing service boundary, now owning typed rendering
  src/services/rich-content-music.service.ts  Read-only catalog snapshot resolver
  src/services/canonical-music-identity/*     Provider identity lookup

apps/www
  src/rich-content/render.ts             Total typed Foldkit renderer
  src/rich-content.ts                    Temporary raw-source fallback during additive rollout

scripts
  export-rich-content.sql                Portable content export query
  normalize-rich-content.ts              JSON normalizer and guarded SQL generator

apps/mobile
  future rich-content/render.tsx
```

`packages/rich-content` is a deep domain module. It owns canonical syntax, limits, migration conversion, and the serializable contract. It has no database, HTTP, Cloudflare, Foldkit, React, React Native, or Spotify dependency.

`apps/server/src/lib/mdx.ts` retains the existing `MdxService` ownership boundary while the API stays additive. Its `compile` method now returns the compatibility value expected by old contracts, while `render` parses canonical source and resolves a typed document. `apps/server/src/services/rich-content-music.service.ts` is the only rich-content catalog adapter. It queries canonical identities and music entities and performs no writes.

Each UI owns only a renderer from `RichContentDocument` to its native view type.

### Package exports

Use subpath exports so browser bundles cannot accidentally pull parser code:

```json
{
  "name": "@gbfm/rich-content",
  "exports": {
    "./schema": "./src/schema.ts",
    "./source": "./src/source.ts",
    "./legacy-mdx": "./src/legacy-mdx.ts",
    "./normalize": "./src/normalize.ts"
  }
}
```

WWW may import `@gbfm/rich-content/schema`. Server and the changelog build plugin may import `source`. Only migration tooling and its tests may import `legacy-mdx` or `normalize`.

## Domain Model and Types

The parser has an unresolved internal model. The wire contract contains only resolved or explicitly unavailable embeds. The following is the contract shape, with recursive schemas implemented using explicitly annotated `Schema.suspend` definitions so TypeScript does not infer recursive declarations as `any`.

```ts
import { Schema } from "effect"

export const RichContentVersion = Schema.Literal(1)

export const SafeUrl = Schema.String.pipe(
  Schema.brand("@gbfm/rich-content/SafeUrl"),
)
export type SafeUrl = typeof SafeUrl.Type

export const Inline = Schema.TaggedUnion({
  Text: { value: Schema.String },
  Emphasis: { children: Schema.Array(Schema.suspend(() => Inline)) },
  Strong: { children: Schema.Array(Schema.suspend(() => Inline)) },
  Delete: { children: Schema.Array(Schema.suspend(() => Inline)) },
  InlineCode: { value: Schema.String },
  Link: {
    href: SafeUrl,
    title: Schema.NullOr(Schema.String),
    children: Schema.Array(Schema.suspend(() => Inline)),
  },
  Image: {
    src: SafeUrl,
    alt: Schema.String,
    title: Schema.NullOr(Schema.String),
  },
  Break: {},
})

export const MusicEntityType = Schema.Literals(["track", "album", "playlist"])

export const StreamLink = Schema.Struct({
  platform: Schema.String,
  url: SafeUrl,
})

export const MusicSnapshot = Schema.Struct({
  entityType: MusicEntityType,
  entityId: Schema.NullOr(Schema.String),
  title: Schema.String,
  artists: Schema.Array(Schema.String),
  description: Schema.NullOr(Schema.String),
  imageUrl: Schema.NullOr(SafeUrl),
  canonicalUrl: SafeUrl,
  links: Schema.Array(StreamLink),
  tracks: Schema.Array(
    Schema.Struct({
      title: Schema.String,
      artists: Schema.Array(Schema.String),
      url: Schema.NullOr(SafeUrl),
    }),
  ),
})

export const ExternalMediaProvider = Schema.Literals([
  "youtube",
  "soundcloud",
  "bandcamp",
  "spotify",
])

export const Block = Schema.TaggedUnion({
  Paragraph: { children: Schema.Array(Inline) },
  Heading: {
    level: Schema.Literals([1, 2, 3, 4, 5, 6]),
    children: Schema.Array(Inline),
  },
  List: {
    ordered: Schema.Boolean,
    start: Schema.NullOr(Schema.Number),
    items: Schema.Array(
      Schema.Struct({
        checked: Schema.NullOr(Schema.Boolean),
        children: Schema.Array(Schema.suspend(() => Block)),
      }),
    ),
  },
  Quote: { children: Schema.Array(Schema.suspend(() => Block)) },
  Code: {
    language: Schema.NullOr(Schema.String),
    value: Schema.String,
  },
  ThematicBreak: {},
  Table: {
    align: Schema.Array(Schema.NullOr(Schema.Literals(["left", "center", "right"]))),
    rows: Schema.Array(Schema.Array(Schema.Array(Inline))),
  },
  MusicEmbed: {
    music: MusicSnapshot,
    genres: Schema.Array(Schema.String),
    blurb: Schema.NullOr(Schema.String),
    showTracks: Schema.Boolean,
  },
  ExternalMediaEmbed: {
    provider: ExternalMediaProvider,
    canonicalUrl: SafeUrl,
    embedUrl: SafeUrl,
    title: Schema.String,
    aspectRatio: Schema.Number,
  },
  Tracklist: {
    tracks: Schema.Array(Schema.Struct({ title: Schema.String })),
  },
  CardGroup: {
    children: Schema.Array(Schema.suspend(() => Block)),
  },
  UnavailableEmbed: {
    kind: Schema.Literals(["music", "media", "tracklist", "cards"]),
    label: Schema.String,
    href: Schema.NullOr(SafeUrl),
  },
  Unsupported: {
    source: Schema.String,
    reason: Schema.Literals([
      "raw-html",
      "unknown-directive",
      "invalid-directive",
    ]),
  },
})

export const RichContentDocument = Schema.Struct({
  version: RichContentVersion,
  blocks: Schema.Array(Block),
})

export type RichContentBlock = typeof Block.Type
export type RichContentDocument = typeof RichContentDocument.Type
```

The compact sketch shows the nominal `SafeUrl` brand. Its concrete runtime schema must decode the serialized string through the purpose-specific URL policy described below before applying that brand. A plain branded `Schema.String` without runtime refinement is not sufficient at API or hydration boundaries.

Source positions are not part of the public document. They remain in diagnostics for editor preview and logs. This keeps payloads smaller and avoids exposing raw source slices.

### Unresolved parser model

```ts
type EmbedReference =
  | {
      readonly _tag: "MusicUrl"
      readonly entityType: "track" | "album" | "playlist"
      readonly url: SafeUrl
      readonly genres: ReadonlyArray<string>
      readonly blurb: string | null
      readonly showTracks: boolean
    }
  | {
      readonly _tag: "MusicCatalog"
      readonly entityType: "track" | "album" | "playlist"
      readonly entityId: string
      readonly showTracks: boolean
    }
  | {
      readonly _tag: "ExternalMedia"
      readonly url: SafeUrl
    }

type UnresolvedBlock =
  | Exclude<
      RichContentBlock,
      {
        readonly _tag:
          | "MusicEmbed"
          | "ExternalMediaEmbed"
          | "UnavailableEmbed"
      }
    >
  | { readonly _tag: "EmbedReference"; readonly reference: EmbedReference }

type UnresolvedDocument = {
  readonly version: 1
  readonly blocks: ReadonlyArray<UnresolvedBlock>
}
```

The implementation may use a more precise recursive schema, but it must preserve the separation between parsing and I/O resolution.

### Diagnostics and failures

```ts
export const RichContentDiagnostic = Schema.Struct({
  severity: Schema.Literals(["warning", "error"]),
  code: Schema.Literals([
    "unsupported-html",
    "unknown-directive",
    "invalid-directive-attribute",
    "legacy-expression-rejected",
    "embed-unavailable",
    "document-limit-exceeded",
  ]),
  message: Schema.String,
  line: Schema.NullOr(Schema.Number),
  column: Schema.NullOr(Schema.Number),
})

export class RichContentValidationError extends Schema.TaggedError<RichContentValidationError>()(
  "RichContentValidationError",
  { diagnostics: Schema.Array(RichContentDiagnostic) },
) {}

export class EmbedLookupError extends Schema.TaggedError<EmbedLookupError>()(
  "EmbedLookupError",
  {
    kind: Schema.Literals(["catalog", "spotify", "bandcamp"]),
    reason: Schema.Literals(["not-found", "unavailable", "invalid-response"]),
  },
) {}
```

Expected parser and embed failures are typed internally. The public read service contains them and returns a valid document with `Unsupported` or `UnavailableEmbed` blocks. The preview and write-validation APIs return diagnostics to the author.

## Types, Interfaces, and APIs

### Parser interface

```ts
export interface RichContentSource {
  readonly parse: (
    source: string,
  ) => Effect.Effect<
    {
      readonly document: UnresolvedDocument
      readonly diagnostics: ReadonlyArray<RichContentDiagnostic>
    },
    RichContentValidationError
  >

  readonly validateForWrite: (
    source: string,
  ) => Effect.Effect<void, RichContentValidationError>
}

export interface LegacyContentConverter {
  readonly convert: (
    source: string,
  ) => Effect.Effect<
    {
      readonly source: string
      readonly changed: boolean
      readonly diagnostics: ReadonlyArray<RichContentDiagnostic>
    },
    RichContentValidationError
  >
}
```

`parse` is tolerant for canonical reads so one malformed canonical block cannot break a page. `validateForWrite` rejects JSX-shaped legacy embeds, invalid canonical directives, raw HTML, unknown attributes, and document limit violations. `LegacyContentConverter` is not exported to server or client runtime modules. It is used only by audit, dry-run, and conversion tooling.

### Server service interface

```ts
export interface RichContentService {
  readonly render: (
    input: {
      readonly source: string | null
      readonly context: "post" | "audio" | "show" | "release" | "label" | "changelog"
    },
    options?: { readonly signal?: AbortSignal },
  ) => Effect.Effect<RichContentDocument>

  readonly preview: (
    input: {
      readonly source: string
      readonly context: "post" | "audio" | "show" | "release" | "label"
    },
    options?: { readonly signal?: AbortSignal },
  ) => Effect.Effect<
    {
      readonly document: RichContentDocument
      readonly diagnostics: ReadonlyArray<RichContentDiagnostic>
    },
    RichContentValidationError
  >

  readonly validateForWrite: (
    source: string,
  ) => Effect.Effect<void, RichContentValidationError>
}

export const RichContentService = Context.Service<RichContentService>("RichContentService")
```

`render` intentionally has no expected failure channel. It catches parser and resolver failures at block scope, records safe telemetry, and returns a valid document. Defects still reach existing global defect reporting.

### Resolver seams

```ts
export interface MusicEmbedResolver {
  readonly resolve: (
    reference: Extract<EmbedReference, { readonly _tag: "MusicUrl" | "MusicCatalog" }>,
    options?: { readonly signal?: AbortSignal },
  ) => Effect.Effect<MusicSnapshot, EmbedLookupError>
}

export interface MediaEmbedResolver {
  readonly resolve: (
    reference: Extract<EmbedReference, { readonly _tag: "ExternalMedia" }>,
    options?: { readonly signal?: AbortSignal },
  ) => Effect.Effect<
    Extract<RichContentBlock, { readonly _tag: "ExternalMediaEmbed" }>,
    EmbedLookupError
  >
}
```

These are real seams because they cross database and provider boundaries. Tests provide recording or deterministic fake Layers through these interfaces. The parser itself needs no dependency interface.

### Additive API response contract

Add the same optional field to content-bearing API records first:

```ts
const RichContentField = {
  richContent: Schema.optional(RichContentDocument),
}

export const CompiledPostResponse = Schema.Struct({
  ...PostResponse.fields,
  compiledContent: Schema.String,
  ...RichContentField,
  creators: Schema.optional(Schema.Array(Creator)),
  replyCount: Schema.optional(Schema.Number),
})
```

Apply it to:

- `CompiledPostResponse`, editorial, micro, reply, thread, and tweet screen nested post records.
- `CompiledAudioResponse` and public audio detail records that render content.
- `CompiledShowResponse` and resolved show detail.
- `CompiledReleaseResponse`.
- `LabelResponse` for public label detail.

Do not enrich lightweight listings that do not render the body. If an existing endpoint uses one schema for both list and detail, the field remains optional and the service projects it only for detail or screen paths. This controls payload size and provider work.

Keep `compiledContent` unchanged until WWW is deployed on `richContent` and production telemetry confirms no legacy client still requires it. Its eventual removal is a separate breaking API decision.

### Preview endpoint

```ts
export const RichContentPreviewInput = Schema.Struct({
  source: Schema.String,
  context: Schema.Literals(["post", "audio", "show", "release", "label"]),
})

export const RichContentPreviewResponse = Schema.Struct({
  document: RichContentDocument,
  diagnostics: Schema.Array(RichContentDiagnostic),
})

POST /api/content/rich-content/preview
Authorization: existing creator permission
Body: RichContentPreviewInput
Success: RichContentPreviewResponse
Errors: 401, 403, 413, 422, 503
```

The preview endpoint is additive and non-persistent. It accepts caller cancellation. Rate limits and maximum source size match write validation. The editor debounces requests and cancels superseded previews.

### Write validation

Create and update handlers keep their current request shape. Before persistence, each service calls `validateForWrite` when `content` is present.

At hard cutover, all write paths become canonical-only together:

- Legacy JSX, raw HTML, unknown directives, and unknown attributes return 422 with safe diagnostics.
- Source size violations return 413; structural limit violations return 422.
- The cutover does not proceed while the migration audit contains an unresolved record, so the runtime never needs to preserve or accept a second source language.

## Canonical Syntax and Migration Contract

### Canonical directives

| Directive | Required attributes | Optional attributes | Result |
| --- | --- | --- | --- |
| `track`, `album`, `playlist` | Exactly one of `url` or `id` | `genres`, `blurb`, `tracks` | `MusicEmbed` |
| `music` | `type`, `id` | `tracks` | `MusicEmbed` |
| `media` | `url` | None | `ExternalMediaEmbed` |
| `tracklist` container | Ordered or unordered list children | None | `Tracklist` |
| `cards` container | Embed directives or standalone provider URLs | None | `CardGroup` |

`genres` is a comma-separated string normalized by trim, empty removal, stable order, and duplicate removal. `tracks` accepts only the strings `true` and `false`. Unknown attributes produce an inert unsupported block during tolerant reads and fail write validation.

### Standalone URL rule

A paragraph auto-embeds only when it contains exactly one URL and no other inline content. Supported canonical forms are:

- Spotify track, album, and playlist URLs.
- YouTube watch, short, embed, and `youtu.be` video URLs.
- SoundCloud track and playlist URLs.
- Bandcamp album, track, and already normalized embedded-player URLs.

Spotify episodes and shows remain external Spotify players because the GBFM catalog types only cover track, album, and playlist.

### Migration-only legacy JSX extraction

The conversion tool parses the legacy document only to find candidate nodes, then parses each isolated candidate as an MDX JSX fragment or strict HTML fragment. It never compiles or evaluates the fragment. It accepts:

- Quoted string attributes.
- JSX expression containers containing only a string, number, or boolean literal.
- Template literals with no expressions.
- Array literals containing only string literals, for `genres` and `tracks`.
- Static child embed elements inside `HorizontalScrollCards`.
- Legacy provider iframes with one literal `src` for YouTube, YouTube nocookie, SoundCloud, Bandcamp, Spotify, Apple Music, or Tidal.
- Presentational `div` wrappers, `hr`, and `br` when they have a deterministic inert Markdown equivalent.

It rejects:

- Imports, exports, and JavaScript expressions outside an allowlisted component.
- Identifiers, member access, calls, operators, conditionals, interpolated template literals, objects, spreads, functions, and event props.
- Unknown components or props.
- Dynamic children.

Mapping:

| Legacy component | Typed result |
| --- | --- |
| `Track`, `Album`, `Playlist` | `MusicUrl` reference with literal `url`, `genres`, and `blurb` |
| `MusicEntity` | `MusicCatalog` reference with literal `type`, `id`, and display booleans |
| `YoutubeEmbed` | `ExternalMedia` reference built from a validated literal video ID |
| `ExternalMedia` | `ExternalMedia` reference. The provider prop must agree with the parsed URL |
| `Tracklist` | `Tracklist` from a literal string array |
| `HorizontalScrollCards` | `CardGroup` containing only successfully extracted child embeds |
| Spotify track, album, or playlist iframe | Matching catalog directive using its canonical Spotify URL |
| YouTube, SoundCloud, or Bandcamp iframe | `ExternalMedia` reference using a validated literal URL |
| Apple Music or Tidal iframe | Ordinary safe provider link because there is no first-class player contract |
| Presentational `div`, `hr`, or `br` | Unwrapped children, thematic break, or Markdown line break |

`MusicEntityPending` is editor-temporary syntax. A saved record containing it fails automatic conversion and enters manual review. Conversion never mutates the catalog.

An empty historical `<Track />` has no recoverable identity and degrades to inert explanatory copy. An empty Markdown link is likewise preserved as inert text instead of becoming a malformed link. These known historical cases are explicit conversion rules, not general error suppression.

The old trusted SoundCloud iframe form recognized by `apps/www/src/rich-content.ts` gets one static conversion rule. Its `src` must parse to the exact `https://w.soundcloud.com/player/` origin and path with a valid SoundCloud API track URL. Any adjacent attribution HTML must have an explicitly tested canonical projection or the record enters manual review.

## Seams, Boundaries, Adapters, and Implementations

### Source parsing boundary

Input is an untrusted string. `@gbfm/rich-content/source` uses `unified`, `remark-parse`, `remark-gfm`, and `remark-directive`. `remark-directive` is a new direct dependency. The canonical projector walks the mdast and constructs only the tagged unions above.

The canonical projector does not use `remark-rehype`, `rehype-raw`, `dangerouslySetInnerHTML`, JSX runtime output, or generated JavaScript. Raw mdast HTML nodes become `Unsupported`.

### Migration boundary

`legacy-mdx.ts` receives only isolated candidate fragments, not the whole document. It uses the existing MDX parser stack to obtain syntax nodes, then performs an exhaustive literal-only projection. It is imported only by the conversion tool and tests. Any failed candidate marks the record unresolved instead of emitting partially converted source.

### URL boundary

One domain function parses all links, images, and media URLs:

```ts
type UrlPurpose = "link" | "image" | "media"

declare const parseSafeUrl: (
  value: string,
  purpose: UrlPurpose,
) => Effect.Effect<SafeUrl, UnsafeUrlError>
```

- Links allow `https`, `http`, `mailto`, and site-relative paths.
- Images allow `https` and site-relative paths. Data, blob, file, and SVG data URLs are rejected.
- Media uses provider-specific exact host and path validators.
- Credentials and unexpected ports are rejected.
- Renderer-created outbound links use `rel="noopener noreferrer"`.

### Catalog and provider adapters

`apps/server/src/services/rich-content-music.service.ts` composes `CanonicalMusicIdentityRepository` with existing track, album, playlist, link, and playlist-track queries.

Resolution order:

```text
catalog id reference
  -> get entity by id
  -> get verified links
  -> get tracks only when requested and applicable

Spotify URL reference
  -> normalize provider type and ID
  -> look up the resolved canonical identity claim
  -> require matching entity type and entity ID
  -> project the existing catalog entity
  -> otherwise return UnavailableEmbed
  -> never call Spotify, import, scrape, or write
```

Independent embeds resolve concurrently with bounded concurrency. The implementation limit is 8 because all runtime music work is bounded database lookup and projection. Keep the limit internal rather than exposing general configuration.

### Caching

Use the existing bounded caches inside `MdxService`:

```ts
compiled compatibility cache:
  key source string
  capacity 256
  success TTL 1 hour
  failure TTL zero

render cache:
  key source string
  capacity 256
  TTL 1 hour
```

The render schema is versioned inside the cached value, and a deployment starts new Worker isolates, so source plus deployed revision is a sufficient first cache key. In-memory cache is intentionally per Worker isolate or Bun process. Do not add KV, D1, Durable Objects, cache tables, source hashing, or reverse invalidation for the first version.

### Renderer boundary

WWW rendering is a total function:

```ts
export const richContentView = (
  document: RichContentDocument,
  h: HtmlBuilder<Message>,
  options?: RichContentViewOptions,
): Html
```

It exhaustively maps every tag to `foldkit/html` inert nodes. `ExternalMediaEmbed.embedUrl` may only become the `src` of the corresponding iframe renderer. The iframe supplies fixed `allow`, `sandbox` where provider behavior permits it, `referrerPolicy`, `loading`, and aspect ratio. Author source controls none of those attributes.

The mobile renderer, when needed, maps the same document to React Native `Text`, `View`, `Image`, and explicit link or media components. It never imports parser modules.

## Call Stacks and Data Flow

### Current old flow

```text
author text
  -> create or update API
  -> raw content text column
  -> MdxService.compile on read
  -> compiledContent JavaScript string
  -> API response
  -> MDXRendrr.runSync in reader browser
  -> React component registry
  -> per-embed browser fetches
  -> DOM
```

Current Foldkit flow:

```text
raw content API field
  -> apps/www entry.server contentItems
  -> Foldkit Flags JSON
  -> apps/www rich-content.ts regex parser
  -> inert HTML with partial syntax support
```

### Author save flow

```text
CodeMirror or textarea source
  -> Creator Save Command
  -> existing create or update API DTO with content string
  -> Effect Schema request decode
  -> RichContentService.validateForWrite(content)
  -> canonical GFM/directive parser
  -> typed diagnostics
  -> domain service authorization and existing persistence transaction
  -> unchanged content text column
  -> existing response plus optional richContent projection
```

Validation happens before persistence but after request decoding and authorization context construction. No external provider request is required to save a draft. Resolution happens for preview and reads, not as a prerequisite for durable storage.

### Editor preview flow

```text
source edit
  -> debounced Foldkit Command
  -> cancel prior request
  -> POST /api/content/rich-content/preview
  -> authorization
  -> parse and resolve through RichContentService.preview
  -> RichContentPreviewResponse
  -> Effect Schema decode in WWW
  -> richContentView(document)
  -> diagnostics beside source editor
```

The debounce target is 300 ms. A stale preview response carries the editor revision in local command state and is ignored if it no longer matches. No preview result is persisted.

### Public read SSR flow

```text
GET /editorial/:slug
  -> Foldkit entry.server endpoint selection
  -> API getEditorialPostBySlug
  -> PostService reads post and creators
  -> RichContentService.render({ source, context: "post" })
  -> parse cache
  -> bounded parallel embed resolution
  -> render cache
  -> API DTO with content, compiledContent, richContent
  -> entry.server decodes DTO
  -> Flags include RichContentDocument
  -> application view maps document to inert Foldkit HTML
  -> SSR response
  -> client hydrates the same Flags and document
```

There is no reader-side parser and no embed metadata fetch during hydration.

### Client navigation flow

```text
Foldkit RequestedUrl
  -> page Load Command fetches URL with __data=1
  -> entry.server performs the same API request and Schema decode
  -> serialized Flags with richContent
  -> LoadedPage
  -> same richContentView function
```

SSR and navigation differ only in transport ownership. They use the same API document and view mapper.

### Tweet and reply flow

```text
tweet screen API
  -> resolve root, focus, visible thread posts, and replies
  -> RichContentService.render for each non-empty body with bounded service concurrency
  -> nested post DTOs each carry optional richContent
  -> tweet-card maps each document
```

Post-level attached music remains its existing structured `musicEntityType` and `musicEntityId` card. It is not duplicated into body rich content. Body embeds remain body blocks.

### Changelog flow

```text
CHANGELOG.md
  -> repo-changelog Vite plugin load
  -> @gbfm/rich-content/source at build time
  -> RichContentDocument serialized by virtual module
  -> Foldkit Flags
  -> richContentView
```

The changelog does not need the API service. If it later includes embeds requiring external resolution, move changelog enrichment to a build script with explicit adapters rather than adding browser parsing.

### Pre-cutover legacy conversion flow

```text
raw source containing <Track ... />
  -> migration scanner isolates an HTML-like candidate
  -> migration-only legacy candidate parser
  -> allowlisted component name
  -> literal-only prop decoder
  -> canonical ::track directive
  -> canonical parser semantic comparison
  -> verified replacement source or unresolved-record report
```

Rejected expressions do not produce a partial rewrite. The whole record enters manual review. After the hard cut, runtime requests never invoke this flow.

### Failure flow

```text
malformed GFM or directive
  -> parser keeps valid surrounding blocks
  -> Unsupported block for the local source
  -> warning telemetry without source
  -> HTTP 200 public page

catalog identity or entity missing
  -> typed EmbedLookupError
  -> UnavailableEmbed with safe label and validated fallback URL
  -> contained inside the cached render document
  -> HTTP 200 public page

unexpected parser defect
  -> catch at RichContentService.render boundary
  -> safe plain-text paragraph document
  -> existing Sentry defect reporting
  -> HTTP 200 content response when the underlying record read succeeded
```

The safe plain-text fallback is built by splitting source into bounded text paragraphs and encoding it as `Text` nodes. It is not HTML and does not run inline Markdown parsing.

### Retry, cancellation, and idempotency flow

- Reads are side-effect free, so provider retries cannot duplicate state.
- Runtime rendering does not call Spotify and adds no provider retry loop.
- Caller cancellation reaches parse orchestration, bounded embed resolution, catalog calls where supported, and preview requests.
- Cache lookup work is shared. Cancellation of one waiter must not corrupt the cached result for other waiters.
- Save requests retain existing idempotency behavior. Rich content validation performs no writes.
- The migration normalizer is idempotent: normalizing canonical output again returns `changed: false`.

### Observability flow

Use existing Effect spans and request correlation:

```text
richContent.render
  attributes:
    rich_content.context
    rich_content.source_length
    rich_content.schema_version
    rich_content.cache_status
    rich_content.block_count
    rich_content.embed_count
    rich_content.diagnostic_count

richContent.resolveEmbed
  attributes:
    rich_content.embed_kind
    rich_content.provider
    rich_content.resolution_source = catalog | unavailable
    rich_content.cache_status
    error_tag when failed
```

Metrics or log summaries should count:

- parse cache hit and miss;
- render cache hit and miss;
- unsupported blocks by reason;
- embed resolution failures by provider and reason;
- render duration and provider duration;
- fallback document count.

Never record source, blurb, code, title, full URL, directive attributes, document JSON, or provider response. Safe identifiers may include internal entity ID only where current telemetry policy already permits it.

## Security Model

### Trust boundaries

1. Author source is untrusted even when an authenticated creator wrote it.
2. Database text remains untrusted when read back.
3. Provider metadata and catalog rows are parsed before entering a render snapshot.
4. API `richContent` is decoded by Effect Schema in WWW and mobile.
5. Renderers accept only the decoded tagged union.

### Controls

- No `run`, `runSync`, `eval`, `Function`, dynamic import, generated JavaScript, or JSX runtime receives authored content.
- No `dangerouslySetInnerHTML` or raw HTML projection.
- The migration-only legacy parser inspects syntax only and accepts literals only.
- Exhaustive directive and prop allowlists.
- Central URL parsing with purpose-specific protocols and exact media hosts.
- Iframe source is constructed by trusted adapters rather than copied from author markup.
- No author-controlled class, style, event, width, height, `allow`, `sandbox`, or `srcdoc` reaches a renderer.
- External links receive safe rel attributes.
- Images have lazy loading and descriptive alt text. Unsupported or unsafe image URLs become alt text, not broken executable markup.
- Default limits: 100 KiB source, 2,000 blocks, nesting depth 12, 100 table rows, 20 table columns, 50 embeds, 100 tracklist entries, and 2,000 characters per directive attribute.
- Bounded embed concurrency prevents provider and database fan-out.
- Preview endpoint uses existing creator authorization and request size controls.

The limits are named constants with behavior tests. They are not exposed as general configuration.

## Files to Add, Change, and Delete

### Add

| File | Responsibility |
| --- | --- |
| `packages/rich-content/package.json` | Workspace package and parser/schema subpath exports |
| `packages/rich-content/tsconfig.json` | Strict package TypeScript configuration |
| `packages/rich-content/src/schema.ts` | Versioned render DTO and Effect Schemas |
| `packages/rich-content/src/source.ts` | GFM/directive parse and projection |
| `packages/rich-content/src/legacy-mdx.ts` | Literal-only JSX reader imported only by conversion tooling |
| `packages/rich-content/src/normalize.ts` | Canonical source converter for migration tooling |
| `packages/rich-content/src/limits.ts` | Source and structure limits |
| `packages/rich-content/src/source.test.ts` | Parser behavior and security tests |
| `packages/rich-content/src/legacy-mdx.test.ts` | Legacy conversion safety tests |
| `packages/rich-content/src/normalize.test.ts` | Normalization idempotence tests |
| `apps/server/src/services/rich-content-music.service.ts` | Read-only canonical identity and GBFM catalog projection |
| `apps/server/src/services/rich-content-music.service.d1.test.ts` | Resolver behavior against migrated D1 |
| `apps/www/src/rich-content/render.ts` | Total Foldkit typed document renderer |
| `apps/www/src/rich-content/render.test.ts` | Renderer module behavior, not route tests |
| `scripts/export-rich-content.sql` | Read-only union query for every stored content kind |
| `scripts/normalize-rich-content.ts` | Offline JSON conversion, validation, and guarded SQL generation |
| `docs/specs/rich-content.md` | Architecture, cutover commands, smoke checks, and restoration requirements |

### Change

| File or area | Change |
| --- | --- |
| `packages/api/src/post.ts` | Add rich content document to post and nested screen contracts; add preview contract if API organization keeps it here |
| `packages/api/src/audio.ts` | Add optional `richContent` to applicable detail contract |
| `packages/api/src/shows.ts` | Add optional `richContent` to detail and resolve contracts |
| `packages/api/src/release.ts` | Add optional `richContent` to detail contract |
| `packages/api/src/music.ts` | Add optional `richContent` to label detail contract |
| `packages/api/src/resolve.ts` | Replace compiled-only resolved show shape with additive rich content field |
| `apps/server/src/lib/mdx.ts` | Add typed parse, resolution, caching, validation, and compatibility behavior to `MdxService` |
| `apps/server/src/runtime/services.ts` | Provide `MdxServiceCatalogLayer` and `RichContentMusicResolverLayer` |
| Content services | Project `richContent` on public detail and screen reads and validate source on writes |
| HTTP route registration and docs | Register preview endpoint and map validation errors to 413 or 422 |
| `apps/www/src/application.ts` | Put `RichContentDocument` in `ContentItem` and `Flags`; render it instead of parsing source |
| `apps/www/src/entry.server.ts` | Decode additive API rich content fields and supply fallback documents only when absent |
| `apps/www/src/tweet-card.ts` | Render tweet and reply documents |
| `apps/www/src/creator/model.ts` | Add preview state, revision, messages, and Command lifecycle |
| `apps/www/src/creator/services.ts` | Add preview request operation with cancellation |
| `apps/www/src/creator/view.ts` | Restore CodeMirror authoring, canonical embed insertion, preview, and diagnostics incrementally |
| `apps/www/plugins/repo-changelog.ts` | Export a build-time parsed document rather than raw Markdown |
| `apps/www/src/virtual-modules.d.ts` | Type changelog virtual module as `RichContentDocument` |
| `apps/www/e2e/content-and-account.spec.ts` | Verify rendered GFM and inert unsafe content |
| `apps/www/e2e/creator-edit.spec.ts` | Verify canonical embed authoring and preview |
| Relevant server black-box tests | Assert additive documents and unchanged raw fields |

### Delete or isolate after hard cut

| File or dependency | Timing |
| --- | --- |
| `apps/www/src/rich-content.ts` | Delete when all callers use `rich-content/render.ts` |
| `apps/server/src/lib/mdx.ts` and `mdx.test.ts` | Delete after the hard cut when existing-client policy permits stopping `compiledContent` generation |
| `@mdx-js/mdx`, `@mdx-js/rollup`, and `@types/mdx` from `apps/www` | Delete when no build content or legacy editor imports them |
| `@mdx-js/mdx` from `apps/server` | Remove from runtime dependencies. Any parser needed by conversion tooling belongs only to `packages/rich-content` or the script workspace |
| `compiledContent` generation code | Delete after a measured compatibility window |
| `compiledContent` API fields | Separate breaking cleanup after owner approval |

Do not delete the catalog services, display components, or CodeMirror packages merely because the old React routes are gone. Reuse the valuable authoring behavior behind the new contract where practical.

## RGR TDD Test Plan

Each slice is Red, Green, Refactor before the next slice. Tests assert structural values and rendered accessibility or DOM outcomes. No test assertion uses regex. No route or page file gets a unit test.

### Slice 1: GFM document contract

Red: through `parseRichContent`, parse one asymmetric document containing emphasis, an ordered nested list starting at 3, an image, and a table. Assert the exact tagged structure and safe URLs.

Green: add the package, schema, parser, and smallest mdast projection.

Refactor: centralize recursive inline and block conversion.

Plausible wrong implementation caught: flattening ordered or nested lists into unordered siblings, or losing table alignment.

### Slice 2: Unsafe input is inert

Red: parse raw script HTML, a JavaScript link, an SVG data image, and ordinary prose containing braces and less-than signs. Assert unsupported or text nodes, no unsafe URL node, and preserved prose.

Green: add raw HTML handling and purpose-specific URL parsing.

Refactor: isolate URL policy and unsupported-node construction.

Plausible wrong implementation caught: sanitizing only script tags while allowing executable URLs or failing ordinary prose because it resembles MDX.

### Slice 3: Canonical directives and standalone URLs

Red: parse a standalone Spotify track URL and the same URL inside a sentence. Assert the first becomes an embed reference and the second remains a link. Add a directive with genres in nontrivial order and `tracks="false"`.

Green: add `remark-directive`, directive decoding, and paragraph promotion.

Refactor: share music reference construction.

Plausible wrong implementation caught: auto-embedding every URL or interpreting comma-separated genres inconsistently.

### Slice 4: Migration-only static extraction

Red: cover all eight legacy component forms with literal props. Add rejected cases for a spread, identifier, function call, event prop, unknown component, malformed sibling, and braces in unrelated prose. Assert valid neighbors still parse.

Green: implement isolated fragment parsing and exhaustive literal projection in the conversion-only export.

Refactor: one literal decoder and one component mapping table.

Plausible wrong implementation caught: parsing the entire document as MDX, accepting one executable expression, or losing the whole page because one legacy block is malformed.

### Slice 5: Normalizer idempotence

Red: normalize mixed legacy and canonical source, then normalize the output again. Assert the second output is byte-identical and `changed` is false. Assert prose outside converted blocks is preserved.

Green: implement canonical directive serialization.

Refactor: reuse directive attribute escaping.

Plausible wrong implementation caught: source churn on every migration run or unintended prose formatting changes.

### Slice 6: Server resolution through real seams

Red: provide deterministic fake `MusicEmbedResolver` and `MediaEmbedResolver` Layers. Render a document with two successful embeds and one failed embed. Assert successful snapshots, one local unavailable block, and preserved surrounding blocks.

Green: implement traversal and block-local failure containment.

Refactor: add bounded concurrency without changing output order.

Plausible wrong implementation caught: one provider error failing the page, output reordering under concurrency, or unbounded fan-out.

### Slice 7: Cache semantics

Red: use a recording resolver and test concurrent identical renders, changed source, schema version change, negative TTL, and cancellation of one waiter. Assert semantic results and recorded calls through the seam.

Green: add Effect caches.

Refactor: separate key construction from cache storage.

Plausible wrong implementation caught: stale reuse after edits, permanent negative caching, or cancellation poisoning shared work.

### Slice 8: Additive API projection

Red: extend server black-box tests for editorial, tweet screen with replies, audio detail, show detail, release detail, label detail, and resolved show. Assert both raw `content` and decoded `richContent` are present. Existing mobile-consumed listing schemas must still decode.

Green: wire service projections and API schemas.

Refactor: use one projection function across entity services.

Plausible wrong implementation caught: replacing `content`, enriching only top-level tweet records, or breaking list/mobile schemas.

### Slice 9: Write validation and preview

Red: handler tests prove an authorized creator can preview without persistence, unauthorized users cannot preview, invalid directives return typed diagnostics, and ordinary braces save successfully. Use the existing HTTP test seam and local D1 only for confirming no row changes.

Green: add preview contract, handler, and write validation.

Refactor: share error-to-HTTP mapping.

Plausible wrong implementation caught: preview writing data, MDX-like prose rejection, or authorization bypass.

### Slice 10: Foldkit renderer

Red: call the renderer module with every block and inline variant. Assert inert HTML structure and accessibility facts, including heading levels, ordered list start, image alt, table semantics, outbound link rel, iframe title, and unavailable fallback. Assert no authored class or iframe URL can be introduced because the schema has no such field.

Green: implement exhaustive Foldkit mappings.

Refactor: extract coherent block views, not one-use wrappers.

Plausible wrong implementation caught: heading collapse, hydration-unstable output, missing table semantics, or unsafe media attributes.

### Slice 11: SSR and client navigation

Red: Playwright creates or serves representative canonical editorial content converted from a legacy fixture, loads it directly, then reaches it through client navigation. Assert equivalent visible structure, no source directive text, no page error, no client Spotify metadata requests, and no executable marker side effect. Include a malformed canonical directive adjacent to valid Markdown.

Green: switch `entry.server.ts`, `application.ts`, and `tweet-card.ts` to render documents.

Refactor: remove the regex mini-renderer.

Plausible wrong implementation caught: SSR and navigation using different projections or hidden client parser/fetch behavior.

### Slice 12: Editor preview and insertion

Red: Playwright enters GFM, inserts a music directive, sees server preview output and a diagnostic for an invalid directive, then saves and reloads source unchanged.

Green: add preview Command, CodeMirror integration, and canonical insertion controls.

Refactor: reuse source snippets from the shared authoring syntax module if that removes real duplication.

Plausible wrong implementation caught: previewing locally with a different parser, stale preview races, or source mutation during preview.

### Slice 13: Migration dry run

Red: run the script against a disposable migrated D1 fixture containing every content table and legacy syntax. Assert the report counts, normalized output, idempotent second run, unchanged non-content columns, and rollback fixture integrity.

Green: implement dry-run report and explicit apply mode for a local file-backed database only.

Refactor: stream records table by table with bounded memory.

Plausible wrong implementation caught: touching the wrong table, partial conversion, non-idempotence, or accidental default writes.

### Verification commands per implementation commit

Use focused tests during each RGR cycle, then:

```sh
bun --filter @gbfm/rich-content test
bun --filter @gbfm/server test:unit
bun --filter @gbfm/server test:d1
bun --filter @gbfm/www unit
bun --filter @gbfm/www e2e
bun precommit
```

Run the full WWW build before switching traffic:

```sh
bun --filter @gbfm/www build
```

## Phased Rollout

Each implementation phase is one atomic, reviewable, independently green commit. Do not combine phases. Commits marked as held are merged or retained together but are not deployed until the hard-cut operation.

### Phase 1: Add the shared render contract

Add the `packages/rich-content` workspace, versioned Effect Schemas, limits, package exports, and contract fixtures. Do not add parsing or runtime callers. Ship-safe because the package is unused.

### Phase 2: Add GFM parsing and URL policy

Add CommonMark and GFM projection, purpose-specific safe URL parsing, unsupported-node handling, and focused tests. Do not add custom embeds yet.

### Phase 3: Add canonical embed syntax

Add `remark-directive`, directive decoding, standalone provider URL promotion, normalization serialization for canonical nodes, and focused tests. This commit defines the single forward authoring language.

### Phase 4: Add migration-only legacy conversion

Add literal-only extraction for the eight legacy JSX components, static template literals, known provider iframes, presentational wrappers, `hr`, and `br`, plus adversarial and conversion-idempotence tests. Export it only to scripts and tests. Runtime source parsing remains canonical-only.

### Phase 5: Add the server orchestration service

Extend the existing `MdxService` boundary with typed rendering, bounded traversal, block-local fallback, a render cache, and deterministic tests. Add `RichContentMusicResolver` as the read-only catalog seam. Keep the compatibility `compile` operation active. Existing APIs remain unchanged.

### Phase 6: Add additive rich content API contracts

Add optional `richContent` to the applicable API response schemas and preview contracts. Keep `content` and `compiledContent`. Do not switch service projections yet. Existing clients continue to decode the same payloads.

### Phase 7: Add the Foldkit renderer

Add the exhaustive WWW render module and module tests without changing page callers. It accepts only `RichContentDocument` and has no source parser dependency.

### Phase 8: Wire server projections and preview

Project documents onto editorial, tweet screens and replies, audio detail, show detail and resolve results, release detail, and label detail. Add canonical write validation and the authenticated preview endpoint. Do not enrich lightweight lists. Add black-box coverage and current mobile schema compatibility. This commit is held for the coordinated cutover because live rows are not canonical yet.

### Phase 9: Wire all WWW readers and changelog

Carry documents through Foldkit Flags and switch editorial, tweet, reply, generic detail, label, release, mix, and track views. Parse changelog at build time. Delete `apps/www/src/rich-content.ts`. Add end-to-end SSR, hydration, navigation, security, and converted-fixture coverage. This commit is held for the coordinated cutover.

### Phase 10: Restore rich authoring ergonomics

Port CodeMirror, Markdown commands, canonical directive insertion, paste-to-embed behavior, and debounced server preview into the Foldkit creator model using Commands. Do not restore browser MDX compilation or client overlay widgets that fetch metadata independently. This commit is held for the coordinated cutover.

### Phase 11: Add and verify conversion tooling

Add `scripts/export-rich-content.sql` and `scripts/normalize-rich-content.ts`. The SQL exports only stable content identities and source. The Bun script reads JSON, normalizes every record, validates canonical output, writes normalized JSON, and optionally writes guarded SQL. Rehearse against an export copy, inspect visual samples, and run a second normalization pass. Produce the cutover report. Do not update production content in this phase.

### Phase 12: Resolve every conversion exception

Manually specify canonical replacements for every record the converter cannot prove equivalent, add each shape as a fixture when generally useful, and rerun against the exported corpus. The hard-cut gate is zero unresolved records and zero unexplained semantic differences.

### Phase 13: Finalize the cutover revision

Add the reviewed cutover runbook, run the full package, server, D1, WWW, end-to-end, build, and `bun precommit` checks against a canonical converted fixture, and include only fixes required by integrated verification. The runbook records how the operator pins the exact server and WWW revisions before approval. This commit remains held for cutover.

### Phase 14: Remove runtime MDX compilation

After the hard cut is healthy and client compatibility policy permits it, remove `MdxService` calls and runtime MDX dependencies. Continue returning `compiledContent: ""` until its separate contract removal. The conversion-only parser remains isolated from runtime package exports.

### Phase 15: Later API cleanup

After deployed-client policy permits it, make `richContent` required on applicable detail responses and remove `compiledContent` from API contracts. This breaking change is independent of source conversion and must not be folded into the hard cut.

### Hard-cut operation after Phase 13

This is an operational action, not a code phase. Production content conversion requires separate owner approval. Before the window, finish catalog bootstrap and confirm that every supported Spotify reference either resolves to a GBFM entity or has an explicit editorial decision. During the window, pause writes and traffic, take and verify a D1 export, deploy the recorded additive server and WWW revisions, immediately run the guarded text conversion, run smoke checks, and resume traffic. If conversion, deployment, or smoke checks fail, restore the backup and prior revisions before reopening traffic. There is no supported mixed-format runtime window.

## One-Off Content Conversion Design

`scripts/export-rich-content.sql` reads only the five content-bearing tables and emits a portable array shape:

```ts
type ExportRecord = {
  readonly kind: "post" | "audio" | "show" | "release" | "label"
  readonly id: string
  readonly content: string | null
}
```

The normalizer never connects to a database:

```sh
bun scripts/normalize-rich-content.ts export.json normalized.json migration.sql
```

It reports record, changed, and unresolved counts to stdout. Any unresolved conversion or canonical parser diagnostic exits nonzero and no SQL is written. When clean, optional SQL output contains one statement per changed record:

```sql
UPDATE "posts"
SET "content" = '<canonical source>'
WHERE "id" = '<record id>'
  AND "content" = '<exact exported legacy source>';
```

The exact old-content guard makes each update compare-and-set and idempotent. A concurrent edit after export does not get overwritten. The post-apply export is the authoritative check for guarded statements that matched no row.

### Rehearsal result

The 2026-09-28 read-only production-content rehearsal exported 247 public records. The final converter changed 108 records and reported 0 unresolved records. A fresh scan of canonical output found 247 unique Spotify track, album, or playlist identities. Authenticated catalog bootstrap resolved 241 to GBFM entities and accepted sync jobs for all 51 resolved playlists. One album returned provider unavailable and five removed or private playlists returned bad request. The owner chose to retain all six references, so each now has a manually created GBFM entity with a verified exact-source Spotify identity. The non-secret initial report is `.amp/in/artifacts/rich-content-catalog-bootstrap.json`. Visual verification must cover representative editorial content, especially `/editorial/lack`, before production content is rewritten.

Per record, the tool:

1. Read source and stable identity.
2. Normalize statically recognized legacy syntax.
3. Parse the normalized source through the canonical parser.
4. If conversion or parser diagnostics remain, report the record and exit without SQL.
5. If unchanged, preserve the record in normalized JSON and emit no SQL.
6. If changed, preserve the new source in normalized JSON and emit one guarded update.

The target end state is not a partially migrated dual-format corpus. Any skipped record enters a finite manual-review queue. The owner corrects or explicitly rewrites those records in canonical source, reruns the dry run, and proceeds to canonical-only write enforcement only when the audit reports zero legacy records.

Rehearsal and cutover verification include:

- a fresh full D1 SQL export before any update;
- row counts before and after;
- successful parser output for every changed row;
- a second normalization pass with zero proposed changes and byte-equivalent normalized JSON;
- the generated SQL retained with the reviewed release artifacts;
- selected visual comparisons in WWW for editorial, tweet, mix, release, label, and malformed fallback cases.

## Post-Deploy Activation Commands

Production content writes are external state and require explicit approval at execution time. Run these commands from the exact deployed revision during the write and traffic freeze. Replace the one placeholder with the `databaseName` printed by the production Alchemy deployment. Do not substitute a database ID.

```sh
set -euo pipefail

export DB_NAME='<Alchemy production databaseName>'
export CUTOVER_DIR=".amp/rich-content-cutover-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$CUTOVER_DIR"

# 1. Create the full restoration artifact before any content update.
bunx wrangler d1 export "$DB_NAME" \
  --remote \
  --output "$CUTOVER_DIR/pre-cutover.sql"
test -s "$CUTOVER_DIR/pre-cutover.sql"

# 2. Export only content rows in the normalizer's portable JSON shape.
bunx wrangler d1 execute "$DB_NAME" \
  --remote \
  --file scripts/export-rich-content.sql \
  --json > "$CUTOVER_DIR/export-response.json"
jq '[.[].results[] | {kind, id, content}]' \
  "$CUTOVER_DIR/export-response.json" > "$CUTOVER_DIR/content-before.json"

# 3. Normalize locally and generate compare-and-set updates.
bun scripts/normalize-rich-content.ts \
  "$CUTOVER_DIR/content-before.json" \
  "$CUTOVER_DIR/content-normalized.json" \
  "$CUTOVER_DIR/migration.sql"
test -s "$CUTOVER_DIR/migration.sql"

# 4. Apply only the reviewed guarded updates.
bunx wrangler d1 execute "$DB_NAME" \
  --remote \
  --file "$CUTOVER_DIR/migration.sql"

# 5. Re-export and prove the live corpus is canonical and stable.
bunx wrangler d1 execute "$DB_NAME" \
  --remote \
  --file scripts/export-rich-content.sql \
  --json > "$CUTOVER_DIR/post-response.json"
jq '[.[].results[] | {kind, id, content}]' \
  "$CUTOVER_DIR/post-response.json" > "$CUTOVER_DIR/content-after.json"
bun scripts/normalize-rich-content.ts \
  "$CUTOVER_DIR/content-after.json" \
  "$CUTOVER_DIR/content-after-normalized.json"
cmp "$CUTOVER_DIR/content-after.json" "$CUTOVER_DIR/content-after-normalized.json"

# 6. Keep the directory intact, run the smoke checks below, then resume traffic and writes.
printf 'Cutover artifacts: %s\n' "$CUTOVER_DIR"
```

The second normalizer invocation must print `changed: 0` and `unresolved: 0`. `cmp` must exit 0. Then smoke test direct load and client navigation for `/editorial/lack`, one tweet thread, one mix, one release, and one label. Confirm music cards have title, artwork, and links; no directive or JSX source is visible; and browser network logs show no reader-side Spotify metadata request.

The catalog bootstrap is separate from content rewriting and should already be complete before deployment. If a final pre-cutover inventory finds a new Spotify music identity, an authenticated admin resolves it through `POST /api/music/resolve` with `{ "url": "...", "origin": "editorial" }`. For each returned playlist entity ID, enqueue `POST /api/music/playlists/:id/sync-links` and wait for the existing enrichment queue. Do not put provider resolution into the SQL migration or public read path.

## Operational Rollback

- Before the hard cut, rollback means discarding or reverting the held runtime commits. Production data and behavior remain unchanged.
- The hard cut occurs with traffic and writes paused. A failed conversion, deploy, or smoke check restores the verified backup and prior server and WWW revisions before traffic resumes.
- The approved conversion retains both the full D1 export and `content-before.json`, which contains every original source value keyed by content kind and record ID. Restoration is an explicit owner-approved operation.
- `compiledContent` and its generator remain through the hard cut for existing API clients. Their later removal has its own rollback commit and does not require data restoration.
- Canonical source remains portable before and after restoration. The migration changes syntax, not the table schema.
- The hard-cut gate is strict: do not deploy canonical-only readers while any production row remains in the old language.

## Risks and Mitigations

### Legacy syntax inventory is incomplete

Production content may contain prop combinations absent from the repository. Mitigation: normalize the complete read-only export and use a manual-review queue that must reach zero before cutover. Do not expand the literal language to preserve arbitrary JavaScript.

### Catalog lookup latency moves to the API

Server resolution can increase cold detail latency. Mitigation: local D1 identity and entity reads only, bounded parallelism, a one-hour document cache, and spans separating parse and catalog time. A page still renders if an entity is unavailable. Provider latency occurs during the explicit pre-cutover bootstrap, not reader requests.

### Payload size increases

Resolved tracks and repeated documents can enlarge tweet screens or album embeds. Mitigation: project `richContent` only where the body is rendered, cap embed and track counts, omit album or playlist tracks when `showTracks` is false, and measure serialized response size.

### Cache staleness after catalog edits

First release accepts at most one hour of stale embed metadata. This is preferable to a reverse index or distributed invalidation system. Revisit only if observed editorial corrections require faster refresh.

### Renderer drift between platforms

The shared DTO does not guarantee identical visual design. It guarantees semantic nodes and safety. Contract fixtures should be consumed by WWW tests and future mobile tests. Platform renderers may intentionally differ in presentation.

### Compatibility field removal breaks old clients

Mitigation: field removal is outside the additive rollout. Keep `content` indefinitely and remove `compiledContent` only under an explicit API compatibility decision.

## Open Decisions for the Owner

The first two decisions block only the approved production content operation, not implementation and rehearsal. The remaining decisions do not block the recommended design.

1. **Hard-cut maintenance window.** Recommended: schedule the cut only after the full export report has zero unresolved records and zero unexplained semantic differences. Pause writes and traffic for conversion, deployment, and smoke checks rather than operating two formats. Explicit approval is required before the production content update.
2. **Allowed downtime budget.** Recommended: set the window after timing the complete export, normalization, update, verification, and restoration rehearsal. Abort before conversion if backup or deployment readiness leaves insufficient rollback time. The owner must choose the actual budget before approving the runbook.
3. **Mobile product surface.** Mobile currently consumes show and audio records but does not display body content. Recommended: do not build an unused mobile renderer now. Add it when a concrete show, mix, editorial, or tweet body screen is selected, using the shared schema and fixtures.
4. **Unavailable embed copy.** Recommended: show a compact neutral fallback with a validated external link when available. Do not expose catalog or provider error details to readers.
5. **Footnotes.** `remark-gfm` supports footnotes through its mdast extensions, but they are not in the initial DTO above. Recommended: omit them from the first release unless production content is found to use them. Add explicit `FootnoteReference` and `FootnoteDefinition` nodes rather than flattening them.

## Acceptance Criteria

- After conversion, `/editorial/lack` stores a canonical track directive and renders it as a typed music card, not source text.
- Author prose containing `{`, `<`, or JSX-looking text cannot execute and does not invalidate unrelated blocks.
- GFM emphasis, images, ordered and nested lists, task lists, tables, strikethrough, links, quotes, and fenced code render correctly.
- All eight legacy component names have literal-only conversion coverage, and no runtime package imports that converter.
- One malformed directive or failed provider leaves the page and surrounding content usable.
- Direct load, hydration, and client navigation produce the same semantic document and no hydration mismatch.
- WWW performs no content parsing and no per-embed Spotify metadata fetch.
- Every rendered Spotify track, album, or playlist is backed by an existing GBFM music entity with a non-null entity ID. Missing identities render as unavailable and never trigger read-time catalog writes.
- Existing `content` remains stored and returned unchanged during the additive rollout.
- The approved hard cut converts every live record to canonical GFM plus directives before canonical-only runtime readers receive traffic. Unresolved records block the cut.
- Canonical source exports and reimports as plain UTF-8 text without requiring a render AST or GBFM database schema.
- Current mobile show, episode, mix, and player paths continue to decode responses and behave unchanged.
- No database schema migration is required.
- The migration tool has no database access. It is rehearsed against exported JSON, emits guarded SQL only after zero unresolved diagnostics, and its SQL is never run against production without separate owner approval.
- From the hard cut onward, reads and writes use only canonical GFM plus directives. There is no runtime legacy adapter or dual-format observation period.
- `bun precommit`, focused package tests, server unit and D1 tests, WWW tests, and WWW build pass at each applicable rollout phase.
