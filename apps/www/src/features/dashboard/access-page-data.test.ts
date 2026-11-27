import { expect, it } from 'vitest'

import { dashboardAccessStatus, loadDashboardData } from '../../page/dashboard/page-data'
import { Route } from '../../route'
import { emptyDocument } from './document'
import { adminSections } from './sections'

it.each(['user', 'creator', 'editor'])(
  'returns a renderable denied document without requesting administrator data for %s',
  async (role) => {
    const requests: Array<string> = []

    for (const [section] of adminSections) {
      const url = new URL(`/dashboard/${section}`, 'https://fixture.test')

      const document = await loadDashboardData(
        new Request(url),
        Route.cases.Dashboard.make({ section }),
        url,
        { role },
        async (_request, path) => {
          requests.push(path)
          throw new Error('Denied Dashboard must not fetch administrator data')
        },
      )

      expect(document).toEqual(emptyDocument)
      expect(dashboardAccessStatus(Route.cases.Dashboard.make({ section }), { role })).toBe(403)
    }

    expect(requests).toEqual([])
  },
)

it('does not turn an authorized failed fetch into a documentless or forbidden success', async () => {
  const url = new URL('/dashboard/users', 'https://fixture.test')
  const route = Route.cases.Dashboard.make({ section: 'users' })
  const requests: Array<string> = []

  const document = await loadDashboardData(
    new Request(url),
    route,
    url,
    { role: 'admin' },
    async (_request, path) => {
      requests.push(path)

      return new Response(null, { status: 503 })
    },
  )

  expect(document).toBeNull()
  expect(dashboardAccessStatus(route, { role: 'admin' })).toBeUndefined()
  expect(requests).toEqual(['/auth/admin/list-users?limit=25&offset=0'])
})

it('keeps anonymous and ordinary account routes out of the administrator denial status', () => {
  expect(
    dashboardAccessStatus(Route.cases.Dashboard.make({ section: 'users' }), null),
  ).toBeUndefined()
  expect(
    dashboardAccessStatus(Route.cases.Dashboard.make({ section: 'profile' }), { role: 'creator' }),
  ).toBeUndefined()
  expect(
    dashboardAccessStatus(Route.cases.Dashboard.make({ section: 'music-entity/album/fixture' }), {
      role: 'creator',
    }),
  ).toBe(403)
})
