import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { nativeSentryConfig } from '../plugins/with-sentry-native-privacy.js'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const requireExpo = createRequire(import.meta.resolve('expo/package.json'))
const requireCli = createRequire(requireExpo.resolve('@expo/cli/package.json'))
const { loadProjectEnv } = requireCli('@expo/env')
loadProjectEnv(projectRoot, {
  mode: process.env.CONFIGURATION?.toLowerCase().includes('debug') ? 'development' : 'production',
  silent: true,
})
const plist = process.argv[2]
if (!plist) throw new Error('A compiled application Info.plist is required.')
for (const [key, value] of Object.entries(nativeSentryConfig(process.env))) {
  const encoded = value === '' ? '""' : String(value)
  execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${encoded}`, plist])
}
