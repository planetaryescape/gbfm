import type { ConfigPlugin } from 'expo/config-plugins'

export const nativeSentryConfig: (env: Readonly<Record<string, string | undefined>>) => {
  readonly GBFMSentryEnabled: boolean
  readonly GBFMSentryDsn: string
  readonly GBFMSentryRelease: string
  readonly GBFMSentryEnvironment: string
}

declare const plugin: ConfigPlugin
export default plugin
