import type { WorkerObservability } from '@alchemy.run/cloudflare'

const LOGS_DESTINATION = 'planetaryescape-logs'

const TRACES_DESTINATION = 'planetaryescape-traces'

export function workerObservability(isProduction: boolean): WorkerObservability {
  if (isProduction) {
    return {
      enabled: true,
      logs: {
        enabled: true,
        headSamplingRate: 1,
        invocationLogs: true,
        persist: true,
        destinations: [LOGS_DESTINATION],
      },
      traces: {
        enabled: true,
        headSamplingRate: 1,
        persist: true,
        destinations: [TRACES_DESTINATION],
      },
    }
  }

  return {
    enabled: true,
    logs: {
      enabled: true,
      headSamplingRate: 1,
      invocationLogs: true,
      persist: true,
    },
    traces: {
      enabled: true,
      headSamplingRate: 1,
      persist: true,
    },
  }
}

/** Upload authored-code maps as private Worker modules without publishing a sourceMappingURL. */
export const privateSourceMaps = {
  output: { sourcemap: 'hidden' },
} as const
