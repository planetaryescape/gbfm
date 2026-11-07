declare module 'cloudflare:workers' {
  export const env: import('./telemetry/server').BrowserTelemetryEnv & {
    readonly TURNSTILE_SITE_KEY?: string
    readonly EDITORIAL_OAUTH_ISSUER?: string
    readonly API: { fetch(request: Request): Promise<Response> }
    readonly SOCIAL_IMAGES: { fetch(request: Request): Promise<Response> }
  }
}
