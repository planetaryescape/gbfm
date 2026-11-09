import {
  CreateListeningCollectionInput,
  EditCollectionInput,
  EditMixInput,
  ListeningMembershipInput,
  ListeningVersionInput,
  SaveMixesInput,
} from '@gbfm/api/listening'
import { Option, Schema } from 'effect'
import * as Server from 'foldkit/experimental/server'

import { apiRequest } from '../../server/api'

/** Same-origin form adapter; the API independently enforces ownership and parses every payload. */
export const handleListeningAction = async (request: Request, form: FormData) => {
  const field = (name: string) =>
    Option.getOrElse(Schema.decodeUnknownOption(Schema.String)(form.get(name)), () => '')

  const operation = new URL(request.url).pathname.slice('/actions/listening/'.length)
  const id = encodeURIComponent(field('id'))

  const fail = (status = 400) =>
    Server.Responded(
      new Response(
        'Could not save these changes. Go back to keep your draft, check your links and try again.',
        { status, headers: { 'cache-control': 'private, no-store' } },
      ),
    )

  let path: string
  let method = 'POST'

  let payload:
    | typeof SaveMixesInput.Type
    | typeof EditMixInput.Type
    | typeof CreateListeningCollectionInput.Type
    | typeof EditCollectionInput.Type
    | typeof ListeningMembershipInput.Type
    | typeof ListeningVersionInput.Type
    | undefined

  if (operation === 'save-import' || operation === 'bulk-links') {
    try {
      const items: unknown =
        operation === 'save-import'
          ? form
              .getAll('item')
              .map((value) =>
                Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(
                  Schema.decodeUnknownSync(Schema.String)(value),
                ),
              )
          : field('links')
              .split(/\r?\n/)
              .map((url) => url.trim())
              .filter(Boolean)
              .map((url) => ({ url, title: url.slice(0, 300) }))

      const parsed = Schema.decodeUnknownOption(SaveMixesInput)({ items })

      if (Option.isNone(parsed)) return fail()
      payload = parsed.value
    } catch {
      return fail()
    }

    path = '/api/listening/mixes'
  } else if (operation === 'edit-mix') {
    const parsed = Schema.decodeUnknownOption(EditMixInput)({
      expectedVersion: field('expectedVersion'),
      title: field('title'),
      notes: field('notes'),
      status: field('status'),
      published: field('published') === 'true',
    })

    if (Option.isNone(parsed)) return fail()
    payload = parsed.value
    path = `/api/listening/mixes/${id}`
    method = 'PUT'
  } else if (operation === 'create-collection' || operation === 'edit-collection') {
    const fields = {
      title: field('title'),
      description: field('description'),
      published: field('published') === 'true',
    }

    const parsed =
      operation === 'create-collection'
        ? Schema.decodeUnknownOption(CreateListeningCollectionInput)(fields)
        : Schema.decodeUnknownOption(EditCollectionInput)({
            ...fields,
            expectedVersion: field('expectedVersion'),
          })

    if (Option.isNone(parsed)) return fail()
    payload = parsed.value
    path = `/api/listening/collections${operation === 'edit-collection' ? `/${id}` : ''}`
    method = operation === 'edit-collection' ? 'PUT' : 'POST'
  } else if (operation === 'membership') {
    const parsed = Schema.decodeUnknownOption(ListeningMembershipInput)({
      expectedVersion: field('expectedVersion'),
      included: field('included') === 'true',
    })

    if (Option.isNone(parsed)) return fail()
    path = `/api/listening/collections/${id}/mixes/${encodeURIComponent(field('mixId'))}`
    method = 'PUT'
    payload = parsed.value
  } else if (operation === 'delete-mix' || operation === 'delete-collection') {
    const parsed = Schema.decodeUnknownOption(ListeningVersionInput)({
      expectedVersion: field('expectedVersion'),
    })

    if (Option.isNone(parsed)) return fail()
    payload = parsed.value
    path = `/api/listening/${operation === 'delete-mix' ? 'mixes' : 'collections'}/${id}`
    method = 'DELETE'
  } else return fail(404)

  try {
    const response = await apiRequest(request, path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: payload === undefined ? null : JSON.stringify(payload),
    })

    if (!response.ok) return fail(response.status)

    const returnTo = URL.parse(field('returnTo'), request.url)
    const query = new URLSearchParams({ saved: '1' })

    if (returnTo?.origin === new URL(request.url).origin && returnTo.pathname === '/listening') {
      for (const key of ['collection', 'status', 'mix']) {
        const value = returnTo.searchParams.get(key)

        if (value) query.set(key, value)
      }
    }

    return Server.Responded(
      new Response(null, {
        status: 303,
        headers: { location: `/listening?${query}`, 'cache-control': 'private, no-store' },
      }),
    )
  } catch {
    return fail(503)
  }
}
