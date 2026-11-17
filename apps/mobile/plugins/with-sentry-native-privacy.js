import fs from 'node:fs'
import path from 'node:path'

import { telemetryConfig } from '@gbfm/observability/config'
import { IOSConfig, withAppDelegate, withInfoPlist, withXcodeProject } from 'expo/config-plugins'

export const nativeSentryConfig = (env) => {
  const settings = telemetryConfig({
    application: 'mobile',
    dsn: env.EXPO_PUBLIC_SENTRY_DSN,
    enabled: env.EXPO_PUBLIC_SENTRY_ENABLED,
    release: env.EXPO_PUBLIC_SENTRY_RELEASE,
    environment: env.EXPO_PUBLIC_SENTRY_ENVIRONMENT,
    development: false,
  })
  const environment = ['development', 'preview', 'production'].includes(
    env.EXPO_PUBLIC_SENTRY_ENVIRONMENT,
  )
    ? settings.environment
    : ''
  return {
    GBFMSentryEnabled: settings.enabled,
    GBFMSentryDsn: settings.enabled ? settings.dsn : '',
    GBFMSentryRelease: settings.enabled ? settings.release : '',
    GBFMSentryEnvironment: environment,
  }
}

export default (config) => {
  let next = withInfoPlist(config, (native) => {
    Object.assign(native.modResults, nativeSentryConfig(process.env))
    return native
  })
  next = withXcodeProject(next, (native) => {
    const bundle = native.modResults.pbxItemByComment(
      'Bundle React Native code and images',
      'PBXShellScriptBuildPhase',
    )
    if (!bundle) throw new Error('The React Native bundle build phase is required.')
    const compose = 'export COMPOSE_SOURCEMAP_PATH="$SRCROOT/../scripts/compose-hermes-map.cjs"'
    const bundleScript = JSON.parse(bundle.shellScript)
    if (!bundleScript.includes(compose))
      bundle.shellScript = JSON.stringify(`${compose}\n${bundleScript}`)
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
    const phaseName = 'Refresh native Sentry configuration'
    if (!native.modResults.pbxItemByComment(phaseName, 'PBXShellScriptBuildPhase')) {
      const phase = native.modResults.addBuildPhase(
        [],
        'PBXShellScriptBuildPhase',
        phaseName,
        native.modResults.getFirstTarget().uuid,
        {
          shellPath: '/bin/sh',
          shellScript: [
            'set -eu',
            'if [ -f "$SRCROOT/.xcode.env" ]; then . "$SRCROOT/.xcode.env"; fi',
            'if [ -f "$SRCROOT/.xcode.env.local" ]; then . "$SRCROOT/.xcode.env.local"; fi',
            '"${NODE_BINARY:-node}" "$SRCROOT/../scripts/write-native-sentry-config.js" "$TARGET_BUILD_DIR/$INFOPLIST_PATH"',
          ].join('\n'),
          inputPaths: [JSON.stringify('$(TARGET_BUILD_DIR)/$(INFOPLIST_PATH)')],
        },
      )
      phase.buildPhase.alwaysOutOfDate = 1
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
