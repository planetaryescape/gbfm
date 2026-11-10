import { brandMark } from './brand'
import { clientLogoScript } from './client-logo'

const icon = (paths: string) =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`

export const icons = {
  eye: icon(
    '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  ),
  refresh: icon('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'),
  lock: icon(
    '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  ),
  monitor: icon('<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>'),
  globe: icon(
    '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
  ),
  user: icon('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  link: icon(
    '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  ),
  alert: icon('<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>'),
} as const

export const connectionPair = (appInitial: string, escapedLogoUrl?: string) =>
  `<div class="pair" aria-hidden="true"><span class="tile">${brandMark}</span><span class="pair-link">${icons.link}</span><span class="tile app${escapedLogoUrl ? ' app-logo' : ''}"><span data-client-initial>${appInitial}</span>${escapedLogoUrl ? `<img data-client-logo src="${escapedLogoUrl}" alt="" width="32" height="32" referrerpolicy="no-referrer" decoding="async" hidden>` : ''}</span></div>${escapedLogoUrl ? `<script>${clientLogoScript}</script>` : ''}`
