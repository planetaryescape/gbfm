import type { ConsentState } from './domain'

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`)

export const consentDocument = ({
  clientName: name,
  continuation: { query, scopes },
}: typeof ConsentState.cases.Verified.Type) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="strict-origin"><title>Connect to gbfm</title>
<style>body{font-family:system-ui,sans-serif;background:#111;color:#eee;margin:0;padding:2rem}main{max-width:34rem;margin:8vh auto}a{color:inherit}h1{font-size:2rem}p,li{line-height:1.6}form{display:flex;gap:1rem;margin:2rem 0}button{padding:.8rem 1.2rem;font:inherit;cursor:pointer;border:1px solid #999;border-radius:.3rem}button[value=allow]{background:#eee;color:#111}button[value=deny]{background:transparent;color:inherit}</style></head>
<body><main><a href="/">goosebumps.fm</a><h1>Connect ${escape(name)} to gbfm</h1>
<p>This app is asking to access your gbfm account:</p><ul>${scopes.map((scope) => `<li>${scope === 'posts:read' ? 'Read your posts, including drafts and private posts' : 'Keep access until you disconnect, even when you are not signed in'}</li>`).join('')}</ul>
<p>This connection cannot create, edit, publish or delete posts. Only connect apps you trust.</p>
<form method="post" action="/connect/gbfm/consent"><input type="hidden" name="oauth_query" value="${escape(query)}"><button name="decision" value="allow" type="submit">Allow connection</button><button name="decision" value="deny" type="submit">Deny</button></form>
<p>You can disconnect this app at any time in <a href="/dashboard/connections">Connections</a>.</p></main></body></html>`
