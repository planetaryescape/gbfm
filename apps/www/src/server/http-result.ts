import { Data } from 'effect'

export type Responded = Data.TaggedEnum<{
  Responded: { readonly response: Response }
}>

const result = Data.taggedEnum<Responded>()

export const Responded = (response: Response): Responded => result.Responded({ response })
