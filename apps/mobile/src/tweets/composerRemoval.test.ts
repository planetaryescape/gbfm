import { Data, Predicate } from 'effect'
import { expect, test } from 'vitest'

import type { ComposerPublication } from './composerOwner'
import {
  composerRemovalWarning,
  continueComposerRemoval,
  requestComposerRemoval,
} from './composerRemoval'
import { emptyTweetDraft } from './draft'

const Publication = Data.taggedEnum<ComposerPublication>()

const states = [
  Publication.CleanupPending({ draft: emptyTweetDraft('fixed'), slug: 'published' }),
  Publication.ReplyUncertain({ draft: emptyTweetDraft('fixed'), message: 'Check thread' }),
]

test.each(
  states.flatMap((publication) =>
    ['hardware-back', 'replace', 'parent-pop'].map((action) => ({ publication, action })),
  ),
)(
  '$action preserves a protected composer until explicit continuation ($publication._tag)',
  ({ publication, action }) => {
    const removals: Array<string> = []
    const prompts: Array<{ readonly title: string; readonly confirm: () => void }> = []
    requestComposerRemoval(
      composerRemovalWarning(publication),
      (warning, confirm) => prompts.push({ title: warning.title, confirm }),
      () => removals.push(action),
    )
    expect(removals).toEqual([])
    expect(prompts).toHaveLength(1)

    for (const prompt of prompts) {
      expect(prompt.title).toBe(
        Predicate.isTagged(publication, 'CleanupPending')
          ? 'Already published'
          : 'Check the thread first',
      )
      prompt.confirm()
      prompt.confirm()
    }

    expect(removals).toEqual([action])
  },
)

test.each([Publication.Writable(), Publication.Published({ slug: 'published' })])(
  'ordinary and successfully cleaned composers do not need removal confirmation (%s)',
  (publication) => {
    const events: Array<string> = []
    requestComposerRemoval(
      composerRemovalWarning(publication),
      () => events.push('warning'),
      () => events.push('remove'),
    )
    expect(events).toEqual(['remove'])
  },
)

const navigationFixture = () => {
  const warning = composerRemovalWarning(states[0] ?? Publication.Writable())
  let prevented = true
  const prompts: Array<() => void> = []
  const events: Array<string> = []

  const disable = () => {
    prevented = false
    events.push('disable')
  }

  const navigate = (action: string): void => {
    if (prevented) {
      requestComposerRemoval(
        warning,
        (_prompt, confirm) => prompts.push(confirm),
        () => continueComposerRemoval(disable, () => navigate(action)),
      )

      return
    }

    events.push(action)
  }

  return { warning, prompts, events, disable, navigate }
}

test('Cancel warns once and disables prevention before closing, without a second removal alert', () => {
  const navigation = navigationFixture()
  requestComposerRemoval(
    navigation.warning,
    (_warning, confirm) => navigation.prompts.push(confirm),
    () => continueComposerRemoval(navigation.disable, () => navigation.navigate('cancel')),
  )
  expect(navigation.events).toEqual([])
  expect(navigation.prompts).toHaveLength(1)

  navigation.prompts[0]?.()
  expect(navigation.prompts).toHaveLength(1)
  expect(navigation.events).toEqual(['disable', 'cancel'])
})

test('a prevented system action resumes its supplied action only after confirmation', () => {
  const navigation = navigationFixture()
  navigation.navigate('system-pop')
  expect(navigation.events).toEqual([])
  expect(navigation.prompts).toHaveLength(1)

  navigation.prompts[0]?.()
  expect(navigation.prompts).toHaveLength(1)
  expect(navigation.events).toEqual(['disable', 'system-pop'])
})

test.each(['cleanup-success', 'check-thread'])(
  '%s navigation bypasses a stale cleanup-pending removal guard',
  (action) => {
    const navigation = navigationFixture()
    continueComposerRemoval(navigation.disable, () => navigation.navigate(action))
    expect(navigation.prompts).toEqual([])
    expect(navigation.events).toEqual(['disable', action])
  },
)
