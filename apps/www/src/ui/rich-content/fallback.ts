import type { View } from '@effect/ui'
import type { Html } from '@effect/ui/html'

const inline = <Message>(
  h: Html.H<Message>,
  text: string,
): Array<View.Content<Message> | string> => {
  const parts: Array<View.Content<Message> | string> = []

  const pattern =
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/(?!\/)[^\s)]+)\)|(`[^`]+`)|\*\*([^*]+)\*\*|(https?:\/\/[^\s<>]+)/g

  let cursor = 0

  for (const match of text.matchAll(pattern)) {
    parts.push(text.slice(cursor, match.index))
    const href = match[2] ?? match[5]

    if (href)
      parts.push(
        h.a
          .attr('href', href)
          .attrs(href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})
          .children([match[1] ?? href]),
      )
    else if (match[3]) parts.push(h.code.children([match[3].slice(1, -1)]))
    else if (match[4]) parts.push(h.strong.children([match[4]]))
    cursor = match.index + match[0].length
  }

  parts.push(text.slice(cursor))

  return parts
}

/** Render stored writing as inert markup, never evaluating compiled MDX or accepting arbitrary HTML. */
export const richContent = <Message>(
  h: Html.H<Message>,
  content: string,
  className = '',
): View.Content<Message> => {
  const output: Array<View.Content<Message>> = []
  let code = false
  let lines: Array<string> = []

  const flush = () => {
    if (lines.length)
      output.push(
        code
          ? h.pre.children([h.code.children([lines.join('\n')])])
          : h.p.children(inline(h, lines.join('\n'))),
      )
    lines = []
  }

  // Legacy exports contain self-closing iframe markup. Only reconstruct the exact trusted SoundCloud player.
  const legacy = /<iframe\b[\s\S]*?(?:\/>|<\/iframe>)\s*(?:<div\b[\s\S]*?<\/div>)?/gi
  let cursor = 0

  const renderText = (text: string) => {
    for (const line of text.split('\n')) {
      if (line.trim().startsWith('```')) {
        flush()
        code = !code
        continue
      }

      if (code) {
        lines.push(line)
        continue
      }

      if (!line.trim()) {
        flush()
        continue
      }

      const heading = /^(#{1,6})\s+(.+)$/.exec(line)

      if (heading?.[2]) {
        flush()
        output.push(h.h2.children(inline(h, heading[2])))
        continue
      }

      if (line.startsWith('> ')) {
        flush()
        output.push(h.blockquote.children(inline(h, line.slice(2))))
        continue
      }

      if (/^[-*+]\s+/.test(line)) {
        flush()
        output.push(h.ul.children([h.li.children(inline(h, line.replace(/^[-*+]\s+/, '')))]))
        continue
      }

      lines.push(line)
    }

    flush()
  }

  for (const match of content.matchAll(legacy)) {
    const src = /\bsrc="([^"]+)"/i.exec(match[0])?.[1]
    let player: URL

    try {
      player = new URL(src ?? '')
    } catch {
      continue
    }

    const track = player.searchParams.get('url')

    if (
      player.origin !== 'https://w.soundcloud.com' ||
      player.pathname !== '/player/' ||
      !track ||
      !/^https:\/\/api\.soundcloud\.com\/tracks\/\d+$/.test(track)
    )
      continue
    renderText(content.slice(cursor, match.index))
    const embed = new URL('https://w.soundcloud.com/player/')
    embed.searchParams.set('url', track)
    output.push(
      h.iframe
        .attr('title', 'SoundCloud audio player')
        .attr('src', embed.href)
        .attr('width', '100%')
        .attr('height', '166')
        .attr('loading', 'lazy')
        .attr('allow', 'autoplay')
        .children([]),
    )
    cursor = match.index + match[0].length
  }

  renderText(content.slice(cursor))

  return h.div.class(`rich-content ${className}`.trim()).children(output)
}
