import type { Html } from '@effect/ui/html'

export const HiddenField = <M>(h: Html.H<M>, name: string, value: string) =>
  h.input.attr('type', 'hidden').attr('name', name).attr('value', value)

export const TextField = <M>(
  h: Html.H<M>,
  options: {
    name: string
    label: string
    type?: string
    value?: string
    required?: boolean
    autocomplete?: string
    invalid?: boolean
    focus?: boolean
  },
) =>
  h.label.class('auth-field').children(
    h.span.class('auth-label').children(options.label),
    h.input
      .attr('name', options.name)
      .attr('type', options.type ?? 'text')
      .attr('value', options.value ?? '')
      .attr('autocomplete', options.autocomplete ?? options.name)
      .attr('required', (options.required ?? true) ? '' : undefined)
      .attr('autofocus', options.focus ? '' : undefined)
      .attr('aria-invalid', String(options.invalid ?? false))
      .attr('aria-describedby', options.invalid ? 'auth-error' : undefined),
  )

export const StatusMessage = <M>(h: Html.H<M>, text: string, error = false) =>
  h.p
    .class(`auth-status${error ? ' auth-error' : ''}`)
    .attr('role', error ? 'alert' : 'status')
    .children(text)
