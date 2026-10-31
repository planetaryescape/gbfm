import { expect, test } from 'vitest'

import { generateCSS, toVars } from './css'
import { brandDark, brandLight } from './tokens/brand'
import { controlMetrics, radii } from './tokens/geometry'
import { dark, light, studio } from './tokens/shadcn'

function themeBlock(css: string, selector: string): string {
  const start = css.indexOf(selector)
  const end = css.indexOf('\n  }', start)

  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)

  return css.slice(start, end)
}

test('serializes token names and values as indented CSS custom-property declarations', () => {
  expect(toVars({ background: 'red', cardForeground: 'white', 'pastel-green-1': '#b6fadf' })).toBe(
    '    --background: red;\n    --card-foreground: white;\n    --pastel-green-1: #b6fadf;',
  )
  expect(toVars({ highlightRgb: '85, 206, 246' }, '  ')).toBe('  --highlight-rgb: 85, 206, 246;')
})

test('all themes serialize the same geometry used by native controls', () => {
  const css = generateCSS()

  for (const selector of ['[data-theme="light"]', '[data-theme="dark"]', '[data-theme="studio"]']) {
    const block = themeBlock(css, selector)

    expect(block).toContain(`--radius-control: ${radii.control}px;`)
    expect(block).toContain(`--radius-surface: ${radii.surface}px;`)
    expect(block).toContain(`--radius-overlay: ${radii.overlay}px;`)
    expect(block).toContain(`--radius-artwork: ${radii.artwork}px;`)
    expect(block).toContain(`--control-height: ${controlMetrics.height}px;`)
    expect(block).toContain(`--control-font-size: ${controlMetrics.fontSize}px;`)
  }
})

test('places brand and semantic tokens in their light, dark, and studio selectors', () => {
  const css = generateCSS()

  expect(css).toContain('@layer base {')
  expect(css.trimEnd().endsWith('}')).toBe(true)
  expect(css).toContain(':root,\n  .light,\n  [data-theme="light"] {')
  expect(css).toContain('.dark,\n  [data-theme="dark"] {')
  expect(css).toContain('[data-theme="studio"] {')

  const lightBlock = themeBlock(css, '[data-theme="light"]')
  const darkBlock = themeBlock(css, '[data-theme="dark"]')
  const studioBlock = themeBlock(css, '[data-theme="studio"]')

  expect(lightBlock).toContain(`--highlight-rgb: ${brandLight.highlightRgb};`)
  expect(lightBlock).toContain(`--background: ${light.background};`)
  expect(darkBlock).toContain(`--highlight-rgb: ${brandDark.highlightRgb};`)
  expect(darkBlock).toContain(`--background: ${dark.background};`)
  expect(studioBlock).toContain(`--highlight-rgb: ${brandDark.highlightRgb};`)
  expect(studioBlock).toContain(`--background: ${studio.background};`)

  expect(lightBlock).not.toContain('--background-hex:')
  expect(darkBlock).not.toContain('--background-hex:')
  expect(studioBlock).not.toContain('--background-hex:')
  expect(darkBlock.match(/--highlight:/g)).toHaveLength(1)
})
