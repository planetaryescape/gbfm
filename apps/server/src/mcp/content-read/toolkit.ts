import { Effect } from 'effect'
import { Tool, Toolkit } from 'effect/ai'

import { McpPermission } from '../authorization'
import { EditorialToolError } from '../contracts'
import {
  ContentPageInput,
  PublishedPostsResult,
  PublicShowInput,
  PublicShowResult,
  ShowEpisodesInput,
  ShowEpisodesResult,
} from './contracts'
import { ContentReadService } from './service'

/** R3 public-content tools, composed centrally by P1 rather than registered by this lane. */
export const ContentReadToolkit = Toolkit.make(
  Tool.make('list_published_posts', {
    description:
      'List published editorial post summaries, not micro posts or drafts. Public metadata only: no body, embeds or personalized fields. Read-only; safe to retry. Defaults to 20, maximum 50. Advance offset by pagination.limit, even when blank source rows produce a shorter page. Requires content:read.',
    parameters: ContentPageInput,
    success: PublishedPostsResult,
    failure: EditorialToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['content:read'] })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('get_show', {
    description:
      'Read public show metadata by slug. Missing and draft shows both return not_found. No source body, media URLs, hosts, subscriptions or hydrated embeds. Read-only and safe to retry; requires content:read.',
    parameters: PublicShowInput,
    success: PublicShowResult,
    failure: EditorialToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['content:read'] })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('list_show_episodes', {
    description:
      'List public audio episode metadata under a published show by slug. Audio IDs are not catalogue music-track IDs. No bodies, media URLs, playback counting or personalized state. Missing and draft shows both return not_found; draft episodes never enter counts or pages, even for admins. Defaults to 20, maximum 50. Read-only and safe to retry; requires content:read.',
    parameters: ShowEpisodesInput,
    success: ShowEpisodesResult,
    failure: EditorialToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['content:read'] })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
)

/** Typed handlers for central composition with the existing authenticated transport. */
export const ContentReadHandlersLayer = ContentReadToolkit.toLayer(
  Effect.gen(function* () {
    const reads = yield* ContentReadService

    return {
      list_published_posts: reads.listPublishedPosts,
      get_show: reads.getShow,
      list_show_episodes: reads.listShowEpisodes,
    }
  }),
)
