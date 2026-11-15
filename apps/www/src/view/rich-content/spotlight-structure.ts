import type { RichContentBlock } from '@gbfm/rich-content/schema'
import { Predicate } from 'effect'

type Heading = Extract<RichContentBlock, { readonly _tag: 'Heading' }>

const isHeading = (block: RichContentBlock, level: 2 | 3): block is Heading =>
  Predicate.isTagged(block, 'Heading') && 'level' in block && block.level === level

export interface SpotlightMoment {
  readonly heading: Heading
  readonly blocks: ReadonlyArray<RichContentBlock>
}

export interface SpotlightChapter {
  readonly heading: Heading
  readonly lead: ReadonlyArray<RichContentBlock>
  readonly moments: ReadonlyArray<SpotlightMoment>
}

export interface SpotlightStructure {
  readonly intro: ReadonlyArray<RichContentBlock>
  readonly chapters: ReadonlyArray<SpotlightChapter>
}

interface Draft {
  intro: Array<RichContentBlock>
  chapters: Array<{
    heading: Heading
    lead: Array<RichContentBlock>
    moments: Array<SpotlightMoment>
  }>
}

const append = (draft: Draft, block: RichContentBlock): Draft => {
  const chapter = draft.chapters.at(-1)

  if (!chapter) return { ...draft, intro: [...draft.intro, block] }

  const moment = chapter.moments.at(-1)

  const updated = moment
    ? {
        ...chapter,
        moments: [
          ...chapter.moments.slice(0, -1),
          { ...moment, blocks: [...moment.blocks, block] },
        ],
      }
    : { ...chapter, lead: [...chapter.lead, block] }

  return { ...draft, chapters: [...draft.chapters.slice(0, -1), updated] }
}

const step = (draft: Draft, block: RichContentBlock): Draft => {
  if (isHeading(block, 2))
    return { ...draft, chapters: [...draft.chapters, { heading: block, lead: [], moments: [] }] }

  const chapter = draft.chapters.at(-1)

  if (isHeading(block, 3) && chapter)
    return {
      ...draft,
      chapters: [
        ...draft.chapters.slice(0, -1),
        { ...chapter, moments: [...chapter.moments, { heading: block, blocks: [] }] },
      ],
    }

  return append(draft, block)
}

/** Second-level headings open chapters and third-level headings open the moments readers focus on. */
export const spotlightStructure = (blocks: ReadonlyArray<RichContentBlock>): SpotlightStructure =>
  blocks.reduce(step, { intro: [], chapters: [] })

export const youtubeVideoId = (href: string): string | null => {
  try {
    const url = new URL(href)

    if (url.hostname === 'youtu.be') return url.pathname.slice(1) || null

    return (
      url.searchParams.get('v') ?? url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1] ?? null
    )
  } catch {
    return null
  }
}
