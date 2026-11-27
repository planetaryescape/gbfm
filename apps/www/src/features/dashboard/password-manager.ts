import { type Component, Mount } from '@effect/ui'
import { Effect, Schema, Stream } from 'effect'

import { focusedHostLeaf, focusedOutsideHost } from './password-manager-hosts'

const allowedHosts = 'com-1password-button,com-1password-menu'

interface RelocatedHost {
  readonly node: HTMLElement
  readonly parent: Node
  readonly next: Node | null
  readonly ariaHidden: string | null
  readonly inert: boolean
  readonly container: HTMLDialogElement
}

export const AllowPasswordManager = Mount.makeStream(
  'AllowPasswordManager',
  {
    args: { open: Schema.Boolean },
  },
  (element: HTMLElement, initial, changes) =>
    Stream.callback<Component.Noop>(() =>
      Effect.gen(function* () {
        const document = element.ownerDocument
        const relocated = new Map<HTMLElement, RelocatedHost>()
        const visibility = new WeakMap<HTMLElement, string | null>()
        const isolated = new Set<HTMLElement>()
        let open = initial.open

        const restore = () => {
          for (const { node, parent, next, ariaHidden, inert, container } of relocated.values()) {
            if (node.parentNode === container && parent.isConnected) {
              const focused = focusedHostLeaf(node)
              parent.insertBefore(node, next?.parentNode === parent ? next : null)
              focused?.focus({ preventScroll: true })
            }

            if (ariaHidden === null) node.removeAttribute('aria-hidden')
            else node.setAttribute('aria-hidden', ariaHidden)
            node.inert = inert
          }

          relocated.clear()

          for (const node of isolated) node.inert = false
          isolated.clear()
        }

        const isolate = (portal: HTMLDialogElement) => {
          const kept = new Set<Node>()
          let ancestor: Node | null = portal

          while (ancestor && ancestor !== document.body) {
            kept.add(ancestor)
            ancestor = ancestor.parentNode
          }

          const walk = (parent: Element) => {
            for (const child of Array.from(parent.children)) {
              if (child === portal) continue

              if (kept.has(child)) walk(child)
              else if (child instanceof HTMLElement && !child.inert) {
                isolated.add(child)
                child.inert = true
              }
            }
          }

          walk(document.body)
        }

        const refresh = () => {
          if (!open) {
            restore()
            document.querySelectorAll(allowedHosts).forEach((node) => {
              if (node instanceof HTMLElement)
                visibility.set(node, node.getAttribute('aria-hidden'))
            })

            return
          }

          if (!element.isConnected) return

          const form = element.querySelector('[data-key-password-form]')
          const portal = form?.closest('dialog[popover="manual"]')

          if (
            !(portal instanceof HTMLDialogElement) ||
            portal.ownerDocument !== document ||
            !element.contains(portal)
          )
            return
          const candidates = Array.from(document.querySelectorAll(allowedHosts))
          const external = focusedOutsideHost(document)

          if (external) candidates.push(external)
          candidates.forEach((node) => {
            if (
              !(node instanceof HTMLElement) ||
              node.ownerDocument !== document ||
              portal.contains(node) ||
              !node.parentNode
            )
              return

            if (node.parentElement?.closest(allowedHosts)) return

            const ariaHidden = visibility.has(node)
              ? (visibility.get(node) ?? null)
              : node.getAttribute('aria-hidden')

            const inert = isolated.has(node) ? false : node.inert
            const focused = focusedHostLeaf(node)
            isolated.delete(node)

            relocated.set(node, {
              node,
              parent: node.parentNode,
              next: node.nextSibling,
              ariaHidden,
              inert,
              container: portal,
            })
            // Only these extension hosts join this password dialog's top layer; its native page blocker remains intact.
            portal.append(node)
            node.inert = inert

            if (ariaHidden === null) node.removeAttribute('aria-hidden')
            else node.setAttribute('aria-hidden', ariaHidden)
            focused?.focus({ preventScroll: true })
          })
          isolate(portal)
        }

        const observer = new MutationObserver(refresh)

        const containExtensionTab = (event: KeyboardEvent) => {
          if (!open || event.key !== 'Tab' || !(event.target instanceof Element)) return

          const host = event
            .composedPath()
            .find((node) => node instanceof HTMLElement && relocated.has(node))

          const portal = element.querySelector('dialog[popover="manual"]')

          if (!(host instanceof HTMLElement) || !portal?.contains(host)) return
          const selector = event.shiftKey ? 'button[type="button"]' : 'input[type="password"]'
          const target = portal.querySelector(`[data-key-password-form] ${selector}`)

          if (!(target instanceof HTMLElement)) return
          event.preventDefault()
          target.focus()
        }

        yield* Effect.acquireRelease(
          Effect.sync(() => {
            refresh()
            observer.observe(document.documentElement, { childList: true, subtree: true })
            document.addEventListener('focusin', refresh, true)
            document.addEventListener('keydown', containExtensionTab, true)
          }),
          () =>
            Effect.sync(() => {
              open = false
              observer.disconnect()
              document.removeEventListener('focusin', refresh, true)
              document.removeEventListener('keydown', containExtensionTab, true)
              restore()
            }),
        )
        yield* changes.pipe(
          Stream.runForEach((next) =>
            Effect.sync(() => {
              open = next.open
              refresh()
            }),
          ),
          Effect.forkScoped,
        )
        yield* Effect.never
      }),
    ),
)
