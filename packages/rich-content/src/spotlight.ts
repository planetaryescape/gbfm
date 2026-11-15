import { Predicate } from 'effect'

import type { RichContentBlock } from './schema.ts'

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

export type SpotlightStep =
  | { readonly kind: 'intro'; readonly blocks: ReadonlyArray<RichContentBlock> }
  | { readonly kind: 'chapter'; readonly chapter: number; readonly value: SpotlightChapter }
  | {
      readonly kind: 'moment'
      readonly chapter: number
      readonly position: number
      readonly value: SpotlightMoment
    }
  | { readonly kind: 'end' }

/** The reader walks the intro, then each chapter's opener and moments in the curator's order. */
export const spotlightSteps = ({
  intro,
  chapters,
}: SpotlightStructure): ReadonlyArray<SpotlightStep> => [
  { kind: 'intro', blocks: intro },
  ...chapters.flatMap((value, chapter): ReadonlyArray<SpotlightStep> => [
    { kind: 'chapter', chapter, value },
    ...value.moments.map((moment, position): SpotlightStep => ({
      kind: 'moment',
      chapter,
      position,
      value: moment,
    })),
  ]),
  { kind: 'end' },
]

type Inline = Heading['children'][number]

const inlineText = (inline: Inline): string => {
  if ('value' in inline) return inline.value

  if ('children' in inline) return inline.children.map(inlineText).join('')

  return 'alt' in inline ? inline.alt : ''
}

export const headingText = (heading: Heading): string => heading.children.map(inlineText).join('')

/** URL-friendly position: chapter openers are `2`, moments `2.3`, the end `end`, the intro absent. */
export const stepPosition = (step: SpotlightStep): string | null => {
  if (step.kind === 'intro') return null

  if (step.kind === 'end') return 'end'

  return step.kind === 'chapter'
    ? `${step.chapter + 1}`
    : `${step.chapter + 1}.${step.position + 1}`
}

export const stepAt = (steps: ReadonlyArray<SpotlightStep>, position: string | null): number => {
  const index = steps.findIndex((step) => stepPosition(step) === position)

  return index === -1 ? 0 : index
}
