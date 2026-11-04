/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly FOLDKIT_BUILD_ID: string
  readonly VITE_VPS_BASE_URL: string
  readonly VITE_SPOTIFY_CLIENT_ID: string
  readonly VITE_PUBLIC_SENTRY_DSN?: string
  readonly VITE_SENTRY_ENABLED?: string
  readonly VITE_SENTRY_ENVIRONMENT?: string
  readonly VITE_SENTRY_RELEASE?: string
  // add more env variables as needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
