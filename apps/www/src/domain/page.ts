import { MicroPostNeighboursResponse } from '@gbfm/api/navigation'
import { MicroPostScreenResponse } from '@gbfm/api/post'
import { PublicProfileResponse } from '@gbfm/api/profile'
import { RichContentDocument } from '@gbfm/rich-content/schema'
import { SiteMetadata } from '@gbfm/site-metadata'
import { Schema } from 'effect'

import { DashboardDocument } from '../features/dashboard/document'
import { ContentItem } from './content-item'
import { ListeningPage } from './listening'
import { Principal } from './principal'
import { PublicActionDocument } from './public-action'
import { ShowsDocument } from './shows'

export const PageDocument = Schema.Struct({
  url: Schema.String,
  turnstileSiteKey: Schema.optional(Schema.String),
  status: Schema.Number,
  principal: Schema.NullOr(Principal),
  principalKnown: Schema.optional(Schema.Boolean),
  items: Schema.Array(ContentItem),
  title: Schema.String,
  description: Schema.String,
  requestId: Schema.String,
  renderedAt: Schema.Number,
  skipSeen: Schema.Boolean,
  tweet: Schema.NullOr(MicroPostScreenResponse),
  neighbours: Schema.NullOr(MicroPostNeighboursResponse),
  dashboard: Schema.NullOr(DashboardDocument),
  listening: Schema.optional(ListeningPage),
  profile: Schema.NullOr(PublicProfileResponse),
  shows: Schema.NullOr(ShowsDocument),
  changelog: Schema.NullOr(RichContentDocument),
  publicAction: Schema.NullOr(PublicActionDocument),
  metadata: Schema.NullOr(SiteMetadata),
  failure: Schema.NullOr(Schema.String),
})

export type PageDocument = typeof PageDocument.Type
