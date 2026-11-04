const tokensKey = 'spotify-effect:tokens'

export const spotifyTokenStorage = (secure: {
  readonly read: () => Promise<string | null>
  readonly write: (value: string) => Promise<void>
  readonly remove: () => Promise<void>
}) => {
  const values = new Map<string, string>()
  let version = 0
  let isCurrent = () => true
  let pending = Promise.resolve()

  const persist = (work: () => Promise<void>) => {
    pending = pending.then(work).catch(() => {})
  }

  const storage: Storage = {
    get length() {
      return values.size
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    clear: () => {
      version += 1
      values.clear()
      persist(secure.remove)
    },
    removeItem: (key) => {
      values.delete(key)

      if (key === tokensKey) {
        version += 1
        persist(secure.remove)
      }
    },
    setItem: (key, value) => {
      if (key === tokensKey && !isCurrent()) return
      values.set(key, value)

      if (key === tokensKey) {
        version += 1
        persist(() => secure.write(value))
      }
    },
  }

  return {
    storage,
    guardWrites: (guard: () => boolean) => {
      isCurrent = guard
    },
    invalidate: () => storage.removeItem(tokensKey),
    hydrate: async () => {
      const started = version
      const value = await secure.read().catch(() => null)

      if (version === started && value) values.set(tokensKey, value)
    },
    settled: () => pending,
  }
}
