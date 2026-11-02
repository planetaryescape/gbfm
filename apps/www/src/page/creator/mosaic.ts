import type { CreatorDraft } from './services'

export const mosaicSource = (draft: CreatorDraft) =>
  draft.musicEntityType && draft.musicEntityId
    ? `${draft.content}\n\n::music{type="${draft.musicEntityType}" id="${draft.musicEntityId}"}`
    : draft.content
