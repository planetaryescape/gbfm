import { brandDark, controlMetrics, radii } from '@gbfm/theme'

export const connectionStyles = `
@font-face {
  font-family: 'JetBrains Mono';
  src: url('/fonts/JetBrainsMono-SemiBold-latin.woff2') format('woff2');
  font-weight: 600;
  font-display: swap;
}
:root {
  color-scheme: dark;
  --background: ${brandDark.darkerBg};
  --foreground: ${brandDark['pastel-green-1']};
  --muted: ${brandDark.defaultText};
  --accent: ${brandDark.accentSurface};
  --border: ${brandDark['pastel-green-2']};
  --error: ${brandDark.error};
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--background); color: var(--foreground); font: 600 14px/1.6 'JetBrains Mono', monospace; }
main { width: min(100% - 32px, 520px); margin: clamp(24px, 8vh, 80px) auto; padding-bottom: 32px; }
header { margin-bottom: 32px; }
.brand { display: inline-flex; color: var(--foreground); }
.wordmark { height: 22px; width: auto; }
.pair { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; color: var(--muted); }
.tile { display: grid; place-items: center; width: 56px; height: 56px; border: 1px solid var(--border); border-radius: ${radii.surface}px; color: var(--foreground); }
.tile svg { width: 44px; height: auto; }
.tile.app { font-size: 24px; background: var(--accent); border-color: var(--accent); color: var(--background); }
.tile.app-logo { background: var(--background); border-color: var(--border); color: var(--foreground); }
.tile.app-logo img { width: 32px; height: 32px; object-fit: contain; }
.icon { width: 18px; height: 18px; flex: none; }
.row, .identity, li { display: flex; align-items: flex-start; gap: 10px; }
.row .icon, .identity .icon, li .icon { margin-top: 3px; }
.status { color: var(--error); }
.status .icon { width: 40px; height: 40px; }
.eyebrow { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
h1 { font-size: clamp(22px, 5vw, 28px); line-height: 1.3; overflow-wrap: anywhere; }
h2 { font-size: 15px; margin-top: 0; }
p { margin: 12px 0; }
.muted, small { color: var(--muted); }
a { color: var(--accent); text-underline-offset: 4px; }
section, .account { border: 1px solid var(--border); border-radius: ${radii.surface}px; padding: 20px; margin: 24px 0; }
ul { list-style: none; padding: 0; }
li { margin: 8px 0; }
.destination, .identity { overflow-wrap: anywhere; }
.actions { display: flex; flex-wrap: wrap; gap: 12px; margin: 24px 0; }
button, .button { display: inline-flex; align-items: center; justify-content: center; gap: 1ch; min-height: ${controlMetrics.height}px; padding: 10px ${controlMetrics.paddingInline}px; border: 1px solid var(--border); border-radius: ${radii.control}px; background: transparent; color: var(--foreground); font: inherit; text-decoration: none; cursor: pointer; }
button.primary { background: var(--accent); color: var(--background); border-color: var(--accent); }
button.quiet { padding: 0; border: 0; color: var(--accent); text-decoration: underline; text-underline-offset: 4px; }
label { display: block; margin: 20px 0 8px; }
input:not([type=hidden]) { width: 100%; min-height: 48px; padding: 12px; border: 1px solid var(--border); border-radius: ${radii.control}px; background: var(--background); color: var(--foreground); font: inherit; }
a:focus-visible, button:focus-visible, input:focus-visible { outline: 3px solid var(--accent); outline-offset: 4px; }
.error { color: var(--error); }
.links { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
.account { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; padding: 14px 20px; }
.account p { margin: 0; }
small { display: block; font-size: 12px; }
`
