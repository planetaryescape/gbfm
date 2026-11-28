import { STATIC_SITE_METADATA } from '@gbfm/site-metadata'

export const staticPages = new Map([
  ['spotify-callback', { title: 'Spotify connection', paragraphs: [] }],
  ['invite/charlie3000', { title: 'An invitation for Charlie3000', paragraphs: [] }],
  [
    'about',
    {
      title: 'About',
      paragraphs: [STATIC_SITE_METADATA.about.description],
    },
  ],
  [
    'privacy',
    {
      title: 'Privacy Policy',
      paragraphs: [
        'We store the minimum information needed to run goosebumps.fm: account information, activity you choose to create, and basic service analytics.',
        'We do not sell your personal information. Authentication cookies are used to keep you signed in, and operational analytics help us keep the service reliable.',
        'Contact us if you want to ask about, correct, or remove your account information.',
      ],
    },
  ],
  [
    'terms',
    {
      title: 'Terms of Service',
      paragraphs: [
        'Use goosebumps.fm in good faith and respect the people whose work appears here.',
        'Do not scrape or abuse the service, impersonate another person, interfere with the service, or upload content you do not have permission to share.',
        'We may remove content or suspend accounts that violate these terms or put the service and its community at risk.',
      ],
    },
  ],
  [
    'changelog',
    {
      title: 'Changelog',
      paragraphs: [
        'Latest release notes, updates and fixes from goosebumps.fm.',
        'Release history is published with each goosebumps.fm update.',
      ],
    },
  ],
])

export const aboutLinks = [
  {
    heading: 'Follow',
    links: [
      ['/rss.xml', 'Mixes via RSS'],
      ['https://youtube.com/@goosebumpsfm', 'Mixes via YouTube'],
      ['/subscribe', 'Email updates'],
    ],
  },
  {
    heading: 'Site',
    links: [
      ['/changelog', 'Changelog'],
      ['/privacy', 'Privacy policy'],
      ['/terms', 'Terms of service'],
    ],
  },
] as const
