import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'

export const gatedPostDatabase = (database: D1Database, phase: 'before' | 'after') => {
  const reached = Promise.withResolvers<void>()
  const released = Promise.withResolvers<void>()
  let paused = false

  const pause = async () => {
    if (paused) return
    paused = true
    reached.resolve()
    await released.promise
  }

  const execute = async <A>(writesPost: boolean, run: () => Promise<A>) => {
    if (writesPost && phase === 'before') await pause()
    const result = await run()

    if (writesPost && phase === 'after') await pause()

    return result
  }

  class Statement implements D1PreparedStatement {
    readonly writesPost: boolean
    constructor(
      readonly underlying: D1PreparedStatement,
      readonly query: string,
    ) {
      this.writesPost = /^update "posts" /i.test(query)
    }
    bind(...values: Parameters<D1PreparedStatement['bind']>): D1PreparedStatement {
      return new Statement(this.underlying.bind(...values), this.query)
    }
    first<T = unknown>(column?: string): Promise<T | null> {
      return execute(this.writesPost, () =>
        column === undefined ? this.underlying.first<T>() : this.underlying.first<T>(column),
      )
    }
    run<T = unknown>() {
      return execute(this.writesPost, () => this.underlying.run<T>())
    }
    all<T = unknown>() {
      return execute(this.writesPost, () => this.underlying.all<T>())
    }
    raw<T = Array<unknown>>(options: { columnNames: true }): Promise<[Array<string>, ...Array<T>]>
    raw<T = Array<unknown>>(options?: { columnNames?: false }): Promise<Array<T>>
    raw<T = Array<unknown>>(options?: {
      columnNames?: boolean
    }): Promise<Array<T> | [Array<string>, ...Array<T>]> {
      return execute<Array<T> | [Array<string>, ...Array<T>]>(this.writesPost, () =>
        options?.columnNames
          ? this.underlying.raw<T>({ columnNames: true })
          : this.underlying.raw<T>(),
      )
    }
  }

  const gated: D1Database = {
    prepare: (query) => new Statement(database.prepare(query), query),
    batch: <T>(statements: Array<D1PreparedStatement>) =>
      execute(
        statements.some((statement) => statement instanceof Statement && statement.writesPost),
        () =>
          database.batch<T>(
            statements.map((statement) =>
              statement instanceof Statement ? statement.underlying : statement,
            ),
          ),
      ),
    exec: (query) => database.exec(query),
    withSession: (constraint) => database.withSession(constraint),
    dump: () => database.dump(),
  }

  return { database: gated, reached: reached.promise, release: () => released.resolve() }
}
