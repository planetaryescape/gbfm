# Native micro embeds

Embed an existing published GBFM micro by its stable post ID:

```md
::micro{id="b19847c2-fe58-4fd8-878a-b2faf138dfd7"}
```

The server resolves the current public note, author names, date and permalink.
WWW renders a native card, not an iframe or a copied paragraph in the article
source. The source note remains the single place to edit its wording.

Only public micros with a valid public ancestor chain are eligible. Drafts,
deleted notes, banned authors and replies beneath hidden ancestors produce a
generic unavailable placeholder without exposing their title, body or link.
Documents containing micro references bypass the rich-content render cache so
subsequent reads observe changes in visibility and text.

The card body is a bounded prose preview. Nested embeds, raw HTML and tables are
omitted with a link to the original note; they are never recursively resolved.
Limits: 16 references per document, 16 KiB of source and 64 blocks per note.
Invalid IDs, extra attributes, inline directives and container directives are
rejected when saving.

The wire representation is a `Quote` with optional `micro` metadata. Its body
includes the original-note link, so readers using the existing quote format keep
a readable fallback without adopting a new block type.
