import { Html } from '@effect/ui/html'
import { PublicProfileResponse } from '@gbfm/api/profile'
import { Schema } from 'effect'

import { artwork, imageSource } from '../../ui/artwork'
import { iconPaths, lucide } from '../../ui/icons'
import { SocialIcon } from './social-icon'

const socialLabels = {
  bandcamp: 'Bandcamp',
  substack: 'Substack',
  soundcloud: 'SoundCloud',
  instagram: 'Instagram',
  twitter: 'X / Twitter',
  tiktok: 'TikTok',
}

interface ProfileItem {
  readonly id: string
  readonly slug: string
  readonly title: string | null
  readonly thumbnailUrl?: string | null
  readonly draft?: boolean
}

const ContentSection = <M>(
  h: Html.H<M>,
  title: string,
  path: string,
  items: ReadonlyArray<ProfileItem>,
) =>
  items.length > 0 &&
  h.section
    .class('profile-section')
    .attr('aria-label', title)
    .children(
      h.div
        .class('profile-section-heading')
        .children(
          h.h2.children(title),
          h.span.class('profile-section-count').children(String(items.length)),
        ),
      h.div.class('profile-grid').children(
        items.map((item) =>
          h.a
            .key(item.id)
            .attr('href', `/${path}/${encodeURIComponent(item.slug)}`)
            .class('profile-card')
            .children(
              'thumbnailUrl' in item &&
                h.div.class('profile-card-art').children(artwork(h, item.thumbnailUrl, '', '72px')),
              h.div
                .class('profile-card-copy')
                .children(
                  h.h3.children(item.title || item.slug),
                  item.draft && h.span.class('profile-draft').children('Draft'),
                ),
            ),
        ),
      ),
    )

export const ProfilePageProps = Schema.Struct({ profile: PublicProfileResponse })

export const ProfilePage = Html.component({
  name: 'ProfilePage',
  props: ProfilePageProps,
  model: Schema.Struct({}),
  message: Schema.Never,
}).make({
  init: () => ({}),
  update: ($) => $.model,
  view: (h) => {
    const { profile } = h.props

    const sections = [
      { title: 'Mixes', path: 'mixes', items: profile.content.mixes },
      { title: 'Shows', path: 'shows', items: profile.content.shows },
      { title: 'Editorial', path: 'editorial', items: profile.content.editorials },
      { title: 'Tweets', path: 'tweet', items: profile.content.tweets },
    ]

    return h.div.class('public-profile').children(
      h.aside.class('profile-identity').children(
        profile.image &&
          imageSource(h, profile.image).attr('alt', profile.name).class('profile-avatar'),
        h.p.class('profile-eyebrow').children('On Goosebumps'),
        h.h1.children(profile.name),
        profile.username && h.p.class('muted').children(`@${profile.username}`),
        profile.bio && h.p.class('content-paragraph').children(profile.bio),
        profile.socialLinks.length > 0 &&
          h.nav
            .attr('aria-label', 'Social links')
            .class('profile-socials')
            .children(
              profile.socialLinks.map(({ platform, url }) =>
                h.a
                  .key(platform)
                  .attr('href', url)
                  .attr('target', '_blank')
                  .attr('rel', 'noopener noreferrer')
                  .attr('aria-label', `${socialLabels[platform]} (opens in a new tab)`)
                  .class(`profile-social profile-social-${platform}`)
                  .children(
                    SocialIcon(h, platform),
                    h.span.children(socialLabels[platform]),
                    lucide(h, iconPaths.externalLink, 'profile-social-external'),
                  ),
              ),
            ),
      ),
      h.div.class('profile-content').children(
        sections.map((section) => ContentSection(h, section.title, section.path, section.items)),
        sections.every((section) => section.items.length === 0) &&
          h.p.children('No public content yet.'),
      ),
    )
  },
})
