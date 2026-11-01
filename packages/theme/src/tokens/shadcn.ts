import { radii } from './geometry'

export interface SemanticTokens {
  highlight: string
  highlightForeground: string
  background: string
  backgroundHex: string
  foreground: string
  card: string
  cardForeground: string
  popover: string
  popoverForeground: string
  primary: string
  primaryForeground: string
  secondary: string
  secondaryForeground: string
  muted: string
  mutedForeground: string
  accent: string
  accentForeground: string
  destructive: string
  destructiveForeground: string
  success: string
  successForeground: string
  warning: string
  warningForeground: string
  border: string
  input: string
  ring: string
  radius: string
}

export const light: SemanticTokens = {
  highlight: 'hsl(213 90% 55%)',
  highlightForeground: '#111827',
  background: 'hsl(213 50% 93%)',
  backgroundHex: '#e4ecf6',
  foreground: 'hsl(213 35% 16%)',
  card: 'hsl(213 30% 99%)',
  cardForeground: 'hsl(213 35% 14%)',
  popover: 'hsl(213 30% 99%)',
  popoverForeground: 'hsl(213 35% 14%)',
  primary: 'hsl(213 60% 32%)',
  primaryForeground: 'hsl(213 40% 97%)',
  secondary: 'hsl(213 45% 90%)',
  secondaryForeground: 'hsl(213 35% 18%)',
  muted: 'hsl(213 40% 88%)',
  mutedForeground: 'hsl(213 22% 42%)',
  accent: 'hsl(213 55% 86%)',
  accentForeground: 'hsl(213 60% 26%)',
  destructive: 'hsl(0 72% 42%)',
  destructiveForeground: 'hsl(0 0% 100%)',
  success: 'hsl(142 72% 29%)',
  successForeground: 'hsl(142 78% 18%)',
  warning: 'hsl(38 92% 38%)',
  warningForeground: 'hsl(30 90% 20%)',
  border: 'hsl(213 25% 84%)',
  input: 'hsl(213 25% 82%)',
  ring: 'hsl(213 60% 35%)',
  radius: `${radii.surface}px`,
}

export const dark: SemanticTokens = {
  highlight: 'hsl(195 95% 65%)',
  highlightForeground: '#111827',
  background: 'hsl(202, 61%, 22%)',
  backgroundHex: '#16415a',
  foreground: 'hsl(195, 55%, 72%)',
  card: 'hsl(215 35% 10%)',
  cardForeground: 'hsl(195, 55%, 72%)',
  popover: 'hsl(215 35% 10%)',
  popoverForeground: 'hsl(195, 55%, 72%)',
  primary: 'hsl(195, 65%, 68%)',
  primaryForeground: 'hsl(215 45% 10%)',
  secondary: 'hsl(215 30% 18%)',
  secondaryForeground: 'hsl(195, 55%, 72%)',
  muted: 'hsl(215 28% 20%)',
  mutedForeground: 'hsl(195 35% 60%)',
  accent: 'hsl(215 30% 18%)',
  accentForeground: 'hsl(195, 55%, 72%)',
  destructive: 'hsl(0 62.8% 30.6%)',
  destructiveForeground: 'hsl(0 0% 100%)',
  success: 'hsl(142 69% 58%)',
  successForeground: 'hsl(142 70% 72%)',
  warning: 'hsl(45 93% 55%)',
  warningForeground: 'hsl(45 90% 70%)',
  border: 'hsl(215 20% 32%)',
  input: 'hsl(215 30% 18%)',
  ring: 'hsl(195 75% 75%)',
  radius: `${radii.surface}px`,
}

export const studio: SemanticTokens = {
  highlight: 'hsl(24 100% 63%)',
  highlightForeground: 'hsl(36 45% 92%)',
  background: 'hsl(28 22% 9%)',
  backgroundHex: '#1f1a16',
  foreground: 'hsl(38 54% 84%)',
  card: 'hsl(30 24% 13%)',
  cardForeground: 'hsl(38 54% 84%)',
  popover: 'hsl(30 24% 13%)',
  popoverForeground: 'hsl(38 54% 84%)',
  primary: 'hsl(24 100% 63%)',
  primaryForeground: 'hsl(28 22% 9%)',
  secondary: 'hsl(39 28% 22%)',
  secondaryForeground: 'hsl(38 54% 84%)',
  muted: 'hsl(31 20% 20%)',
  mutedForeground: 'hsl(39 24% 66%)',
  accent: 'hsl(343 54% 38%)',
  accentForeground: 'hsl(38 54% 84%)',
  destructive: 'hsl(0 70% 44%)',
  destructiveForeground: 'hsl(0 0% 100%)',
  success: 'hsl(142 60% 55%)',
  successForeground: 'hsl(142 62% 70%)',
  warning: 'hsl(45 88% 58%)',
  warningForeground: 'hsl(45 85% 72%)',
  border: 'hsl(39 26% 34%)',
  input: 'hsl(31 20% 20%)',
  ring: 'hsl(24 100% 63%)',
  radius: `${radii.surface}px`,
}
