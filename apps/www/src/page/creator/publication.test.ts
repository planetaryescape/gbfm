import { Deferred, Effect, Fiber } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  Hydrate,
  PersistDraft,
  ReconcileLocalDraft,
  ResolveMusic,
  ResolveQuote,
  Save,
  UploadArtwork,
} from './command'
import { initialModel } from './init'
import { Message } from './message'
import type { Model } from './model'
import {
  CreatorRequestError,
  CreatorService,
  CreatorStorageError,
  CreatorUploadError,
  reconcileStoredDraft,
  type CreatorOperations,
} from './services'
import { update } from './update'

const input = {
  kind: 'micro' as const,
  editSlug: null,
  creatorId: 'creator',
  authorized: true,
  editorId: 'editor',
}

const owner = { editorId: input.editorId, requestId: 1 }

const ready = () => {
  const model = initialModel(input)

  return { ...model, phase: 'writing' as const, draft: { ...model.draft, title: 'Draft' } }
}

const service = (overrides: Partial<CreatorOperations> = {}): CreatorOperations => ({
  findMusicReferences: () => Effect.die('Unexpected references'),
  searchAuthors: () => Effect.die('Unexpected authors'),
  readLocalDraft: () => Effect.die('Unexpected local read'),
  writeLocalDraft: () => Effect.void,
  reconcileLocalDraft: () => Effect.void,
  loadEditable: () => Effect.die('Unexpected editable read'),
  resolveMusic: () => Effect.die('Unexpected music'),
  resolveQuote: () => Effect.die('Unexpected quote'),
  resolvePostMusic: () => Effect.die('Unexpected post music'),
  save: () => Effect.succeed({ id: 'post', slug: 'saved' }),
  renderPreview: () => Effect.die('Unexpected preview'),
  uploadImage: () => Effect.die('Unexpected image'),
  generateMosaic: () => Effect.die('Unexpected mosaic'),
  ...overrides,
})

const saved = (published = true, requestId = 1) =>
  Message.Saved({ owner: { ...owner, requestId }, id: 'post', slug: 'saved', published })

describe('creator publication ownership', () => {
  it.each([false, true])(
    'clears autosave errors superseded by remote success, late=%s',
    async (late) => {
      const edited = update(
        ready(),
        Message.Changed({ field: 'content', value: 'Saved content' }),
      ).model

      const pending = update(edited, Message.DraftSaveRequested()).model

      const failure = await Effect.runPromise(
        PersistDraft({
          key: pending.localDraftKey,
          draft: pending.draft,
          editorId: pending.editorId,
          revision: pending.revision,
        }).effect.pipe(
          Effect.provideService(
            CreatorService,
            service({
              writeLocalDraft: () =>
                Effect.fail(new CreatorStorageError({ operation: 'write', message: 'Full' })),
            }),
          ),
        ),
      )

      const remoteResult = await Effect.runPromise(
        Save({
          draft: pending.draft,
          creatorId: input.creatorId,
          publish: false,
          owner,
        }).effect.pipe(Effect.provideService(CreatorService, service())),
      )

      const completed = late
        ? update(update(pending, remoteResult).model, failure).model
        : update(update(pending, failure).model, remoteResult).model

      expect(completed).toMatchObject({ saveState: 'saved', localError: null, error: null })
    },
  )

  it.each([false, true])(
    'admits one remote operation and rejects duplicate completions, publish=%s',
    (publish) => {
      const pending = update(
        ready(),
        publish ? Message.PublishRequested() : Message.DraftSaveRequested(),
      ).model

      expect(update(pending, Message.DraftSaveRequested())).toEqual({ model: pending })
      expect(update(pending, Message.PublishRequested())).toEqual({ model: pending })
      const completed = update(pending, saved(publish)).model
      expect(completed.phase).toBe(publish ? 'published' : 'writing')
      expect(completed.draft).toMatchObject({ editSlug: 'saved', postId: 'post' })
      expect(update(completed, saved(!publish)).model).toBe(completed)
      const next = update(completed, Message.DraftSaveRequested()).model
      expect(update(next, saved()).model).toBe(next)
      expect(update(next, Message.SaveFailed({ owner, message: 'old failure' })).model).toBe(next)
      expect(next.remoteSave?.owner.requestId).toBe(2)
      expect(
        update(
          completed,
          Message.LocalSaveFailed({
            editorId: completed.editorId,
            revision: completed.revision,
            message: 'late autosave',
          }),
        ).model.saveState,
      ).toBe('saved')
      expect(update(pending, Message.KindChanged({ kind: 'mix' })).model).toBe(pending)
    },
  )

  it('runs remote success and reports cleanup failure separately without losing remote identity or newer edits', async () => {
    const storageFailure = new CreatorStorageError({
      operation: 'clear',
      message: 'Local cleanup failed',
    })

    const operations = service({ reconcileLocalDraft: () => Effect.fail(storageFailure) })
    const pending = update(ready(), Message.PublishRequested()).model

    const edited = update(
      pending,
      Message.Changed({ field: 'content', value: 'Newer content' }),
    ).model

    const result = await Effect.runPromise(
      Save({ draft: pending.draft, creatorId: input.creatorId, publish: true, owner }).effect.pipe(
        Effect.provideService(CreatorService, operations),
      ),
    )

    const completed = update(edited, result)
    expect(completed.model).toMatchObject({
      phase: 'published',
      saveState: 'unsaved',
      remoteSave: null,
      draft: { postId: 'post', editSlug: 'saved', content: 'Newer content' },
    })

    const cleanup = await Effect.runPromise(
      ReconcileLocalDraft({
        key: 'micro:new',
        draft: pending.draft,
        retained: edited.draft,
        owner,
        id: 'post',
        slug: 'saved',
      }).effect.pipe(Effect.provideService(CreatorService, operations)),
    )

    const warned = update(completed.model, cleanup).model
    expect(warned).toMatchObject({
      phase: 'published',
      saveState: 'unsaved',
      localError: 'Local cleanup failed',
      draft: { postId: 'post', content: 'Newer content' },
    })
    expect(
      update(warned, Message.LocallySaved({ editorId: input.editorId, revision: 0 })).model,
    ).toBe(warned)
  })

  it('does not reconcile local data after remote failure and admits a fresh retry', async () => {
    const pending = update(ready(), Message.DraftSaveRequested()).model

    const result = await Effect.runPromise(
      Save({ draft: pending.draft, creatorId: input.creatorId, publish: false, owner }).effect.pipe(
        Effect.provideService(
          CreatorService,
          service({
            save: () =>
              Effect.fail(
                new CreatorRequestError({ operation: 'save', status: 503, message: 'Unavailable' }),
              ),
          }),
        ),
      ),
    )

    const failed = update(pending, result)
    expect(failed.commands).toBeUndefined()
    expect(failed.model).toMatchObject({
      phase: 'writing',
      saveState: 'failed',
      remoteSave: null,
      error: 'save: Unavailable',
    })
    expect(
      update(failed.model, Message.DraftSaveRequested()).model.remoteSave?.owner.requestId,
    ).toBe(2)
  })

  it('keeps remote work owned while autosave fails and accepts its later success', async () => {
    const pending = update(ready(), Message.PublishRequested()).model
    const edited = update(pending, Message.Changed({ field: 'title', value: 'New title' })).model

    const result = await Effect.runPromise(
      PersistDraft({
        draft: edited.draft,
        key: 'micro:new',
        editorId: edited.editorId,
        revision: edited.revision,
      }).effect.pipe(
        Effect.provideService(
          CreatorService,
          service({
            writeLocalDraft: () =>
              Effect.fail(new CreatorStorageError({ operation: 'write', message: 'Full' })),
          }),
        ),
      ),
    )

    const failed = update(edited, result).model
    expect(failed).toMatchObject({ phase: 'saving', localError: 'autosave: Full' })
    expect(failed.remoteSave).toBe(pending.remoteSave)
    expect(update(failed, Message.DraftSaveRequested()).commands).toBeUndefined()
    expect(update(failed, saved()).model).toMatchObject({
      phase: 'published',
      saveState: 'unsaved',
      localError: 'autosave: Full',
      draft: { title: 'New title', postId: 'post' },
    })
  })

  it('invalidates discarded and replacement editors without claiming to cancel remote effects', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const pending = update(ready(), Message.PublishRequested()).model
        const writes: Array<string> = []

        const work = Save({
          draft: pending.draft,
          creatorId: input.creatorId,
          publish: true,
          owner,
        }).effect.pipe(
          Effect.provideService(
            CreatorService,
            service({
              save: () =>
                Deferred.succeed(entered, undefined).pipe(
                  Effect.andThen(Deferred.await(release)),
                  Effect.andThen(
                    Effect.sync(() => {
                      writes.push('published')

                      return { id: 'post', slug: 'saved' }
                    }),
                  ),
                ),
            }),
          ),
        )

        const fiber = yield* work.pipe(Effect.forkChild)
        yield* Deferred.await(entered)
        const discarded = update(pending, Message.DiscardRequested()).model
        yield* Deferred.succeed(release, undefined)
        const completion = yield* Fiber.join(fiber)
        expect(writes).toEqual(['published'])
        expect(update(discarded, completion)).toEqual({ model: discarded })
        expect(update(discarded, Message.SaveFailed({ owner, message: 'late' })).model).toBe(
          discarded,
        )

        const replacement = update(
          { ...ready(), editorId: 'replacement' },
          Message.PublishRequested(),
        ).model

        expect(update(replacement, completion).model).toBe(replacement)
        expect(
          update(discarded, Message.LocalSaveReconcileFailed({ owner, message: 'late cleanup' }))
            .model,
        ).toBe(discarded)
      }).pipe(Effect.scoped),
    )
  })

  it.each(['hydrate', 'music', 'quote', 'artwork'] as const)(
    'ignores delayed %s failures after editor discard',
    async (operation) => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const entered = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()

          const failure = Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.andThen(
              Effect.fail(
                new CreatorRequestError({ operation, status: 503, message: 'Unavailable' }),
              ),
            ),
          )

          const commands = {
            hydrate: Hydrate({
              key: 'micro:new',
              kind: 'micro',
              editSlug: null,
              editorId: input.editorId,
            }),
            music: ResolveMusic({
              url: 'https://music.test',
              kind: 'micro',
              editorId: input.editorId,
            }),
            quote: ResolveQuote({ slug: 'quote', editorId: input.editorId }),
            artwork: UploadArtwork({
              file: new File(['image'], 'cover.png'),
              editorId: input.editorId,
            }),
          }

          const command: Effect.Effect<Message, never, CreatorService> = commands[operation].effect

          const fiber = yield* command.pipe(
            Effect.provideService(
              CreatorService,
              service({
                readLocalDraft: () =>
                  failure.pipe(
                    Effect.mapError(
                      () => new CreatorStorageError({ operation: 'read', message: 'Unavailable' }),
                    ),
                  ),
                resolveMusic: () => failure,
                resolveQuote: () => failure,
                uploadImage: () =>
                  failure.pipe(
                    Effect.mapError(
                      () =>
                        new CreatorUploadError({
                          stage: 'image',
                          status: 503,
                          message: 'Unavailable',
                        }),
                    ),
                  ),
              }),
            ),
            Effect.forkChild,
          )

          yield* Deferred.await(entered)
          const discarded = update(ready(), Message.DiscardRequested()).model

          const replacement = update(
            update(discarded, Message.Changed({ field: 'title', value: 'Replacement' })).model,
            Message.PublishRequested(),
          ).model

          yield* Deferred.succeed(release, undefined)
          const result = yield* Fiber.join(fiber)
          expect(update(replacement, result)).toEqual({ model: replacement })
          expect(update(ready(), result).model.error).toContain('Unavailable')
        }).pipe(Effect.scoped),
      )
    },
  )

  it('rejects outdated autosave success and failure without dismissing review', () => {
    const first = update(ready(), Message.Changed({ field: 'title', value: 'First' })).model
    const second = update(first, Message.Changed({ field: 'title', value: 'Second' })).model
    const reviewed = update(second, Message.ReviewRequested()).model
    expect(
      update(reviewed, Message.LocallySaved({ editorId: first.editorId, revision: first.revision }))
        .model,
    ).toBe(reviewed)
    expect(
      update(
        reviewed,
        Message.LocalSaveFailed({
          editorId: first.editorId,
          revision: first.revision,
          message: 'old',
        }),
      ).model,
    ).toBe(reviewed)

    const local = update(
      reviewed,
      Message.LocallySaved({ editorId: reviewed.editorId, revision: reviewed.revision }),
    ).model

    expect(local).toMatchObject({ phase: 'reviewing', saveState: 'saved-locally' })
  })

  it('rejects old same-post music results after URL changes, even if the old URL is reentered', () => {
    const initial = {
      ...ready(),
      draft: { ...ready().draft, postId: 'post', musicUrl: 'https://old.test' },
    }

    const pending = update(initial, Message.ResolvePostMusicRequested()).model

    const result = Message.PostMusicResolved({
      owner,
      requestedUrl: 'https://old.test',
      postId: 'post',
      entityId: 'old',
      entityType: 'track',
      title: 'Old',
      artistNames: [],
      coverImageUrl: null,
      url: 'https://old.test',
    })

    const edited = update(
      pending,
      Message.Changed({ field: 'musicUrl', value: 'https://new.test' }),
    ).model

    expect(update(edited, result).model).toBe(edited)

    const returned = update(
      edited,
      Message.Changed({ field: 'musicUrl', value: 'https://old.test' }),
    ).model

    expect(update(returned, result).model).toBe(returned)
    const next = update(returned, Message.ResolvePostMusicRequested()).model
    expect(update(next, result).model).toBe(next)
    expect(
      update(
        next,
        Message.PostMusicFailed({
          owner,
          requestedUrl: 'https://old.test',
          postId: 'post',
          message: 'old',
        }),
      ).model,
    ).toBe(next)
    expect(
      update(next, Message.PostMusicResolved({ ...result, owner: { ...owner, requestId: 2 } }))
        .model.resolvingPostMusic,
    ).toBe(false)
  })

  it('retains preview content ownership and upload/save independence', () => {
    const document = { version: 1 as const, blocks: [] }
    const model = { ...ready(), draft: { ...ready().draft, content: 'first' } }
    const previewing = update(model, Message.EditorModeChanged({ mode: 'preview' })).model
    const loaded = update(previewing, Message.PreviewLoaded({ content: 'first', document })).model
    const edited = update(loaded, Message.Changed({ field: 'content', value: 'second' })).model
    expect(edited.previewDocument).toEqual(document)
    expect(update(edited, Message.PreviewLoaded({ content: 'first', document })).model).toBe(edited)

    const uploading = update(
      ready(),
      Message.AudioChosen({ files: [new File(['audio'], 'mix.mp3')] }),
    ).model

    expect(
      update(uploading, Message.DraftSaveRequested()).commands?.map(({ name }) => name),
    ).toEqual(['Creator.Save'])
  })
})

describe('creator local storage reconciliation', () => {
  const storage = () => {
    const values = new Map<string, string>()

    return {
      values,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value)
      },
      removeItem: (key: string) => {
        values.delete(key)
      },
    }
  }

  it('removes only the saved snapshot and retains newer local edits with remote identity', async () => {
    const local = storage()
    const draft = ready().draft
    local.setItem('draft', JSON.stringify(draft))
    await Effect.runPromise(
      reconcileStoredDraft(local, 'draft', draft, { id: 'post', slug: 'saved' }),
    )
    expect(local.getItem('draft')).toBeNull()
    local.setItem('draft', JSON.stringify({ ...draft, title: 'Newer' }))
    await Effect.runPromise(
      reconcileStoredDraft(local, 'draft', draft, { id: 'post', slug: 'saved' }),
    )
    expect(JSON.parse(local.getItem('draft') ?? '{}')).toMatchObject({
      title: 'Newer',
      postId: 'post',
      editSlug: 'saved',
    })
  })

  it('retains malformed local data and classifies cleanup failures without throwing defects', async () => {
    const local = storage()
    local.setItem('draft', 'invalid')

    const result = await Effect.runPromise(
      reconcileStoredDraft(local, 'draft', ready().draft, { id: 'post', slug: 'saved' }).pipe(
        Effect.flip,
      ),
    )

    expect(result).toBeInstanceOf(CreatorStorageError)
    expect(local.getItem('draft')).toBe('invalid')
  })

  it.each(['absent', 'saved', 'intermediate'])(
    'persists newer in-memory edits when autosave did not retain them, existing=%s',
    async (existing) => {
      const local = storage()
      const pending = update(ready(), Message.PublishRequested()).model

      const edited = update(
        pending,
        Message.Changed({ field: 'content', value: 'Not yet locally saved' }),
      ).model

      if (existing !== 'absent')
        local.setItem(
          'micro:new',
          JSON.stringify({
            ...pending.draft,
            content: existing === 'intermediate' ? 'Older autosave' : pending.draft.content,
          }),
        )
      const result = update(edited, saved())

      const command = ReconcileLocalDraft({
        key: 'micro:new',
        draft: pending.draft,
        retained: edited.draft,
        owner,
        id: 'post',
        slug: 'saved',
      })

      expect(result.commands?.[0]).toMatchObject({ name: command.name, args: command.args })
      await Effect.runPromise(
        command.effect.pipe(
          Effect.provideService(
            CreatorService,
            service({
              reconcileLocalDraft: (key, draft, remote, retained) =>
                reconcileStoredDraft(local, key, draft, remote, retained),
            }),
          ),
        ),
      )
      expect(JSON.parse(local.getItem('micro:new') ?? '{}')).toMatchObject({
        content: 'Not yet locally saved',
        editSlug: 'saved',
        postId: 'post',
      })
      expect(result.model.saveState).toBe('unsaved')
    },
  )

  it('does not attach a remote identity to a different local draft', async () => {
    const local = storage()

    const replacement = {
      ...ready().draft,
      postId: 'other',
      editSlug: 'other',
      title: 'Other draft',
    }

    local.setItem('draft', JSON.stringify(replacement))
    await Effect.runPromise(
      reconcileStoredDraft(
        local,
        'draft',
        ready().draft,
        { id: 'post', slug: 'saved' },
        { ...ready().draft, content: 'Retained edit' },
      ),
    )
    expect(JSON.parse(local.getItem('draft') ?? '{}')).toEqual(replacement)
  })

  it('does not overwrite a draft changed by another tab during reconciliation', async () => {
    const local = storage()
    const draft = ready().draft
    const replacement = JSON.stringify({ ...draft, content: 'Other tab latest' })
    local.setItem('draft', JSON.stringify(draft))
    let reads = 0
    await Effect.runPromise(
      reconcileStoredDraft(
        {
          ...local,
          getItem: (key) => {
            if (++reads === 2) local.setItem(key, replacement)

            return local.getItem(key)
          },
        },
        'draft',
        draft,
        { id: 'post', slug: 'saved' },
        { ...draft, content: 'This tab retained' },
      ),
    )
    expect(local.getItem('draft')).toBe(replacement)
  })

  it.each(['read', 'decode', 'write', 'clear'])(
    'reports a neutral reconciliation operation for %s failures',
    async (stage) => {
      const local = storage()
      const draft = ready().draft
      local.setItem('draft', stage === 'decode' ? 'invalid' : JSON.stringify(draft))

      const fail = () => {
        throw new Error('Storage unavailable')
      }

      const adapter = {
        getItem: stage === 'read' ? fail : local.getItem,
        setItem: stage === 'write' ? fail : local.setItem,
        removeItem: stage === 'clear' ? fail : local.removeItem,
      }

      const error = await Effect.runPromise(
        reconcileStoredDraft(
          adapter,
          'draft',
          draft,
          { id: 'post', slug: 'saved' },
          stage === 'write' ? { ...draft, content: 'Retained' } : null,
        ).pipe(Effect.flip),
      )

      expect(error.operation).toBe('reconcile')
    },
  )
})

describe('creator hydration provenance', () => {
  it.each(['remote', 'local', 'empty'] as const)(
    'labels %s hydration and preserves remote-first precedence',
    async (source) => {
      const draft = ready().draft
      const reads: Array<string> = []

      const result = await Effect.runPromise(
        Hydrate({
          editorId: input.editorId,
          key: 'micro:new',
          kind: 'micro',
          editSlug: source === 'remote' ? 'saved' : null,
        }).effect.pipe(
          Effect.provideService(
            CreatorService,
            service({
              loadEditable: () => Effect.succeed({ ...draft, draft: true, creators: [] }),
              readLocalDraft: () =>
                Effect.sync(() => {
                  reads.push('local')

                  return source === 'local' ? draft : null
                }),
            }),
          ),
        ),
      )

      expect(result).toMatchObject({ source })
      expect(reads).toEqual(source === 'remote' ? [] : ['local'])
      const model: Model = update(initialModel(input), result).model
      expect(model.saveState).toBe(source === 'local' ? 'saved-locally' : 'saved')
    },
  )
})
