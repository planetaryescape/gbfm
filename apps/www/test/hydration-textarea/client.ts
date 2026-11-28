import { HtmlHydrate } from '@effect/ui/html'
import { Effect, Schema } from 'effect'

import { TextareaApp, TextareaProps } from './App'

const container = document.getElementById('app')

const propsText = document.getElementById('fixture-props')?.textContent

const stateText = document.getElementById('fixture-state')?.textContent

if (!container || !propsText || !stateText) throw new Error('Missing textarea fixture document')

const props = Schema.decodeUnknownSync(Schema.fromJsonString(TextareaProps))(propsText)

const state = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
)(stateText)

Effect.runFork(
  Effect.gen(function* () {
    const root = yield* HtmlHydrate.hydrateEffect(TextareaApp, props, container, state)
    yield* root.adopted
    container.dataset.adopted = 'true'

    return yield* Effect.never
  }).pipe(Effect.scoped),
)
