import { expect, it } from 'vitest'

import { loginOAuthQuery, oauthQuery, providerRedirect } from './continuation'
import { ProviderOutcome } from './domain'

it('preserves repeated signed resource and ba_param entries without ambient flow state', () => {
  const first = new URLSearchParams(
    'client_id=first&scope=posts%3Aread&resource=https%3A%2F%2Fone.test&resource=https%3A%2F%2Ftwo.test&exp=123&sig=first&ba_param=client_id&ba_param=scope&ba_param=resource&ba_param=exp&ba_param=ba_param&noise=discard',
  )

  const second = new URLSearchParams(first)
  second.set('client_id', 'second')
  second.set('sig', 'second')

  const firstFlow = loginOAuthQuery(`/connect/gbfm?${first}`, 'https://www.test')
  const secondFlow = loginOAuthQuery(`/connect/gbfm?${second}`, 'https://www.test')

  expect(firstFlow).not.toBeNull()
  expect(new URLSearchParams(firstFlow ?? '').getAll('resource')).toEqual([
    'https://one.test',
    'https://two.test',
  ])
  expect(new URLSearchParams(firstFlow ?? '').getAll('ba_param')).toEqual([
    'client_id',
    'scope',
    'resource',
    'exp',
    'ba_param',
  ])
  expect(new URLSearchParams(firstFlow ?? '').get('noise')).toBeNull()
  expect(new URLSearchParams(secondFlow ?? '').get('client_id')).toBe('second')
  expect(new URLSearchParams(firstFlow ?? '').get('client_id')).toBe('first')
  expect(oauthQuery(new URLSearchParams('client_id=unsigned'))).toBeNull()
  expect(loginOAuthQuery(`https://evil.test/connect/gbfm?${first}`, 'https://www.test')).toBeNull()
})

it('uses only successful provider redirects and matches native callbacks against the signed flow', async () => {
  const response = (url: string) => Response.json({ redirect: true, url })

  const redirected = (location: string) =>
    ProviderOutcome.cases.Redirect.make({ location, cookies: [] })

  const rejected = ProviderOutcome.cases.Rejected.make({ status: 502 })

  const native = new URLSearchParams({
    redirect_uri: 'com.example.editor:/oauth/callback',
  }).toString()

  expect(
    await providerRedirect(
      response('com.example.editor:/oauth/callback?code=disposable'),
      'https://www.test',
      native,
    ),
  ).toEqual(redirected('com.example.editor:/oauth/callback?code=disposable'))
  expect(
    await providerRedirect(response('other.app:/oauth/callback'), 'https://www.test', native),
  ).toEqual(rejected)
  expect(
    await providerRedirect(response('com.example.editor:/unexpected'), 'https://www.test', native),
  ).toEqual(rejected)
  expect(
    await providerRedirect(
      response('javascript:alert(1)'),
      'https://www.test',
      'redirect_uri=javascript%3Aalert%281%29',
    ),
  ).toEqual(rejected)
  expect(
    await providerRedirect(
      Response.json({ redirect: true, url: 'https://evil.test' }, { status: 400 }),
      'https://www.test',
      native,
    ),
  ).toEqual(ProviderOutcome.cases.Rejected.make({ status: 400 }))
  expect(
    await providerRedirect(
      response('http://127.0.0.1:49152/callback?code=disposable'),
      'https://www.test',
      native,
    ),
  ).toEqual(redirected('http://127.0.0.1:49152/callback?code=disposable'))
  expect(
    await providerRedirect(
      response('https://api.goosebumps.fm/connect/gbfm/consent?sig=disposable'),
      'https://goosebumps.fm',
      native,
      'https://api.goosebumps.fm',
    ),
  ).toEqual(redirected('/connect/gbfm/consent?sig=disposable'))
  expect(
    await providerRedirect(
      response('https://other.app/connect/gbfm?code=disposable'),
      'https://goosebumps.fm',
      native,
    ),
  ).toEqual(redirected('https://other.app/connect/gbfm?code=disposable'))
})

it('normalizes the supplied API origin without trusting the production host in other environments', async () => {
  const redirect = (url: string) => Response.json({ redirect: true, url })
  expect(
    await providerRedirect(
      redirect('https://api.staging.test/connect/gbfm?sig=fixture'),
      'https://www.staging.test',
      '',
      'https://api.staging.test',
    ),
  ).toEqual(
    ProviderOutcome.cases.Redirect.make({ location: '/connect/gbfm?sig=fixture', cookies: [] }),
  )
  expect(
    await providerRedirect(
      redirect('https://api.goosebumps.fm/connect/gbfm?sig=fixture'),
      'https://www.staging.test',
      '',
      'https://api.staging.test',
    ),
  ).toEqual(
    ProviderOutcome.cases.Redirect.make({
      location: 'https://api.goosebumps.fm/connect/gbfm?sig=fixture',
      cookies: [],
    }),
  )
})
