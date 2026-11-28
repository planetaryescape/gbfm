import { Html } from '@effect/ui/html'
import { Schema } from 'effect'

export const InvitationPage = Html.component({
  name: 'InvitationPage',
  model: Schema.Struct({}),
  message: Schema.Never,
}).make({
  init: () => ({}),
  update: ($) => $.model,
  view: (h) =>
    h.section.class('invitation').children(
      h.div.children(
        h.p.class('invitation-eyebrow').children('An invitation'),
        h.h1.children('hi Charlie! I’d love to host a guest mix from you'),
        h.p
          .class('invitation-description')
          .children(
            'Your Rinse FM residency has become a refuge and a source of so many adored discoveries. I’d love to host and carefully archive some of that magic here, starting with one mix.',
          ),
        h.div
          .class('invitation-links')
          .children(
            h.a.attr('href', '/kimetsu').children('See kimetsu.’s page'),
            h.a.attr('href', '/djs').children('Meet the residents'),
          ),
        h.blockquote.children('Your mix gets a proper page, archived with care.'),
      ),
      h.aside.children(
        h.h2.children('A guest mix, with room for more'),
        h.dl.children(
          [
            ['Stipend', '€100 per mix'],
            ['Format', 'Guest mix on the main show'],
            ['Cadence', 'Start with one, open to more'],
          ].map(([label, value]) => h.div.children(h.dt.children(label), h.dd.children(value))),
        ),
      ),
    ),
})
