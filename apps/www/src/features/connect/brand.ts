import source from '../../../public/wordmark.svg?raw'

const paths = source
  .replace(/^<svg[^>]*>/, '')
  .replace(/ class="opacity-30[^"]*"/, ' opacity="0.3"')
  .replace(/ class="[^"]*"/g, '')

const svg = (viewBox: string, className: string) =>
  `<svg class="${className}" viewBox="${viewBox}" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">${paths}`

export const brandWordmark = svg('200 262 442 71', 'wordmark')

export const brandMark = svg('200 117 442 361', 'mark')
