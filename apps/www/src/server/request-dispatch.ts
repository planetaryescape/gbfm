import type * as Server from 'foldkit/experimental/server'

import { dispatchHttp } from './http-dispatch'
import { createPageResponse } from './page-response'

export const renderResponse = (request: Request): Promise<Server.EntryResult> =>
  dispatchHttp(request, createPageResponse)
