import { EditorView } from '@codemirror/view'
import { Mount, UiSchema } from '@effect/ui'
import { BrowserHost, Html } from '@effect/ui/html'
import { Effect, Layer, Schema } from 'effect'

import { AttachMarkdownEditor } from '../editor'

const CreatorEditorDomFixtureMessage = UiSchema.TaggedEnum({
  UpdatedPending: { value: Schema.String },
  ClickedApplyRemote: {},
  ChangedEditor: { value: Schema.String },
  ClickedFocus: {},
  ClickedReleaseFocus: {},
  ClickedToggleEditor: {},
})

const CreatorEditorDomFixtureModel = Schema.Struct({
  content: Schema.String,
  pending: Schema.String,
  focus: Schema.Boolean,
  shown: Schema.Boolean,
  belowFold: Schema.Boolean,
})

const CreatorEditorDomFixture = Html.component({
  name: 'CreatorEditorDomFixture',
  model: CreatorEditorDomFixtureModel,
  message: CreatorEditorDomFixtureMessage,
}).make({
  init: () => ({
    content: 'Initial saved body',
    pending: '',
    focus: false,
    shown: true,
    belowFold: location.hash === '#offscreen',
  }),
  update: ($, message) =>
    CreatorEditorDomFixtureMessage.match(message, {
      UpdatedPending: ({ value }) => $.evolve({ pending: value }),
      ClickedApplyRemote: () => $.evolve({ content: $.model.pending }),
      ChangedEditor: ({ value }) => $.evolve({ content: value }),
      ClickedFocus: () => $.evolve({ focus: true }),
      ClickedReleaseFocus: () => $.evolve({ focus: false }),
      ClickedToggleEditor: () => $.evolve({ shown: !$.model.shown }),
    }),
  view: (h, model) =>
    h.main.children(
      h.input
        .attr('aria-label', 'Pending remote source')
        .value(model.pending)
        .on('input', ({ value }) => CreatorEditorDomFixtureMessage.UpdatedPending({ value })),
      h.button
        .on('click', CreatorEditorDomFixtureMessage.ClickedApplyRemote())
        .children('Apply remote source'),
      h.button.on('click', CreatorEditorDomFixtureMessage.ClickedFocus()).children('Focus editor'),
      h.button
        .on('click', CreatorEditorDomFixtureMessage.ClickedReleaseFocus())
        .children('Release focus intent'),
      h.button
        .on('click', CreatorEditorDomFixtureMessage.ClickedToggleEditor())
        .children('Toggle editor'),
      h.output.attr('aria-label', 'Current source').children(model.content),
      model.belowFold && h.div.key('spacer').style({ height: '2400px' }),
      model.shown &&
        h.div
          .key('editor')
          .onMount(
            AttachMarkdownEditor({ content: model.content, focus: model.focus }).pipe(
              Mount.map((value) => CreatorEditorDomFixtureMessage.ChangedEditor({ value })),
            ),
          ),
    ),
})

const target = document.getElementById('app')

if (!target) throw new Error('The isolated editor fixture needs an app container.')

declare global {
  interface Window {
    readCreatorEditor: () => {
      count: number
      document: string | null
      text: string | null
      visibleText: string | null
    }
  }
}

window.readCreatorEditor = () => {
  const elements = document.querySelectorAll<HTMLElement>(
    '[role="textbox"][aria-label="Writing canvas"]',
  )

  if (elements.length !== 1)
    return { count: elements.length, document: null, text: null, visibleText: null }
  const element = elements.item(0)
  const editor = element ? EditorView.findFromDOM(element) : null

  return {
    count: elements.length,
    document: editor?.state.doc.toString() ?? null,
    text: element?.textContent ?? null,
    visibleText: element?.innerText ?? null,
  }
}

Layer.launch(BrowserHost.mount(CreatorEditorDomFixture, {}, target)).pipe(Effect.runFork)
