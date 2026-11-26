import type { HtmlServer } from '@effect/ui/html'
import type { Data } from 'effect'

export interface DocumentAssets {
  readonly entryScript: string
  readonly stylesheets: ReadonlyArray<string>
  readonly modulePreloads: ReadonlyArray<string>
}

export interface RenderedPage extends Pick<
  HtmlServer.Rendered<unknown>,
  'html' | 'state' | 'head' | 'htmlAttributes' | 'bodyAttributes'
> {
  readonly serializedProps: string
  readonly extraHead: string
}

export type EntryResult = Data.TaggedEnum<{
  Rendered: {
    readonly application: RenderedPage
    readonly status: number
    readonly headers: Headers
  }
  Responded: { readonly response: Response }
}>

export interface ServerEntry {
  readonly renderPage: (request: Request) => Promise<EntryResult>
}
