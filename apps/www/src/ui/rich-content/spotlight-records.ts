import type { View } from '@effect/ui'
import type { Html } from '@effect/ui/html'
import type { RichContentBlock } from '@gbfm/rich-content/schema'
import { Predicate } from 'effect'

export const spotlightRecords = <Message, R = never>(
  h: Html.H<Message>,
  blocks: ReadonlyArray<RichContentBlock>,
  render: (block: RichContentBlock) => View.Content<Message, R>,
) => {
  const groups: Array<Array<RichContentBlock>> = []

  for (const block of blocks) {
    const previous = groups.at(-1)

    if (
      Predicate.isTagged(block, 'MusicEmbed') &&
      previous?.[0] &&
      Predicate.isTagged(previous[0], 'MusicEmbed')
    ) {
      previous.push(block)
    } else {
      groups.push([block])
    }
  }

  return groups.map((group) =>
    group.length > 1
      ? h.div.class('spotlight-records').children(group.map(render))
      : (group.map(render)[0] ?? h.text('')),
  )
}
