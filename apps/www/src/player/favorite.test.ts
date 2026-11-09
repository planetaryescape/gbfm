import type { QueueTrackType } from '@gbfm/player'
import { Effect, Fiber, ManagedRuntime } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from 'vitest'

import { initialModel, Message as ActualMessage, reconcile, sync, update } from './favorite'

const Message = {
  ...ActualMessage,
  Loaded: (input: Omit<Parameters<typeof ActualMessage.Loaded>[0], 'revision'>) =>
    ActualMessage.Loaded({ revision: 17, ...input }),
  Saved: (input: Omit<Parameters<typeof ActualMessage.Saved>[0], 'revision'>) =>
    ActualMessage.Saved({ revision: 18, ...input }),
  SaveFailed: (
    input: Omit<Parameters<typeof ActualMessage.SaveFailed>[0], 'conflicted' | 'mutationId'>,
  ) =>
    ActualMessage.SaveFailed({
      conflicted: false,
      mutationId: 'da5495ab-6f07-4a4f-bb5e-0f9355e71e40',
      ...input,
    }),
}

const track = (id: string, slug = id): QueueTrackType => ({
  id,
  title: id,
  slug,
  url: `https://cdn.test/${id}.mp3`,
  thumbnailUrl: null,
  type: 'mix',
})

const loaded = (state: 'active' | 'inactive' | 'anonymous' = 'inactive') => {
  const loading = sync(initialModel, track('mix-a'), 'user-1').model

  return update(
    loading,
    Message.Loaded({
      generation: loading.generation,
      state,
      principalId: state === 'anonymous' ? null : 'user-1',
      principalKnown: true,
    }),
  ).model
}

describe('player favorite', () => {
  it('reads favorite state for the queued track from the audio page endpoint', () => {
    const result = sync(initialModel, track('mix-a', 'mix-a-slug'), 'user-1')

    expect(result.model.status).toBe('loading')
    expect(result.commands?.map(({ name, args }) => ({ name, args }))).toEqual([
      {
        name: 'PlayerFavorite.Load',
        args: {
          generation: result.model.generation,
          track: { audioId: 'mix-a', type: 'mix', slug: 'mix-a-slug' },
        },
      },
    ])
    expect(sync(result.model, track('mix-a', 'mix-a-slug'), 'user-1').model).toBe(result.model)
  })

  it('asks the server even without a known principal, and never invents saved state', () => {
    const loading = sync(initialModel, track('mix-a'), null)
    expect(loading.commands?.map(({ name }) => name)).toEqual(['PlayerFavorite.Load'])

    const anonymous = update(
      loading.model,
      Message.Loaded({
        generation: loading.model.generation,
        state: 'anonymous',
        principalId: null,
        principalKnown: true,
      }),
    ).model

    expect(anonymous.status).toBe('anonymous')
    expect(update(anonymous, Message.Toggled()).commands).toBeUndefined()
  })

  it.each([true, false])(
    'distinguishes confirmed signed-out responses from failed identity reads: %s',
    (principalKnown) => {
      const loading = sync(initialModel, track('mix-a'), 'user-1').model

      const unavailable = update(
        loading,
        Message.Loaded({
          generation: loading.generation,
          state: 'unavailable',
          principalId: null,
          principalKnown,
        }),
      ).model

      expect(unavailable.principalId).toBe(principalKnown ? null : 'user-1')
      expect(unavailable.status).toBe('unavailable')
    },
  )

  it('rejects save results with the wrong account or audio even if their generation matches', () => {
    const saving = update(loaded(), Message.Toggled()).model

    const wrongAccount = update(
      saving,
      Message.Saved({
        generation: saving.generation,
        audioId: 'mix-a',
        active: true,
        principalId: 'user-2',
      }),
    ).model

    const wrongAudio = update(
      saving,
      Message.Saved({
        generation: saving.generation,
        audioId: 'mix-b',
        active: true,
        principalId: 'user-1',
      }),
    ).model

    const wrongFailure = update(
      saving,
      Message.SaveFailed({
        generation: saving.generation,
        principalId: 'user-2',
        unauthorized: true,
      }),
    ).model

    expect(wrongAccount).toBe(saving)
    expect(wrongAudio).toBe(saving)
    expect(wrongFailure).toBe(saving)
  })

  it('clears stale state and ignores late loads after the track or account changes', () => {
    const first = sync(initialModel, track('mix-a'), 'user-1').model
    const second = sync(first, track('mix-b'), 'user-1').model
    expect(second.status).toBe('loading')

    expect(
      update(
        second,
        Message.Loaded({
          generation: first.generation,
          state: 'active',
          principalId: 'user-1',
          principalKnown: true,
        }),
      ).model,
    ).toEqual(second)

    const active = update(
      second,
      Message.Loaded({
        generation: second.generation,
        state: 'active',
        principalId: 'user-1',
        principalKnown: true,
      }),
    ).model

    const otherAccount = sync(active, track('mix-b'), 'user-2').model
    expect(otherAccount.status).toBe('loading')
    expect(otherAccount.generation).toBeGreaterThan(active.generation)
  })

  it('stays pending until the server acknowledges and blocks duplicate saves', () => {
    const inactive = loaded()
    const saving = update(inactive, Message.Toggled())

    expect(saving.model).toMatchObject({ status: 'inactive', saving: true })
    expect(saving.commands?.[0]?.args).toEqual({
      generation: inactive.generation,
      audioId: 'mix-a',
      active: true,
      principalId: 'user-1',
      expectedRevision: 17,
      mutationId: null,
    })
    expect(update(saving.model, Message.Toggled()).commands).toBeUndefined()

    const saved = update(
      saving.model,
      Message.Saved({
        generation: inactive.generation,
        audioId: 'mix-a',
        active: true,
        principalId: 'user-1',
      }),
    ).model

    expect(saved).toMatchObject({ status: 'active', saving: false, notice: null })
  })

  it('drops a save acknowledgement that arrives after the track changed', () => {
    const saving = update(loaded(), Message.Toggled()).model
    const next = sync(saving, track('mix-b'), 'user-1').model

    expect(next.saving).toBe(false)
    expect(
      update(
        next,
        Message.Saved({
          generation: saving.generation,
          audioId: 'mix-a',
          active: true,
          principalId: 'user-1',
        }),
      ).model,
    ).toEqual(next)
  })

  it('keeps the saved state on failure, and requires sign-in when the session expired', () => {
    const saving = update(loaded('active'), Message.Toggled()).model

    const failed = update(
      saving,
      Message.SaveFailed({
        generation: saving.generation,
        unauthorized: false,
        principalId: 'user-1',
      }),
    ).model

    expect(failed).toMatchObject({
      status: 'active',
      saving: false,
      notice: 'Favorite could not be saved. Try again.',
    })

    const expired = update(
      update(failed, Message.Toggled()).model,
      Message.SaveFailed({
        generation: saving.generation,
        unauthorized: true,
        principalId: 'user-1',
      }),
    ).model

    expect(expired.status).toBe('anonymous')
  })

  it('shows a retry after a failed load and reloads on request', () => {
    const loading = sync(initialModel, track('mix-a'), 'user-1').model

    const unavailable = update(
      loading,
      Message.Loaded({
        generation: loading.generation,
        state: 'unavailable',
        principalId: 'user-1',
        principalKnown: true,
      }),
    ).model

    expect(unavailable).toMatchObject({
      status: 'unavailable',
      notice: 'Favorite status could not be loaded.',
    })

    const retried = update(unavailable, Message.Retried())
    expect(retried.model).toMatchObject({ status: 'loading', notice: null })
    expect(retried.commands?.map(({ name }) => name)).toEqual(['PlayerFavorite.Load'])
  })

  it('adopts acknowledged changes from another control only for the same idle track', () => {
    const inactive = loaded()
    const adopted = reconcile(inactive, 'mix-a', true, 18)
    expect(adopted.status).toBe('active')

    expect(
      update(
        adopted,
        Message.Saved({
          generation: inactive.generation,
          audioId: 'mix-a',
          active: false,
          principalId: 'user-1',
        }),
      ).model,
    ).toEqual(adopted)
    expect(reconcile(inactive, 'mix-b', true, 18)).toBe(inactive)

    const saving = update(inactive, Message.Toggled()).model
    expect(reconcile(saving, 'mix-a', false, 18)).toBe(saving)

    const loading = sync(initialModel, track('mix-a'), 'user-1').model
    const settled = reconcile(loading, 'mix-a', true, 18)
    expect(
      update(
        settled,
        Message.Loaded({
          generation: loading.generation,
          state: 'inactive',
          principalId: 'user-1',
          principalKnown: true,
        }),
      ).model.status,
    ).toBe('active')
  })

  it('owns a four-second notice command and ignores its stale dismissals after retry or context changes', async () => {
    const fail = (model: typeof initialModel) => {
      const saving = update(model, Message.Toggled()).model

      return update(
        saving,
        Message.SaveFailed({
          generation: saving.generation,
          unauthorized: false,
          principalId: 'user-1',
        }),
      )
    }

    const first = fail(loaded())
    const timer = first.commands?.[0]
    expect(timer?.name).toBe('PlayerFavorite.DismissNotice')

    if (!timer) throw new Error('Expected a notice timer')

    const runtime = ManagedRuntime.make(TestClock.layer())

    try {
      const dismissed = await runtime.runPromise(
        Effect.gen(function* () {
          const delivered: Array<ActualMessage> = []

          const fiber = yield* timer.effect.pipe(
            Effect.tap((message) => Effect.sync(() => delivered.push(message))),
            Effect.forkChild,
          )

          yield* TestClock.adjust('3999 millis')
          expect(delivered).toEqual([])
          yield* TestClock.adjust('1 millis')

          return yield* Fiber.join(fiber)
        }),
      )

      const hidden = update(first.model, dismissed).model
      expect(hidden.notice).toBeNull()
      expect(hidden.status).toBe('inactive')
      const second = fail(hidden).model
      expect(second.notice).toBe(first.model.notice)
      expect(second.noticeId).toBeGreaterThan(first.model.noticeId)
      expect(update(second, dismissed).model).toBe(second)

      for (const changed of [
        sync(second, track('mix-b'), 'user-1').model,
        sync(second, track('mix-a'), 'user-2').model,
        update(second, Message.Toggled()).model,
      ]) {
        expect(changed.notice).toBeNull()
        expect(update(changed, dismissed).model).toBe(changed)
      }
    } finally {
      await runtime.dispose()
    }
  })
})
