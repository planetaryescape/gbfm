import { Redacted, Schema } from 'effect'

export const FormUrl = Schema.String.check(
  Schema.makeFilter((value) => {
    const url = URL.parse(value, 'https://gbfm.local')

    return url !== null && !url.searchParams.has('token')
  }),
)

export const FormToken = Schema.optional(Schema.Redacted(Schema.String))

export const safeFormLocation = (location: string) => {
  const url = new URL(location, 'https://gbfm.local')
  const token = url.searchParams.get('token')
  url.searchParams.delete('token')

  return {
    url: url.href,
    token: token === null ? undefined : Redacted.make(token),
  }
}
