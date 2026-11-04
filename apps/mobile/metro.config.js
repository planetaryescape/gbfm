const loadModule = module.require.bind(module)

const { getSentryExpoConfig } = loadModule('@sentry/react-native/metro')

const { withNativewind } = loadModule('nativewind/metro')

const config = getSentryExpoConfig(__dirname)

const configModule = module

configModule.exports = withNativewind(config, { globalClassNamePolyfill: false })
