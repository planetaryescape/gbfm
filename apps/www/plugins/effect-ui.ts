import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { Predicate, Schema } from 'effect'
import type { Connect, Plugin, ViteDevServer } from 'vite'

import {
  allowedMethods,
  classifyRequest,
  refusedMethods,
  resolveRequestUrl,
} from '../src/server/effect-ui/request-policy.ts'
import type { DocumentAssets, ServerEntry } from '../src/server/effect-ui/types.ts'
import { toWebRequest, writeWebResponse } from './effect-ui-node.ts'

interface EffectUiOptions {
  readonly serverEntry: string
  readonly clientEntry: string
  readonly clientOutDir?: string
  readonly serverOutDir?: string
  readonly origin?: string
}

const clientId = 'virtual:gbfm-effect-ui/client'

const fetchId = 'virtual:gbfm-effect-ui/fetch'

const hostEntry = '/src/server/effect-ui/host.ts'

const Manifest = Schema.Record(
  Schema.String,
  Schema.Struct({
    file: Schema.String,
    isEntry: Schema.optional(Schema.Boolean),
    imports: Schema.optional(Schema.Array(Schema.String)),
    css: Schema.optional(Schema.Array(Schema.String)),
  }),
)

const readAssets = async (
  manifestPath: string,
  base: string,
  splitCss: boolean,
): Promise<DocumentAssets> => {
  const manifest = Schema.decodeUnknownSync(Manifest)(
    JSON.parse(await readFile(manifestPath, 'utf8')),
  )

  const entries = Object.values(manifest).filter((chunk) => chunk.isEntry)
  const entry = entries[0]

  if (entries.length !== 1 || !entry) throw new Error('Effect UI needs exactly one browser entry')
  const visited = new Set<string>()
  const styles = new Set<string>()
  const preloads = new Set<string>()

  const visit = (chunk: (typeof manifest)[string]) => {
    if (visited.has(chunk.file)) return
    visited.add(chunk.file)

    for (const css of chunk.css ?? []) styles.add(css)

    for (const key of chunk.imports ?? []) {
      const dependency = manifest[key]

      if (!dependency) throw new Error(`Missing browser manifest import: ${key}`)
      preloads.add(dependency.file)
      visit(dependency)
    }
  }

  visit(entry)

  if (!splitCss)
    for (const chunk of Object.values(manifest))
      if (chunk.file.endsWith('.css')) styles.add(chunk.file)

  const assetUrl = (file: string) =>
    `${base}${encodeURI(file).replace(/[?#]/g, encodeURIComponent)}`

  return {
    entryScript: assetUrl(entry.file),
    stylesheets: [...styles].map(assetUrl),
    modulePreloads: [...preloads].map(assetUrl),
  }
}

const isServerEntry = (value: unknown): value is ServerEntry =>
  Predicate.isObject(value) && 'renderPage' in value && Predicate.isFunction(value.renderPage)

const isHost = (
  value: unknown,
): value is {
  readonly handleRequest: (
    request: Request,
    entry: ServerEntry,
    assets: DocumentAssets,
  ) => Promise<Response>
} =>
  Predicate.isObject(value) && 'handleRequest' in value && Predicate.isFunction(value.handleRequest)

const devOrigin = (server: ViteDevServer, options: EffectUiOptions): string => {
  if (options.origin) return options.origin

  if (server.config.server.origin) return server.config.server.origin
  const local = server.resolvedUrls?.local[0]

  if (local) return new URL(local).origin
  const scheme = server.config.server.https ? 'https' : 'http'

  return `${scheme}://localhost:${server.config.server.port ?? 5173}`
}

export const effectUi = (options: EffectUiOptions): Plugin => {
  let assets: DocumentAssets | undefined

  return {
    name: 'gbfm:effect-ui',
    sharedDuringBuild: true,
    config() {
      return {
        appType: 'custom',
        environments: {
          client: {
            build: {
              outDir: options.clientOutDir ?? 'dist/client',
              manifest: true,
              rolldownOptions: { input: { app: clientId } },
            },
          },
          ssr: {
            build: {
              ssr: true,
              outDir: options.serverOutDir ?? 'dist/server',
              rolldownOptions: {
                input: { fetch: fetchId },
                output: { entryFileNames: '[name].js' },
              },
            },
          },
        },
        builder: {
          async buildApp(builder) {
            const client = builder.environments.client
            const server = builder.environments.ssr

            if (!client || !server) throw new Error('Effect UI needs client and ssr environments')
            assets = undefined
            await builder.build(client)
            assets = await readAssets(
              resolve(client.config.root, client.config.build.outDir, '.vite/manifest.json'),
              client.config.base,
              client.config.build.cssCodeSplit,
            )

            if (client.config.build.modulePreload === false)
              assets = { ...assets, modulePreloads: [] }
            await builder.build(server)
          },
        },
      }
    },
    configResolved(config) {
      if (!config.base.startsWith('/') && !/^https?:\/\//.test(config.base))
        throw new Error('Effect UI needs a root-relative or absolute base')

      if (config.experimental.renderBuiltUrl)
        throw new Error('Effect UI does not support custom renderBuiltUrl')
    },
    resolveId(id) {
      if (id === clientId || id === fetchId) return `\0${id}`

      return undefined
    },
    load(id) {
      if (id === `\0${clientId}`) {
        const preload = this.environment.config.build.modulePreload

        const polyfill =
          preload !== false && preload.polyfill ? "import 'vite/modulepreload-polyfill'\n" : ''

        return `${polyfill}import ${JSON.stringify(options.clientEntry)}`
      }

      if (id !== `\0${fetchId}`) return undefined

      if (!assets) throw new Error('Build the browser environment before the Effect UI server')

      return `
import { handleRequest, renderDocument } from ${JSON.stringify(hostEntry)}
import * as entry from ${JSON.stringify(options.serverEntry)}
export * from ${JSON.stringify(options.serverEntry)}
export { renderDocument }
const assets = ${JSON.stringify(assets)}
export default { fetch: request => handleRequest(request, entry, assets) }
`
    },
    configureServer(server) {
      const render: Connect.NextHandleFunction = async (incoming, outgoing, next) => {
        const target = incoming.originalUrl ?? incoming.url ?? '/'
        const url = resolveRequestUrl(target, devOrigin(server, options))

        if (!url) {
          outgoing.statusCode = 400
          outgoing.end()

          return
        }

        if (refusedMethods.has(incoming.method ?? 'GET')) {
          outgoing.statusCode = 405
          outgoing.setHeader('allow', allowedMethods)
          outgoing.end()

          return
        }

        const abort = new AbortController()

        const cancel = () => {
          if (!outgoing.writableFinished) abort.abort()
        }

        incoming.once('aborted', cancel)
        outgoing.once('close', cancel)

        try {
          const [entry, host] = await Promise.all([
            server.ssrLoadModule(options.serverEntry),
            server.ssrLoadModule(hostEntry),
          ])

          if (!isServerEntry(entry) || !isHost(host))
            throw new Error('Invalid Effect UI server entry or host')

          const response = await host.handleRequest(
            toWebRequest(url, incoming, abort.signal),
            entry,
            {
              entryScript: options.clientEntry,
              stylesheets: ['/src/styles/main.css'],
              modulePreloads: [],
            },
          )

          if (
            response.headers.get('content-type')?.includes('text/html') &&
            incoming.method !== 'HEAD'
          ) {
            const html = await server.transformIndexHtml(
              url.pathname,
              await response.text(),
              target,
            )

            const headers = new Headers(response.headers)
            headers.delete('content-length')
            await writeWebResponse(
              new Response(html, {
                status: response.status,
                statusText: response.statusText,
                headers,
              }),
              outgoing,
            )
          } else await writeWebResponse(response, outgoing)
        } catch (cause) {
          if (cause instanceof Error) server.ssrFixStacktrace(cause)
          next(cause)
        } finally {
          incoming.off('aborted', cancel)
          outgoing.off('close', cancel)
        }
      }

      server.middlewares.use((incoming, outgoing, next) => {
        const target = incoming.originalUrl ?? incoming.url ?? '/'
        const url = resolveRequestUrl(target, devOrigin(server, options))

        if (!url) {
          outgoing.statusCode = 400
          outgoing.end()

          return
        }

        incoming.url = `${url.pathname}${url.search}`

        const proxied = Object.keys(server.config.server.proxy ?? {}).some((key) =>
          key.startsWith('^')
            ? new RegExp(key).test(incoming.url ?? '')
            : url.pathname.startsWith(key),
        )

        const viteResource =
          url.pathname.startsWith('/@') ||
          url.pathname.startsWith('/src/') ||
          url.pathname.startsWith('/node_modules/') ||
          classifyRequest(new Request(url)) === 'PathAsset'

        if (
          refusedMethods.has(incoming.method ?? 'GET') ||
          (incoming.method === 'OPTIONS' && !proxied && !viteResource)
        ) {
          render(incoming, outgoing, next)

          return
        }

        next()
      })

      return () => server.middlewares.use(render)
    },
  }
}
