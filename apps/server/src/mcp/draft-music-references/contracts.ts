import { DraftMusicReferences } from '@gbfm/core/post-music-references'
import { Schema } from 'effect'

import { EditorialMutationFields } from '../editorial-music/contracts'

/** Complete ordered replacement; omission never means preserve at this command boundary. */
export const SetDraftMusicReferencesInput = Schema.Struct({
  ...EditorialMutationFields,
  musicReferences: DraftMusicReferences,
})
