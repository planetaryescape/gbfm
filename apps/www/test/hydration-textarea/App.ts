import { UiSchema } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { Schema } from 'effect'

export const TextareaProps = Schema.Struct({ initialSource: Schema.String })

const TextareaMessage = UiSchema.TaggedEnum({
  UpdatedSource: { value: Schema.String },
  ChangedSource: {},
  AppliedRemoteSource: {},
})

export const TextareaApp = Html.component({
  name: 'HydrationTextareaFixture',
  props: TextareaProps,
  model: Schema.Struct({
    source: Schema.String,
    inputCount: Schema.Number,
    changeCount: Schema.Number,
  }),
  message: TextareaMessage,
}).make({
  init: ({ props }) => ({ source: props.initialSource, inputCount: 0, changeCount: 0 }),
  update: {
    UpdatedSource: ($, { value }) => $.evolve({ source: value, inputCount: (count) => count + 1 }),
    ChangedSource: ($) => $.evolve({ changeCount: (count) => count + 1 }),
    AppliedRemoteSource: ($) => $.evolve({ source: 'Later server source' }),
  },
  view: (h, model) =>
    h.main.children(
      h.h1('Textarea hydration fixture'),
      h.textarea
        .attrs({ name: 'source', 'aria-label': 'Source' })
        .value(model.source)
        .on('input', ({ value }) => TextareaMessage.UpdatedSource({ value }))
        .on('change', TextareaMessage.ChangedSource()),
      h.output.attr('aria-label', 'Model source').children(model.source),
      h.output.attr('aria-label', 'Input count').children(String(model.inputCount)),
      h.output.attr('aria-label', 'Change count').children(String(model.changeCount)),
      h.button.on('click', TextareaMessage.AppliedRemoteSource()).children('Apply remote source'),
    ),
})
