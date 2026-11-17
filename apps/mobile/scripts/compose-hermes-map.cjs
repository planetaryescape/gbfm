const { execFileSync } = require('node:child_process')
const { dirname, join } = require('node:path')

const args = process.argv.slice(2)
const packager = args[0]
const output = args[args.indexOf('-o') + 1]
if (!packager || args.indexOf('-o') < 0 || !output)
  throw new Error('Hermes composition requires packager, compiler and output maps.')
const reactNative = dirname(require.resolve('react-native/package.json'))
const sentry = dirname(require.resolve('@sentry/react-native/package.json'))
execFileSync(process.execPath, [join(reactNative, 'scripts/compose-source-maps.js'), ...args], {
  stdio: 'inherit',
})
execFileSync(process.execPath, [
  join(sentry, 'scripts/copy-debugid.js'), packager, output,
], { stdio: 'inherit' })
