import type { Html, HtmlBuilder } from 'foldkit/html'

import { Message } from './message'
import { TWEET_MAX_LENGTH, type Model } from './model'

type Builder = HtmlBuilder<typeof Message.Type>

const TWEET_COUNT_ID = 'creator-tweet-count'

const onTitleInput = (value: string) => Message.Changed({ field: 'title', value })

const tweetText = (model: Model, h: Builder): Html => {
  const length = model.draft.title.length
  const overLimit = length > TWEET_MAX_LENGTH

  return h.label(
    [h.Class('creator-tweet')],
    [
      h.span([h.Class('sr-only')], ['Title']),
      h.textarea([
        h.Value(model.draft.title),
        h.AriaLabel('Title'),
        h.AriaDescribedBy(TWEET_COUNT_ID),
        h.AriaInvalid(overLimit),
        h.Rows(3),
        h.Maxlength(TWEET_MAX_LENGTH + 100),
        h.Placeholder('What’s playing?'),
        h.OnInput(onTitleInput),
      ]),
      h.small(
        [
          h.Id(TWEET_COUNT_ID),
          h.Class(overLimit ? 'creator-tweet-count is-over' : 'creator-tweet-count'),
        ],
        [`${length}/${TWEET_MAX_LENGTH}`],
      ),
    ],
  )
}

const headline = (model: Model, h: Builder): Html =>
  h.label(
    [h.Class('creator-title')],
    [
      h.span([h.Class('sr-only')], ['Title']),
      h.textarea([
        h.Value(model.draft.title),
        h.AriaLabel('Title'),
        h.Rows(1),
        h.Maxlength(500),
        h.Placeholder('Story title'),
        h.OnInput(onTitleInput),
      ]),
    ],
  )

export const titleField = (model: Model, h: Builder): Html =>
  model.draft.kind === 'micro' ? tweetText(model, h) : headline(model, h)

export const bodyEditorToggle = (h: Builder): Html =>
  h.button(
    [
      h.Type('button'),
      h.Class('btn btn-quiet btn-sm creator-body-toggle'),
      h.AriaExpanded(false),
      h.OnClick(Message.BodyEditorOpened()),
    ],
    ['+ Add a longer note'],
  )
