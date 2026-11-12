import { hostname } from 'node:os'

import * as Sentry from '@sentry/core'
import { Console, Effect, Layer, Logger, References, Schema, type LogLevel } from 'effect'

import { ConfigService } from './config.service'
import { formatLogMessage, redactLogValue } from './log-redaction'

const ConsoleLevel = Schema.Literals(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])

const consoleLevels = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: Infinity,
}

const consoleLabels = { 20: 'DEBUG', 30: 'INFO', 40: 'WARN', 50: 'ERROR' }

function outputLevel(level: LogLevel.LogLevel): 20 | 30 | 40 | 50 {
  switch (level) {
    case 'Trace':
    case 'Debug':
      return 20
    case 'Warn':
      return 40
    case 'Error':
    case 'Fatal':
      return 50
    default:
      return 30
  }
}

const makeAppLogger = (config: ConfigService['app']) => {
  const production = config.nodeEnv === 'production'

  const threshold =
    consoleLevels[
      Schema.decodeUnknownSync(ConsoleLevel)(config.logLevel || (production ? 'warn' : 'info'))
    ]

  const host = hostname()
  const pid = process.pid

  return Logger.make(({ logLevel, message, cause, fiber, date }) => {
    const msg = formatLogMessage(message)

    const payload = {
      annotations: redactLogValue(fiber.getRef(References.CurrentLogAnnotations)),
      cause: redactLogValue(cause),
      fiberId: fiber.id,
      date: redactLogValue(date),
      logLevel,
    }

    const level = outputLevel(logLevel)

    if (level >= threshold) {
      const output = { level, time: Date.now(), pid, hostname: host, ...payload, msg }
      const label = consoleLabels[level]
      fiber
        .getRef(Console.Console)
        .log(
          production
            ? JSON.stringify(output)
            : `[${date.toISOString()}] ${label} (${pid}): ${msg}\n${JSON.stringify(payload, null, 2)}`,
        )
    }

    if (!Sentry.getClient()) return

    switch (logLevel) {
      case 'Warn':
        Sentry.logger.warn(msg, payload)
        break
      case 'Error':
        Sentry.logger.error(msg, payload)
        break
      case 'Fatal':
        Sentry.logger.fatal(msg, payload)
        break
    }
  })
}

export const AppLoggerLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ConfigService

    return Logger.layer([makeAppLogger(config.app)])
  }),
)
