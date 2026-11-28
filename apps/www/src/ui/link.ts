import type { View } from '@effect/ui'
import type { Html } from '@effect/ui/html'

export const link = <Message>(
  h: Html.H<Message>,
  href: string,
  label: string,
  className = '',
): View.Content<Message> => h.a.attr('href', href).class(className).children([label])
