import { S3Client } from '@aws-sdk/client-s3'
import { Effect, Layer } from 'effect'
import { expect, test } from 'vitest'

import { ConfigService, createConfig } from '@/services/config.service'
import { withTestLayer } from '@/test/effect'

import { makeAwsObjectStoreClientLayer } from './aws-object-store-client'
import { ObjectStoreClient } from './object-store-client'

test('AWS artwork presigning binds integrity, owner receipt and create-only headers', async () => {
  const config = createConfig()

  const layer = makeAwsObjectStoreClientLayer(
    () =>
      new S3Client({
        region: 'us-east-1',
        credentials: { accessKeyId: 'fixture-key', secretAccessKey: 'fixture-secret' },
      }),
  ).pipe(
    Layer.provide(
      Layer.succeed(ConfigService, {
        ...config,
        storage: { ...config.storage, provider: 'aws' },
      }),
    ),
  )

  const url = new URL(
    await Effect.runPromise(
      withTestLayer(
        Effect.flatMap(ObjectStoreClient, (store) =>
          Effect.promise(() =>
            store.presignPutObject({
              bucketName: 'fixture-bucket',
              key: 'private/owner/image/id/fixture.png',
              contentType: 'image/png',
              expiresInSeconds: 300,
              integrity: {
                contentMd5: 'AAAAAAAAAAAAAAAAAAAAAA==',
                fileSize: 68,
                receipt: 'fixture-receipt',
              },
            }),
          ),
        ),
        layer,
      ),
    ),
  )

  expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe(
    'content-length;content-md5;content-type;host;if-none-match;x-amz-meta-artwork-receipt',
  )
  expect(url.searchParams.get('X-Amz-Expires')).toBe('300')
  expect(url.searchParams.get('x-amz-meta-artwork-receipt')).toBeNull()
})

test('AWS adapter sends an authenticated server-side CopyObject request without streaming bytes', async () => {
  const requests: Array<{ method: string; path: string; headers: Record<string, string> }> = []

  const client = () =>
    new S3Client({
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'disposable-test-access',
        secretAccessKey: 'disposable-test-secret',
      },
      requestHandler: {
        handle: async (request: {
          method: string
          path: string
          headers: Record<string, string>
        }) => {
          requests.push({ method: request.method, path: request.path, headers: request.headers })

          return {
            response: {
              statusCode: 200,
              headers: { 'content-type': 'application/xml' },
              body: new TextEncoder().encode(
                '<CopyObjectResult><LastModified>2026-01-01T00:00:00.000Z</LastModified><ETag>test-etag</ETag></CopyObjectResult>',
              ),
            },
          }
        },
      },
    })

  const config = createConfig()

  const layer = makeAwsObjectStoreClientLayer(client).pipe(
    Layer.provide(
      Layer.succeed(ConfigService, { ...config, storage: { ...config.storage, provider: 'aws' } }),
    ),
  )

  await Effect.runPromise(
    withTestLayer(
      Effect.gen(function* () {
        const store = yield* ObjectStoreClient
        yield* Effect.promise(() =>
          store.copyObject(
            'publication-test',
            'private/owner/image/id/a b.png',
            'public/owner/image/id/a b.png',
          ),
        )
      }),
      layer,
    ),
  )
  expect(requests).toHaveLength(1)
  expect(requests[0]?.method).toBe('PUT')
  expect(requests[0]?.path).toBe('/public/owner/image/id/a%20b.png')
  expect(requests[0]?.headers['x-amz-copy-source']).toBe(
    '/publication-test/private/owner/image/id/a%20b.png',
  )
  expect(requests[0]?.headers['authorization']).toContain('AWS4-HMAC-SHA256')
})
