import type { IssueKeyInput } from '@gbfm/api/personal-access-keys'
import { Data, type Redacted } from 'effect'

type Issuance =
  | { readonly _tag: 'Idle' }
  | { readonly _tag: 'Validating' }
  | { readonly _tag: 'AwaitingPassword'; readonly input: IssueKeyInput }
  | { readonly _tag: 'Issued'; readonly secret: Redacted.Redacted }

const Issuance = Data.taggedEnum<Issuance>()

export const createIssuanceState = () => {
  let phase: Issuance = Issuance.Idle()
  let live = false
  let verifying = false

  const secret = () => (Issuance.$is('Issued')(phase) ? phase.secret : null)
  const input = () => (Issuance.$is('AwaitingPassword')(phase) ? phase.input : null)
  const busy = () => Issuance.$is('Validating')(phase) || Issuance.$is('AwaitingPassword')(phase)

  const clear = () => {
    phase = Issuance.Idle()
  }

  return {
    live: () => live,
    verifying: () => verifying,
    secret,
    input,
    busy,
    clear,
    setLive: (value: boolean) => {
      live = value

      if (!live) clear()
    },
    submit: () => {
      if (!live || verifying || busy() || secret()) return false
      phase = Issuance.Validating()

      return true
    },
    requestPassword: (input: IssueKeyInput) => {
      phase = Issuance.AwaitingPassword({ input })
    },
    verify: () => {
      if (!live || secret() || !input() || verifying) return false
      verifying = true

      return true
    },
    verificationFailed: () => {
      verifying = false
    },
    issued: (value: Redacted.Redacted | null) => {
      verifying = false
      phase = value && live && input() ? Issuance.Issued({ secret: value }) : Issuance.Idle()
    },
  }
}
