declare module '*dist/server/fetch.js' {
  const handler: { readonly fetch: (request: Request) => Promise<Response> }

  export default handler
}
