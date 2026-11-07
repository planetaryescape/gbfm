/** Already-authorized, complete snapshot. Hidden albums are passed as null, never as identities. */
export interface SequenceMember {
  readonly trackId: string
  readonly position: number
  readonly albumId: string | null
  readonly trackNumber: number | null
}

/** First occurrence fixes block order; only positive recorded numbers order a block. */
export const proposeAlbumBlocks = (members: ReadonlyArray<SequenceMember>) => {
  const groups = new Map<string, Array<SequenceMember & { readonly originalIndex: number }>>()
  members.forEach((member, originalIndex) => {
    const key = member.albumId === null ? `track:${member.trackId}` : `album:${member.albumId}`
    const group = groups.get(key) ?? []
    group.push({ ...member, originalIndex })
    groups.set(key, group)
  })
  const blocks = [...groups.values()].filter((group) => group.length > 1)
  const original = members.map((member) => member.trackId)

  if (blocks.length === 0)
    return {
      status: 'insufficient_evidence' as const,
      changed: false,
      original,
      proposed: original,
      blocks: [],
    }

  const ordered = [...groups.values()].map((group) =>
    group.toSorted((a, b) => {
      const aNumber = a.trackNumber !== null && a.trackNumber > 0 ? a.trackNumber : Infinity
      const bNumber = b.trackNumber !== null && b.trackNumber > 0 ? b.trackNumber : Infinity

      return (
        (aNumber === bNumber ? 0 : aNumber < bNumber ? -1 : 1) || a.originalIndex - b.originalIndex
      )
    }),
  )

  const proposed = ordered.flat().map((member) => member.trackId)

  return {
    status: 'sufficient' as const,
    changed: original.some((id, index) => id !== proposed[index]),
    original,
    proposed,
    blocks,
  }
}
