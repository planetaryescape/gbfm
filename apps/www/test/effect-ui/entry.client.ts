import { HtmlHydrate } from '@effect/ui/html'
import { Effect, Schema } from 'effect'

// oxlint-disable-next-line import/no-unassigned-import -- Vite emits the no-JavaScript document stylesheet from this entry.
import '../../src/styles/main.css'
import { FixtureApp, FixtureIdentity, FixtureProps } from './App'

const container = document.getElementById('root')

const propsText = document.getElementById('gbfm-ui-props')?.textContent

const stateText = document.getElementById('gbfm-ui-state')?.textContent

const State = Schema.Record(Schema.String, Schema.Unknown)

if (!container || !propsText || !stateText) throw new Error('Missing fixture hydration document')

const props = Schema.decodeUnknownSync(Schema.fromJsonString(FixtureProps))(propsText)

const state = Schema.decodeUnknownSync(Schema.fromJsonString(State))(stateText)

const original = container.firstElementChild

Effect.runFork(
  Effect.gen(function* () {
    const root = yield* HtmlHydrate.hydrateEffect(FixtureApp, props, container, state)
    yield* root.adopted
    container.dataset.adopted = 'true'
    container.dataset.preserved = String(original === container.firstElementChild)

    return yield* Effect.never
  }).pipe(
    Effect.scoped,
    Effect.provideService(FixtureIdentity, { read: Effect.succeed('Anonymous') }),
  ),
)
