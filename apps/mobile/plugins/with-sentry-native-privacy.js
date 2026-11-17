import fs from 'node:fs'
import path from 'node:path'

import { IOSConfig, withAppDelegate, withInfoPlist, withXcodeProject } from 'expo/config-plugins'

export const nativeSentryConfig = (env) => {
  let dsn = ''
  try {
    const value = new URL(env.EXPO_PUBLIC_SENTRY_DSN ?? '')
    if (
      value.protocol === 'https:' &&
      /^[a-f0-9]+$/i.test(value.username) &&
      !value.password &&
      /^\/[0-9]+$/.test(value.pathname) &&
      !value.search &&
      !value.hash
    )
      dsn = value.href
  } catch {
    dsn = ''
  }
  const release = env.EXPO_PUBLIC_SENTRY_RELEASE ?? ''
  const enabled =
    env.EXPO_PUBLIC_SENTRY_ENABLED === 'true' &&
    dsn !== '' &&
    /^gbfm-mobile@[a-f0-9]{40}$/.test(release)
  return {
    GBFMSentryEnabled: enabled,
    GBFMSentryDsn: enabled ? dsn : '',
    GBFMSentryRelease: enabled ? release : '',
    GBFMSentryEnvironment: env.EXPO_PUBLIC_SENTRY_ENVIRONMENT ?? '',
  }
}

export default (config) => {
  let next = withInfoPlist(config, (native) => {
    Object.assign(native.modResults, nativeSentryConfig(process.env))
    return native
  })
  next = withXcodeProject(next, (native) => {
    const projectName = IOSConfig.XcodeUtils.getProjectName(native.modRequest.projectRoot)
    for (const name of ['GBFMSentryPrivacy.swift', 'GBFMSentryBootstrap.swift']) {
      const relative = path.join(projectName, name)
      fs.copyFileSync(
        path.join(native.modRequest.projectRoot, 'native', name),
        path.join(native.modRequest.platformProjectRoot, relative),
      )
      if (!native.modResults.hasFile(relative))
        IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
          filepath: relative,
          groupName: projectName,
          project: native.modResults,
        })
    }
    return native
  })
  return withAppDelegate(next, (native) => {
    if (native.modResults.language !== 'swift')
      throw new Error('Native Sentry privacy requires a Swift AppDelegate.')
    if (native.modResults.contents.includes('GBFMSentryBootstrap.start()')) return native
    const original = native.modResults.contents
    native.modResults.contents = original.replace(
      /(func application\([^)]*\) -> Bool \{)\s*\n(\s*)/s,
      '$1\n$2GBFMSentryBootstrap.start()\n$2',
    )
    if (native.modResults.contents === original)
      throw new Error('Could not install the native Sentry privacy bootstrap.')
    return native
  })
}
