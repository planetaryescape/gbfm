import type { RichContentDocument } from '@gbfm/rich-content/schema'
import {
  spotlightSteps,
  spotlightStructure,
  stepAt,
  stepPosition,
} from '@gbfm/rich-content/spotlight'

import type { Model } from './model'
import type { SpotlightProgress } from './spotlight-progress'
import { spotlightPresentation } from './view/rich-content/spotlight-presentation'

export const normalizeSpotlightProgress = (
  document: RichContentDocument,
  progress: SpotlightProgress,
): SpotlightProgress => {
  const steps = spotlightSteps(spotlightStructure(spotlightPresentation(document.blocks).blocks))
  const step = steps[stepAt(steps, progress.at)]
  const positions = new Set(steps.map((entry) => stepPosition(entry) ?? 'intro'))

  return {
    ...progress,
    at: step ? stepPosition(step) : null,
    seen: progress.seen.filter((position) => positions.has(position)),
  }
}

const spotlightPreview = (url: URL) =>
  import.meta.env.DEV && url.searchParams.get('layout') === 'spotlight'

/** The rich-content document of the editorial being shown when it reads as a spotlight walk. */
export const spotlightDocument = ({ flags }: Model): RichContentDocument | null => {
  const url = new URL(flags.url)
  const document = flags.items[0]?.richContent ?? null

  if (!url.pathname.startsWith('/editorial/') || document === null) return null

  return document.layout === 'spotlight' || spotlightPreview(url) ? document : null
}

/** Where the reader is in the walk: their stepped position, or the URL's when they have not stepped. */
export const spotlightProgress = (model: Model) => {
  const { spotlight, flags } = model
  const url = new URL(flags.url)

  const progress =
    spotlight !== null && spotlight.path === url.pathname
      ? spotlight
      : { path: url.pathname, at: url.searchParams.get('at'), seen: [] }

  const document = spotlightDocument(model)

  return document ? normalizeSpotlightProgress(document, progress) : progress
}
