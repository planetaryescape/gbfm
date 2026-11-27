import { history, insertNewlineAndIndent, redo, selectAll, undo } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { Component, Mount } from '@effect/ui'
import { Effect, Queue, Schema, Stream } from 'effect'

export const FocusAttachmentInput = Mount.make(
  'FocusAttachmentInput',
  { args: {} },
  (node: HTMLInputElement) => Effect.sync(() => node.focus()).pipe(Effect.as(Component.noop)),
)

export const FocusAttachmentTool = Mount.make(
  'FocusAttachmentTool',
  { args: {} },
  (node: HTMLButtonElement) => Effect.sync(() => node.focus()).pipe(Effect.as(Component.noop)),
)

export const AttachMarkdownEditor = Mount.makeStream(
  'AttachMarkdownEditor',
  { args: { content: Schema.String, focus: Schema.Boolean } },
  (node: HTMLElement, args, changes) =>
    Stream.callback<string>(
      Effect.fnUntraced(function* (queue) {
        const editor = yield* Effect.acquireRelease(
          Effect.sync(
            () =>
              new EditorView({
                parent: node,
                state: EditorState.create({
                  doc: args.content,
                  extensions: [
                    markdown(),
                    history(),
                    lineNumbers(),
                    keymap.of([
                      { key: 'Mod-z', run: undo, preventDefault: true },
                      { key: 'Mod-Shift-z', run: redo, preventDefault: true },
                      { key: 'Mod-y', run: redo, preventDefault: true },
                      { key: 'Mod-a', run: selectAll },
                      { key: 'Enter', run: insertNewlineAndIndent },
                    ]),
                    EditorView.lineWrapping,
                    EditorView.contentAttributes.of({
                      'aria-label': 'Writing canvas',
                      role: 'textbox',
                      'aria-multiline': 'true',
                    }),
                    EditorView.updateListener.of((update) => {
                      if (update.docChanged) Queue.offerUnsafe(queue, update.state.doc.toString())
                    }),
                  ],
                }),
              }),
          ),
          (editor) => Effect.sync(() => editor.destroy()),
        )

        let focused = args.focus

        if (args.focus) editor.focus()

        yield* Stream.runForEach(changes, ({ content, focus }) =>
          Effect.sync(() => {
            if (editor.state.doc.toString() !== content)
              editor.dispatch({
                changes: { from: 0, to: editor.state.doc.length, insert: content },
              })

            if (focus && !focused) editor.focus()
            focused = focus
          }),
        ).pipe(Effect.forkScoped)
      }),
    ),
)

export const WarnBeforeLeave = Mount.make(
  'WarnBeforeLeave',
  { args: { dirty: Schema.Boolean } },
  (_node: HTMLElement, _args, changes) =>
    Effect.gen(function* () {
      let dirty = false

      const listener = (event: BeforeUnloadEvent) => {
        if (dirty) {
          event.preventDefault()
          event.returnValue = ''
        }
      }

      yield* Effect.acquireRelease(
        Effect.sync(() => window.addEventListener('beforeunload', listener)),
        () => Effect.sync(() => window.removeEventListener('beforeunload', listener)),
      )

      return yield* Stream.runForEach(changes, (args) =>
        Effect.sync(() => {
          dirty = args.dirty
        }),
      ).pipe(Effect.as(Component.noop))
    }),
)
