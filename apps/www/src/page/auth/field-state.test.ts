import { expect, it } from 'vitest'

import { fieldStates, formFields } from '../../domain/auth/field-state'

const calm = { invalid: false, focus: false }

it('lists the fields each auth form shows', () => {
  expect(formFields('sign-up')).toEqual(['name', 'email', 'password'])
  expect(formFields('sign-in')).toEqual(['email', 'password'])
  expect(formFields('forgot-password')).toEqual(['email'])
  expect(formFields('reset-password')).toEqual(['password'])
})

it('leaves every field alone when there is no error', () => {
  expect(fieldStates('sign-in', null)).toEqual({ name: calm, email: calm, password: calm })
})

it('marks the fields an error is about and focuses the first one', () => {
  expect(fieldStates('sign-in', 'credentials')).toEqual({
    name: calm,
    email: { invalid: true, focus: true },
    password: { invalid: true, focus: false },
  })
  expect(fieldStates('sign-up', 'password')).toEqual({
    name: calm,
    email: calm,
    password: { invalid: true, focus: true },
  })
})

it('focuses the first field for errors that are not about a field', () => {
  expect(fieldStates('sign-up', 'rate')).toEqual({
    name: { invalid: false, focus: true },
    email: calm,
    password: calm,
  })
})
