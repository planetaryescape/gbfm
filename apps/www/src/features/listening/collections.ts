import type { Html } from '@effect/ui/html'

import type { ListeningPage } from '../../domain/listening'
import { HiddenField } from '../account/fields'
import { Checkbox, Field, ListeningAction, Submit } from './forms'

export const CollectionSettings = <M>(
  h: Html.H<M>,
  collection: ListeningPage['document']['collections'][number] | undefined,
  returnTo: string,
) =>
  h.div
    .key(collection?.id ?? 'new-collection')
    .class('grid gap-2 border-t border-border pt-3')
    .children(
      h.details.children(
        h.summary.children('+ New collection'),
        ListeningAction(h, 'create-collection', returnTo, [
          Field(h, 'title', 'Collection name', '', true),
          Field(h, 'description', 'Description'),
          Checkbox(h, 'published', 'Make collection public'),
          Submit(h, 'Create collection'),
        ]),
      ),
      collection
        ? h.details.children(
            h.summary.children('Collection settings'),
            ListeningAction(h, 'edit-collection', returnTo, [
              HiddenField(h, 'id', collection.id),
              HiddenField(h, 'expectedVersion', collection.version ?? ''),
              Field(h, 'title', 'Collection name', collection.title, true),
              Field(h, 'description', 'Description', collection.description),
              Checkbox(h, 'published', 'Make collection public', collection.published),
              Submit(h, 'Save collection'),
            ]),
            collection.published
              ? h.a
                  .attr('href', `/collections/${collection.id}`)
                  .children('View public collection ↗')
              : null,
            ListeningAction(h, 'delete-collection', '/listening', [
              HiddenField(h, 'id', collection.id),
              HiddenField(h, 'expectedVersion', collection.version ?? ''),
              Submit(h, 'Delete collection'),
            ]),
          )
        : null,
    )
