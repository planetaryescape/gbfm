export const RICH_CONTENT_LIMITS = {
  sourceBytes: 100 * 1024,
  blocks: 2_000,
  nestingDepth: 12,
  tableRows: 100,
  tableColumns: 20,
  externalMediaEmbeds: 50,
  tracklistEntries: 100,
  directiveAttributeCharacters: 2_000,
} as const
