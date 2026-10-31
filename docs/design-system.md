# Design System

GBFM is a compact, music-first archive and studio tool, not a generic SaaS kit. Keep the interface restrained so square cover art, titles, and music metadata carry the visual richness.

## Ownership

- `packages/theme/src/tokens/brand.ts` owns the brand palette; `packages/theme/styles/theme.css` supplies shared semantic CSS variables through `@gbfm/theme/styles.css`.
- `apps/www/src/styles/main.css` maps those variables into Tailwind CSS v4 and owns web utilities, typography, and motion styles.
- `apps/www/src/view/` owns shared Foldkit presentation, including artwork, icons, links, navigation, and rich content.
- `@foldkit/ui` supplies accessible dialog and popover primitives. State, messages, commands, and workflow behavior belong to the feature or page submodel, not a shared UI package.
- React is still used by Expo mobile, React Email templates, and social-image rendering. It is not the WWW view layer.

See [FOLDKIT.md](../FOLDKIT.md) for runtime, navigation, and folder conventions.

## Visual language

- Prefer rectangular surfaces and restrained rounding. Geometry lives in `packages/theme/src/tokens/geometry.ts`, exported as numbers for native and generated CSS variables for web. Do not invent radii in individual components.
- Use high-contrast dark surfaces with cyan/green accents from the shared theme. Do not copy old palette values into components or introduce new theme selectors without a product requirement.
- Prefer semantic classes such as `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `text-highlight`, and `ring-ring`. Existing `gb-*` classes map to the same shared brand variables in WWW.
- Keep secondary metadata readable. Use muted text, not near-invisible contrast.
- Use square, cover-art-led imagery and the shared artwork view for responsive delivery and fallbacks.
- Keep layouts dense where users work with metadata. Use whitespace to separate functional groups rather than adding decorative space.

## Typography and layout

- WWW uses self-hosted JetBrains Mono through `apps/www/src/styles/fonts.css`.
- Headings use direct weight and size. Eyebrows may use uppercase text and wide tracking.
- Metadata and help text use compact sizes; long media titles should truncate or scroll where space is constrained.
- Use responsive grids for artwork, compact label/control groups, and wrapping inline actions.
- Preserve bottom content clearance for the fixed player and mobile-first navigation.
- Keep prose headings, bold text, links, and blockquotes readable against their surface.

The normal-style weights have Latin WOFF2 subsets; the original faces remain as non-Latin fallbacks. Regenerate the subsets from the repository root after replacing the originals:

```sh
for weight in SemiBold Bold ExtraBold; do
  uvx --from 'fonttools[woff]' pyftsubset "apps/www/public/fonts/JetBrainsMono-$weight.woff2" \
    --unicodes='U+0000-00FF,U+2000-206F,U+20AC,U+2122' --flavor=woff2 --layout-features='*' \
    --output-file="apps/www/public/fonts/JetBrainsMono-$weight-latin.woff2"
done
```

## Interaction and states

### Geometry and controls

| Role | Radius |
| --- | --- |
| Album artwork | 0px |
| Buttons, inputs, cards | 4px |
| Sheets, popovers, floating navigation containers | 12px |
| Avatars, progress thumbs, primary circular playback control | Circular |

OS-owned iOS tab bars, navigation headers, alerts, and sheet chrome retain their system shapes. They are platform exceptions, not examples for app-owned controls. Small grips and progress tracks may use the control radius.

App buttons share a 44px minimum touch height, 14px semibold monospace label, 12px inline padding, 8px content gap, and 20px leading icon. Use the same roles on both platforms:

- Primary: filled accent, contrasting label, one next action per group.
- Secondary: surface fill and a subtle border.
- Quiet: transparent, no visible border until focused or pressed. Use for navigation and dismissal.
- Destructive: danger fill and contrasting label, reserved for confirmed destructive actions.
- Icon-only: the same 44px target and an explicit accessible label.

Use `Button` in native and `.btn` with its role modifier in web. Reader-specific wrappers may supply labels and handlers, but must not define another button appearance. Disabled and busy controls remain identifiable; web keeps a visible keyboard focus ring.

### Reader and playback layout

Tweet navigation belongs with the tweet, not in a third persistent bottom bar. Reading options expose chronological navigation, next unread, latest, random, and the month grid. Horizontal swipes provide another route between tweets; visible options and accessibility actions remain available. Swipes never replace ordinary scrolling, media controls, or OS edge navigation.

Tweet content follows a horizontal drag while reader options and playback stay anchored. Release below the acceptance threshold springs back; accepted gestures slide out and bring the next tweet in from the opposite side. Archive boundaries resist the drag instead of accepting it. Reduced motion keeps the same navigation rules without spatial movement.

The shared swipe policy accepts 25% of viewport width, clamped to 80–160px. A flick needs at least 32px of movement, 0.55px/ms of release velocity, and enough projected travel to cross that threshold. Web samples the last 100ms; native uses the recognizer's release velocity rather than coalesced event delivery timing. Holding loses momentum and reversing cancels a commit. A long press before horizontal movement is not a swipe. Native uses Gesture Handler and Reanimated to track touches and animate on the UI thread; web owns transient transforms in the touch adapter.

The compact player shows artwork, track identity, and play/pause only. Queue and skip controls live in the expanded player. Keep app navigation and playback visually distinct without adding more fixed layers.

- Motion confirms interactivity: small lifts, border emphasis, subtle image scaling, and short transitions. Respect reduced motion.
- Keep keyboard focus visible. Label controls, name icon-only actions, preserve native input types, and make disabled/loading states clear.
- Prefer native selects, sliders, and disclosures when they already meet the need. Use the Foldkit primitives for modal focus, dismissal, and scroll locking.
- Show loading progress or skeletons, useful empty-state instructions, and visible errors. Use badges and metadata for draft/published/review status rather than oversized alerts.
- Compose existing views before adding new styling patterns. Keep data fetching, persistence, playback, and route behavior in their owning submodels.
- Verify realistic music content, long titles, empty/loading/error states, keyboard interaction, and constrained widths through the running app and existing browser tests. There is no separate story gallery.
