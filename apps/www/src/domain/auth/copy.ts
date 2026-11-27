import { Match } from 'effect'

type AuthCopy = {
  readonly title: string
  readonly subtitle: string
  readonly submit: string
}

export const authCopy = (action: string): AuthCopy =>
  Match.value(action).pipe(
    Match.when('sign-up', () => ({
      title: 'Create your account',
      subtitle: 'Sign up with your email and a password.',
      submit: 'Sign up',
    })),
    Match.when('sign-in', () => ({
      title: 'Welcome back',
      subtitle: 'Sign in to your Goosebumps account.',
      submit: 'Sign in',
    })),
    Match.when('forgot-password', () => ({
      title: 'Reset your password',
      subtitle: "Enter your email and we'll send you a reset link.",
      submit: 'Continue',
    })),
    Match.orElse(() => ({
      title: 'Reset your password',
      subtitle: 'Choose a new password for your account.',
      submit: 'Continue',
    })),
  )
