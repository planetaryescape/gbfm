import { UiSchema } from '@effect/ui'
import { MicroPostNeighboursResponse, MicroPostTimelineMonth } from '@gbfm/api/navigation'
import { CompiledMicroPostResponse, MicroPostScreenResponse } from '@gbfm/api/post'
import { Schema } from 'effect'

import { ContentItem } from '../../domain/content-item'
import { Principal } from '../../domain/principal'
import { concreteSlug } from './location'

export const ReaderListItem = Schema.Union([CompiledMicroPostResponse, ContentItem])

export const ReaderPageProps = Schema.Struct({
  url: Schema.URL,
  principal: Schema.NullOr(Principal),
  principalKnown: Schema.optionalKey(Schema.Boolean),
  screen: Schema.NullOr(MicroPostScreenResponse),
  neighbours: Schema.NullOr(MicroPostNeighboursResponse),
  posts: Schema.Array(ReaderListItem),
  renderedAt: Schema.Number,
  failure: Schema.NullOr(Schema.String),
  status: Schema.optionalKey(Schema.Number),
  navigationId: Schema.optionalKey(Schema.Number),
  navigationAction: Schema.optionalKey(Schema.Literals(['initial', 'push', 'replace', 'pop'])),
  active: Schema.optionalKey(Schema.Boolean),
  visible: Schema.optionalKey(Schema.Boolean),
})

export type ReaderPageProps = typeof ReaderPageProps.Type

export const VisitDestination = Schema.Struct({
  identity: Schema.String,
  navigationId: Schema.Number,
  slug: Schema.String,
})

export type VisitDestination = typeof VisitDestination.Type

export const VisitToken = Schema.Struct({
  ...VisitDestination.fields,
  generation: Schema.Number,
})

export type VisitToken = typeof VisitToken.Type

export const NavigationSnapshot = Schema.Struct({
  ...VisitToken.fields,
  revision: Schema.Number,
  refresh: Schema.Number,
  neighbours: MicroPostNeighboursResponse,
})

export const ReaderPageMessage = UiSchema.TaggedEnum({
  ChangedDestination: VisitDestination.fields,
  CommittedReader: VisitToken.fields,
  FocusedReaderWindow: {},
  SucceededRecordVisit: VisitToken.fields,
  FailedRecordVisit: VisitToken.fields,
  ClickedRetryVisit: {},
  ClickedRetryNavigation: {},
  ClickedLatest: {},
  EnteredReader: {},
  ReceivedNavigationSnapshot: { snapshot: Schema.NullOr(NavigationSnapshot) },
  ResolvedCheckpoint: {
    identity: Schema.String,
    generation: Schema.Number,
    navigationId: Schema.Number,
    slug: Schema.NullOr(Schema.String),
  },
  MeasuredProgress: { ...VisitToken.fields, progress: Schema.Number },
})

export type ReaderPageMessage = typeof ReaderPageMessage.Type

export const ReaderPageModel = Schema.Struct({
  identity: Schema.String,
  generation: Schema.Number,
  navigationId: Schema.Number,
  reserved: Schema.NullOr(Schema.String),
  current: Schema.NullOr(Schema.String),
  checkpoint: Schema.NullOr(Schema.String),
  resumeSlug: Schema.NullOr(Schema.String),
  resumeNavigationId: Schema.NullOr(Schema.Number),
  entryResolved: Schema.Boolean,
  entryFallback: Schema.Boolean,
  returnSlug: Schema.NullOr(Schema.String),
  revision: Schema.Number,
  refresh: Schema.Number,
  progress: Schema.Number,
  lastTimeline: Schema.Array(MicroPostTimelineMonth),
  visits: Schema.Record(Schema.String, Schema.Literals(['pending', 'recorded', 'failed'])),
  visitNavigation: Schema.Record(Schema.String, Schema.Number),
})

export type ReaderPageModel = typeof ReaderPageModel.Type

export const destination = (props: ReaderPageProps): VisitDestination => ({
  identity: props.principal?.id ?? 'anonymous',
  navigationId: props.navigationId ?? 0,
  slug:
    props.active === false ||
    props.principalKnown === false ||
    props.failure ||
    (props.status !== undefined && props.status !== 200) ||
    concreteSlug(props.url) !== props.screen?.post.slug
      ? ''
      : (props.screen?.post.slug ?? ''),
})
