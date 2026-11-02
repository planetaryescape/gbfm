import { withXcodeProject } from 'expo/config-plugins'

export default (config) =>
  withXcodeProject(config, (nativeConfig) => {
    const team = nativeConfig.ios?.appleTeamId

    if (!team) throw new Error('Configure ios.appleTeamId before building the iOS app.')
    const configurations = nativeConfig.modResults.pbxXCBuildConfigurationSection()

    for (const configuration of Object.values(configurations)) {
      if (configuration?.buildSettings) {
        configuration.buildSettings.DEVELOPMENT_TEAM = team
      }
    }

    return nativeConfig
  })
