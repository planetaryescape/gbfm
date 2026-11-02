import { Redacted } from 'effect'

export const showSecret = (host: HTMLElement, secret: Redacted.Redacted) => {
  const label = document.createElement('label')
  label.textContent = 'New API key secret'
  const input = document.createElement('input')
  input.readOnly = true
  input.autocomplete = 'off'
  input.spellcheck = false
  input.value = Redacted.value(secret)
  label.append(input)
  const warning = document.createElement('p')
  warning.textContent =
    'Copy this now. It is shown only once and disappears when you leave this page.'
  const copy = document.createElement('button')
  copy.type = 'button'
  copy.className = 'btn btn-secondary'
  copy.dataset.keyCopy = ''
  copy.textContent = 'Copy key'
  const dismiss = document.createElement('button')
  dismiss.type = 'button'
  dismiss.className = 'btn btn-quiet'
  dismiss.dataset.keyDismiss = ''
  dismiss.textContent = 'I saved my key'
  host.replaceChildren(warning, label, copy, dismiss)
  input.focus()
  input.select()
}
