export const contentTagGroups = [
  { name: 'hip hop', aliases: ['hip hop', 'hip-hop', 'hip_hop', 'hiphop'] },
  { name: 'dub techno', aliases: ['dub techno', 'dub-techno', 'dub_techno'] },
  { name: 'minimal', aliases: ['minimal', 'minima'] },
]

export const canonicalContentTag = (tag: string): string => {
  const trimmed = tag.trim()

  return (
    contentTagGroups.find((group) => group.aliases.includes(trimmed.toLowerCase()))?.name ?? trimmed
  )
}

export const canonicalContentTags = (tags: ReadonlyArray<string>): Array<string> =>
  [...new Set(tags.map(canonicalContentTag))].filter((tag) => tag.length > 0)

export const contentTagAliases = (tag: string): ReadonlyArray<string> => {
  const name = canonicalContentTag(tag)

  return contentTagGroups.find((group) => group.name === name)?.aliases ?? [name]
}
