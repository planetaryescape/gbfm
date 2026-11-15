import { inertHtml as h } from 'foldkit/html'

export const iconPaths = {
  chevronLeft: 'm15 18-6-6 6-6',
  chevronRight: 'm9 18 6-6-6-6',
  home: 'm3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',
  link: 'M9 17H7A5 5 0 0 1 7 7h2 M15 7h2a5 5 0 1 1 0 10h-2 M8 12h8',
  edit: 'M12 20h9 M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z',
  replies:
    'M5 4h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-8l-5 4v-4H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M8 12a2 2 0 0 0 2-2V8H8 M14 12a2 2 0 0 0 2-2V8h-2',
  externalLink: 'M15 3h6v6 M10 14 21 3 M18 13v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h7',
  music:
    'M9 18V5l12-2v13 M9 9l12-2 M3 18a3 3 0 1 0 6 0a3 3 0 1 0-6 0 M15 16a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  shuffle:
    'm18 14 4 4-4 4 m18 2 4 4-4 4 M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-7.6a4 4 0 0 1 3.3-1.7H22 M2 6h1.972a4 4 0 0 1 3.289 1.723l.311.454 M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45',
  sparkles:
    'M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z M20 3v4 M22 5h-4 M4 17v2 M5 18H3',
  play: 'M7 4v16l13-8z',
  heart: 'M3 5H9V8H15V5H21V14H18V17H15V20H9V17H6V14H3Z',
  listPlus: 'M11 12H3 M16 6H3 M16 18H3 M18 9v6 M21 12h-6',
  search: 'm21 21-4.34-4.34 M19 11a8 8 0 1 1-16 0a8 8 0 1 1 16 0',
  disc: 'M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0 M14 12a2 2 0 1 1-4 0a2 2 0 1 1 4 0 M12 6.5a5.5 5.5 0 0 1 5.5 5.5',
  editorial:
    'M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M9 7h6v2H9z M9 13h6 M9 17h4',
  menu: 'M4 12h16 M4 6h16 M4 18h16',
  tabs: 'M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z M9 6v12 M15 6v12',
  info: 'M22 12a10 10 0 1 1-20 0a10 10 0 1 1 20 0 M12 16v-4 M12 8h.01',
  chevronDown: 'm6 9 6 6 6-6',
  list: 'M3 12h.01 M3 18h.01 M3 6h.01 M8 12h13 M8 18h13 M8 6h13',
  volumeOff:
    'M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z M22 9l-6 6 M16 9l6 6',
  pause: 'M6 4h4v16H6z M14 4h4v16h-4z',
  skipBack: 'M19 5v14L9 12z M5 5v14',
  skipForward: 'M5 5v14l10-7z M19 5v14',
  close: 'M18 6 6 18 M6 6l12 12',
  radio:
    'M4 9h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z M7 9l9-5 M11.5 14.5a3 3 0 1 1-6 0a3 3 0 1 1 6 0 M15 13h3 M15 16h3',
  message: 'M5 4h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-8l-5 4v-4H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z',
  album:
    'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M17 12a5 5 0 1 1-10 0a5 5 0 1 1 10 0 M12 12h.01',
  mail: 'm21 7-8.4 5.4a1 1 0 0 1-1.2 0L3 7 M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  upload: 'M21 15v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5 M17 8l-5-5-5 5 M12 3v12',
  rss: 'M4 11a9 9 0 0 1 9 9 M4 4a16 16 0 0 1 16 16 M5 19a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
  youtube:
    'M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17 M10 15l5-3-5-3z',
  dashboard: 'M3 3h7v9H3z M14 3h7v5h-7z M14 12h7v9h-7z M3 16h7v5H3z',
  logIn: 'M15 3h5a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-5 M10 17l5-5-5-5 M15 12H3',
  logOut: 'M9 21H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5 M16 17l5-5-5-5 M21 12H9',
  volume:
    'M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z M16 9a5 5 0 0 1 0 6 M19.364 18.364a9 9 0 0 0 0-12.728',
} as const

export const lucide = (path: string, className: string) =>
  h.svg(
    [
      h.Class(className),
      h.ViewBox('0 0 24 24'),
      h.Fill('none'),
      h.Stroke('currentColor'),
      h.StrokeWidth('2'),
      h.StrokeLinecap('round'),
      h.StrokeLinejoin('round'),
      h.AriaHidden(true),
    ],
    [h.path([h.D(path)])],
  )

export const pixelPlayPath = 'M6 4V20H10V17H14V14H18V10H14V7H10V4Z'

export const pixelIcon = (path: string, className: string, filled = false) =>
  h.svg(
    [
      h.Class(className),
      h.ViewBox('0 0 24 24'),
      h.Fill(filled ? 'currentColor' : 'none'),
      h.Stroke(filled ? 'none' : 'currentColor'),
      h.StrokeWidth('2'),
      h.StrokeLinecap('square'),
      h.StrokeLinejoin('miter'),
      h.AriaHidden(true),
    ],
    [h.path([h.D(path)])],
  )

const spotifyPath =
  'M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z'

export const spotifyIcon = (className: string) =>
  h.svg(
    [h.Class(className), h.ViewBox('0 0 24 24'), h.Fill('#1DB954'), h.AriaHidden(true)],
    [h.path([h.D(spotifyPath)])],
  )
