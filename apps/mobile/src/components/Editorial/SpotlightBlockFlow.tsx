import type { RichContentBlock } from '@gbfm/rich-content/schema'
import { Predicate } from 'effect'
import { Fragment, type ReactNode } from 'react'

import { keyedContent } from '@/tweets/tweetContent'

type MusicEmbed = Extract<RichContentBlock, { readonly _tag: 'MusicEmbed' }>

export function SpotlightBlockFlow({
  blocks,
  renderMusic,
  renderBlock,
  renderRow,
}: {
  readonly blocks: ReadonlyArray<RichContentBlock>
  readonly renderMusic: (block: MusicEmbed, compact: boolean) => ReactNode
  readonly renderBlock: (block: RichContentBlock) => ReactNode
  readonly renderRow: (children: ReactNode, count: number) => ReactNode
}) {
  const groups: Array<Array<{ readonly block: RichContentBlock; readonly inGroup: boolean }>> = []

  const flattened = blocks.flatMap((block) =>
    Predicate.isTagged(block, 'CardGroup')
      ? block.children.map((child) => ({ block: child, inGroup: true }))
      : [{ block, inGroup: false }],
  )

  for (const item of flattened) {
    const previous = groups.at(-1)

    if (
      Predicate.isTagged(item.block, 'MusicEmbed') &&
      previous?.[0] &&
      Predicate.isTagged(previous[0].block, 'MusicEmbed')
    )
      previous.push(item)
    else groups.push([item])
  }

  return keyedContent(groups).map(({ item: group, key }) => {
    const first = group[0]

    if (!first) return null

    if (!Predicate.isTagged(first.block, 'MusicEmbed'))
      return <Fragment key={key}>{renderBlock(first.block)}</Fragment>

    if (group.length === 1 && !first.inGroup)
      return <Fragment key={key}>{renderMusic(first.block, false)}</Fragment>

    const rows: Array<typeof group> = []

    for (let index = 0; index < group.length; index += 2) rows.push(group.slice(index, index + 2))

    return (
      <Fragment key={key}>
        {keyedContent(rows).map(({ item: row, key: rowKey }) => (
          <Fragment key={rowKey}>
            {renderRow(
              keyedContent(row).map(({ item, key: itemKey }) =>
                Predicate.isTagged(item.block, 'MusicEmbed') ? (
                  <Fragment key={itemKey}>{renderMusic(item.block, true)}</Fragment>
                ) : null,
              ),
              row.length,
            )}
          </Fragment>
        ))}
      </Fragment>
    )
  })
}
