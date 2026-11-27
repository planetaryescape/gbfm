import type { RichContentDocument } from '@gbfm/rich-content/schema'
import {
  spotlightSteps,
  spotlightStructure,
  stepAt,
  stepPosition,
} from '@gbfm/rich-content/spotlight'

import { spotlightPresentation } from './spotlight-presentation'

export const normalizeSpotlightProgress = (
  document: RichContentDocument,
  progress: {
    readonly path: string
    readonly at: string | null
    readonly seen: ReadonlyArray<string>
  },
) => {
  const steps = spotlightSteps(spotlightStructure(spotlightPresentation(document.blocks).blocks))
  const step = steps[stepAt(steps, progress.at)]
  const positions = new Set(steps.map((entry) => stepPosition(entry) ?? 'intro'))

  return {
    ...progress,
    at: step ? stepPosition(step) : null,
    seen: progress.seen.filter((position) => positions.has(position)),
  }
}
