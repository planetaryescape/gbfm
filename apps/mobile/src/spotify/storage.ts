import * as SecureStore from 'expo-secure-store'

import { spotifyTokenStorage } from './tokenStorage'

const SECURE_STORE_KEY = 'gbfm_spotify_tokens'

const makeMemoryStorage = (): Storage => {
  const store = new Map<string, string>()

  return {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => Array.from(store.keys())[index] ?? null,
    removeItem: (key) => {
      store.delete(key)
    },
    setItem: (key, value) => {
      store.set(key, value)
    },
  }
}

const memorySessionStorage = makeMemoryStorage()

const tokens = spotifyTokenStorage({
  read: () => SecureStore.getItemAsync(SECURE_STORE_KEY),
  write: (value) => SecureStore.setItemAsync(SECURE_STORE_KEY, value),
  remove: () => SecureStore.deleteItemAsync(SECURE_STORE_KEY),
})

export const hydrateSpotifyTokensFromSecureStore = tokens.hydrate

export const guardSpotifyTokenWrites = tokens.guardWrites

export const invalidateSpotifyTokens = tokens.invalidate

export const spotifyLocalStorage = tokens.storage

export const spotifySessionStorage: Storage = memorySessionStorage

export const spotifyHistoryStub: History = {
  length: 0,
  scrollRestoration: 'auto',
  state: null,
  back: () => {},
  forward: () => {},
  go: () => {},
  pushState: () => {},
  replaceState: () => {},
}
