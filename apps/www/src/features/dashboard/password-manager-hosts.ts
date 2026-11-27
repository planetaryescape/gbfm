export const focusedOutsideHost = (document: Document): HTMLElement | null => {
  const host = document.activeElement

  if (
    !(host instanceof HTMLElement) ||
    host.ownerDocument !== document ||
    host.parentElement !== document.documentElement ||
    host === document.head ||
    host === document.body ||
    host.shadowRoot?.mode !== 'open' ||
    !(host.shadowRoot.activeElement instanceof HTMLElement)
  )
    return null

  return host
}

export const focusedHostLeaf = (host: HTMLElement): HTMLElement | null => {
  if (host.ownerDocument.activeElement !== host) return null
  const first = host.shadowRoot?.activeElement

  if (!(first instanceof HTMLElement)) return null

  let active = first

  while (active.shadowRoot?.activeElement instanceof HTMLElement)
    active = active.shadowRoot.activeElement

  return active
}
