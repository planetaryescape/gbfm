import { Html } from '@effect/ui/html'
import { AsyncResult } from 'effect/reactivity'

import { destination, ReaderPageMessage, ReaderPageModel, ReaderPageProps } from './contracts'
import { hasPendingVisits, matchesReservation } from './decisions'
import { ReaderNeighbours, ReaderReplies } from './requests'

export const ReaderPageDef = Html.component({
  name: 'ReaderPage',
  props: ReaderPageProps,
  model: ReaderPageModel,
  message: ReaderPageMessage,
  restore: (model) => ({
    ...model,
    current: null,
    reserved: null,
    progress: 0,
    visits: Object.fromEntries(
      Object.entries(model.visits).filter(([, value]) => value !== 'pending'),
    ),
  }),
  queries: {
    neighbours: {
      query: ReaderNeighbours,
      args: ({ model, props }) =>
        model.current &&
        matchesReservation(model, destination(props)) &&
        !hasPendingVisits(model) &&
        props.active !== false
          ? {
              identity: model.identity,
              generation: model.generation,
              slug: model.current,
              navigationId: model.navigationId,
              revision: model.revision,
              refresh: model.refresh,
            }
          : undefined,
      onChange: (result) =>
        ReaderPageMessage.ReceivedNavigationSnapshot({
          snapshot: AsyncResult.isSuccess(result) ? result.value : null,
        }),
    },
    replies: {
      query: ReaderReplies,
      args: ({ model, props }) =>
        model.current && matchesReservation(model, destination(props)) && props.active !== false
          ? {
              identity: model.identity,
              generation: model.generation,
              slug: model.current,
              navigationId: model.navigationId,
            }
          : undefined,
    },
  },
})
