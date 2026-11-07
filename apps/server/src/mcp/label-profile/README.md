# PF label-profile prompt (#544)

`prompt.ts` exports `LabelProfilePromptLayer` and `LabelProfilePromptScopes`
(`catalogue:read`, `content:read`). It uses installed Effect 4.0.6's official
`McpServer.prompt`, not a tool, resource, second transport or model provider.

The sole prompt `prompt_label_profile` takes a user-selected stable `labelId`.
Version 1 includes a published label, at most ten recorded artist/album examples,
safe stored source links, source locators, SHA-256 assertion fingerprints and
limitations. It requires live grants on retrieval. It includes no label body,
private drafts or provenance blobs. All retrieved names, titles and links are
delimited as untrusted source data. Guidance forbids invented history, influence,
sonic or listening claims, separates proposed angles from facts and performs no
imports, external fetching, publishing, notifications or mutations.

## Composition owned by P1

Use the existing request-scoped MCP server once. The tested isolated recipe is:

```ts
LabelProfilePromptLayer.pipe(
  Layer.provideMerge(makeMcpLayer([], toolkit)),
  Layer.provide(database),
  Layer.provide(Layer.succeed(EditorialMcpConfig, config)),
  Layer.provide(HttpServer.layerServices),
)
```

P1 reserves central prompt registration, scope-aware `prompts/list` filtering and
`prompts/get` admission. The installed prompt registry does not itself filter by
`McpPermission`. Do not expose this layer through the production route until
that reservation is implemented and tested against persisted OAuth grants.
In particular, the raw isolated test server is **not** proof of hidden discovery
for missing grants. Retrieval performs its own live authorization regardless.

`prompt.d1.test.ts` demonstrates official MCP 2026-07-28 `prompts/list/get`,
current framework/client request envelopes (including `mcp-name` for get), sourced
guidance, missing-grant denial, unknown-source failure and absence of a mutating
tool. It uses migrated D1 and an injected actor, not persisted OAuth tokens.
The response is bounded to 64 KiB with transport headroom and a five-second
deadline. Real target-client UI discovery and composed persisted-OAuth/list
policy remain integration checks, not claims made by this slice.
