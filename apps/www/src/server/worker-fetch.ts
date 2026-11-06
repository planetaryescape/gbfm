type FetchPage = (request: Request) => Promise<Response>

type Bindings = {
  readonly API: { readonly fetch: (request: Request) => Promise<Response> }
}

export const websiteFetch =
  (fetchPage: FetchPage) => async (request: Request, bindings: Bindings) => {
    const url = new URL(request.url)

    if (url.pathname === '/mcp.txt')
      return bindings.API.fetch(
        new Request(new URL(`${url.pathname}${url.search}`, 'https://api.internal'), request),
      )

    return fetchPage(request)
  }
