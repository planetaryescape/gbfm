import type { RichContentBlock } from '@gbfm/rich-content/schema'
import { Predicate } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

export const spotlightRecords = <Message>(
  blocks: ReadonlyArray<RichContentBlock>,
  h: HtmlBuilder<Message>,
  render: (block: RichContentBlock) => Html,
): ReadonlyArray<Html> => {
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
      ? h.div([h.Class('spotlight-records')], group.map(render))
      : (group.map(render)[0] ?? h.empty),
  )
}
