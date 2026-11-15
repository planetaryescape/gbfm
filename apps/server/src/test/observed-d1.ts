import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'

export const observedD1 = (database: D1Database) => {
  const queries: Array<string> = []
  const statements: Array<string> = []
  let active = 0
  let maxActive = 0

  const execute = async <A>(
    query: string,
    run: () => Promise<A>,
    templates: ReadonlyArray<string> = [query],
  ) => {
    queries.push(query)
    statements.push(...templates)
    active += 1
    maxActive = Math.max(maxActive, active)

    try {
      return await run()
    } finally {
      active -= 1
    }
  }

  class Statement implements D1PreparedStatement {
    constructor(
      readonly underlying: D1PreparedStatement,
      readonly query: string,
    ) {}
    bind(...values: Parameters<D1PreparedStatement['bind']>): D1PreparedStatement {
      return new Statement(this.underlying.bind(...values), this.query)
    }
    first<T = unknown>(column?: string): Promise<T | null> {
      return execute(this.query, () =>
        column === undefined ? this.underlying.first<T>() : this.underlying.first<T>(column),
      )
    }
    run<T = unknown>() {
      return execute(this.query, () => this.underlying.run<T>())
    }
    all<T = unknown>() {
      return execute(this.query, () => this.underlying.all<T>())
    }
    raw<T = Array<unknown>>(options: { columnNames: true }): Promise<[Array<string>, ...Array<T>]>
    raw<T = Array<unknown>>(options?: { columnNames?: false }): Promise<Array<T>>
    raw<T = Array<unknown>>(options?: {
      columnNames?: boolean
    }): Promise<Array<T> | [Array<string>, ...Array<T>]> {
      return execute<Array<T> | [Array<string>, ...Array<T>]>(this.query, () =>
        options?.columnNames
          ? this.underlying.raw<T>({ columnNames: true })
          : this.underlying.raw<T>(),
      )
    }
  }

  const observed: D1Database = {
    prepare: (query) => new Statement(database.prepare(query), query),
    batch: <T>(batchStatements: Array<D1PreparedStatement>) =>
      execute(
        'batch',
        () =>
          database.batch<T>(
            batchStatements.map((statement) =>
              statement instanceof Statement ? statement.underlying : statement,
            ),
          ),
        batchStatements.flatMap((statement) =>
          statement instanceof Statement ? [statement.query] : [],
        ),
      ),
    exec: (query) => execute(query, () => database.exec(query)),
    withSession: (constraint) => database.withSession(constraint),
    dump: () => database.dump(),
  }

  return {
    database: observed,
    queries,
    statements,
    get maxActive() {
      return maxActive
    },
    reset: () => {
      queries.length = 0
      statements.length = 0
      maxActive = 0
    },
  }
}
