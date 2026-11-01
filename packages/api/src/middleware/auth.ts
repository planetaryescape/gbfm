import { Context } from 'effect'
import { HttpApiError, HttpApiMiddleware } from 'effect/http-api'

export class AuthSession extends Context.Service<
  AuthSession,
  {
    // role/name are nullable because better-auth's admin() plugin types them
    // loosely (apps/server/src/lib/auth.ts) -- packages/api is a leaf package and
    // can't import that concrete type, so this stays as the honest common shape.
    readonly user: {
      readonly id: string
      readonly name: string | null | undefined
      readonly email: string
      readonly role?: string | null | undefined
    }
    readonly session: {
      readonly id: string
      readonly createdAt: Date
      readonly impersonatedBy?: string | null | undefined
    }
  }
>()('api/AuthSession') {}

// provides is a type parameter, not a runtime option -- effect@4.0.0-beta.93's
// HttpApiMiddleware.Service<Self, Config>() takes Config.provides at the type
// level; passing { provides: AuthSession } in the options object (as an earlier
// version of docs/migration-effect-http-api.md showed) does not typecheck.
//
// `provides: AuthSession` (the class used as a type = its INSTANCE type), not
// `typeof AuthSession` (the class's static/constructor type) -- the latter
// silently compiles but breaks the exclusion machinery that's supposed to
// remove AuthSession from a handler's inferred requirements once the endpoint
// declares .middleware(AuthMiddleware). Confirmed against
// .repos/effect/packages/effect/typetest/unstable/httpapi/HttpApiBuilder.tst.ts,
// which uses the bare class reference.
export class AuthMiddleware extends HttpApiMiddleware.Service<
  AuthMiddleware,
  { provides: AuthSession }
>()('api/AuthMiddleware', {
  error: HttpApiError.Unauthorized,
}) {}
