import { Effect, Layer, Redacted } from 'effect'

import { omitUndefined } from '@/lib/omit-undefined'
import { ConfigService } from '@/services/config.service'

import {
  ObjectStoreClient,
  type ObjectStoreClient as ObjectStoreClientType,
} from './object-store-client'
import { StorageProvider } from './provider'
import { parseMultipartParts } from './r2-multipart'
import { ensureOk, presignedUrl, signedRequest, type R2SigningConfig } from './r2-signing'

interface R2Object {
  readonly key: string
  readonly size: number
  readonly uploaded: Date
  readonly customMetadata?: Readonly<Record<string, string>>
}

interface R2MultipartUpload {
  readonly uploadId: string
  complete(
    parts: Array<{ readonly partNumber: number; readonly etag: string }>,
  ): Promise<object | void>
  abort(): Promise<void>
}

export interface R2BucketCapability {
  put(
    key: string,
    body: Uint8Array | string,
    options: { readonly httpMetadata: { readonly contentType: string } },
  ): Promise<object | null | void>
  head(key: string): Promise<R2Object | null>
  delete(key: string): Promise<void>
  list(options?: { readonly prefix?: string; readonly cursor?: string }): Promise<{
    readonly objects: ReadonlyArray<R2Object>
    readonly truncated: boolean
    readonly cursor?: string
  }>
  createMultipartUpload(
    key: string,
    options: {
      readonly httpMetadata: { readonly contentType: string }
      readonly customMetadata: Readonly<Record<string, string>>
    },
  ): Promise<{ readonly uploadId: string }>
  resumeMultipartUpload(key: string, uploadId: string): R2MultipartUpload
}

export interface R2ObjectStoreBuckets {
  readonly userContent: R2BucketCapability
  readonly mixes: R2BucketCapability
}

const createSigningConfig = (
  storage: {
    readonly provider: string
    readonly accountId?: string
    readonly accessKeyId?: Redacted.Redacted
    readonly secretAccessKey?: Redacted.Redacted
  },
  bucketName: string,
): R2SigningConfig => {
  if (
    storage.provider !== StorageProvider.r2 ||
    storage.accountId === undefined ||
    storage.accessKeyId === undefined ||
    storage.secretAccessKey === undefined
  ) {
    throw new Error('Parsed R2 storage configuration is incomplete')
  }

  return {
    accountId: storage.accountId,
    accessKeyId: Redacted.value(storage.accessKeyId),
    secretAccessKey: Redacted.value(storage.secretAccessKey),
    bucketName,
  }
}

const selectBucket = (
  buckets: R2ObjectStoreBuckets,
  names: { readonly userContent: string; readonly mixes: string },
  bucketName: string,
) => {
  if (bucketName === names.userContent) return buckets.userContent

  if (bucketName === names.mixes) return buckets.mixes
  throw new Error(`R2 bucket is not configured: ${bucketName}`)
}

/** Creates the Worker object-storage capability from native R2 bindings. */
export const R2ObjectStoreClientLayer = (
  buckets: R2ObjectStoreBuckets,
  request: typeof signedRequest = signedRequest,
) =>
  Layer.effect(
    ObjectStoreClient,
    Effect.gen(function* () {
      const config = yield* ConfigService
      const services = yield* Effect.context<ConfigService>()
      const names = config.buckets

      const signingConfig = (bucketName: string) =>
        createSigningConfig(omitUndefined(config.storage), bucketName)

      const bucket = (bucketName: string) => selectBucket(buckets, names, bucketName)

      return {
        provider: StorageProvider.r2,
        putObject: async ({ bucketName, key, body, contentType }) => {
          const r2Body = body instanceof Blob ? new Uint8Array(await body.arrayBuffer()) : body
          await bucket(bucketName).put(key, r2Body, { httpMetadata: { contentType } })
        },
        presignPutObject: ({ bucketName, key, contentType, expiresInSeconds, integrity }) =>
          presignedUrl({
            config: signingConfig(bucketName),
            method: 'PUT',
            key,
            query: [],
            expiresSeconds: expiresInSeconds,
            headers: integrity
              ? {
                  'content-type': contentType,
                  'content-length': String(integrity.fileSize),
                  'content-md5': integrity.contentMd5,
                  'if-none-match': '*',
                  'x-amz-meta-artwork-receipt': integrity.receipt,
                }
              : {},
          }),
        deleteObject: (bucketName, key) => bucket(bucketName).delete(key),
        copyObject: async (bucketName, sourceKey, key) => {
          const response = await request({
            config: signingConfig(bucketName),
            method: 'PUT',
            key,
            query: [],
            headers: {
              'x-amz-copy-source': `/${encodeURIComponent(bucketName)}/${sourceKey.split('/').map(encodeURIComponent).join('/')}`,
            },
          })

          await ensureOk(response)
          // S3 can report a copy failure inside an HTTP 200 response.
          const body = await response.text()

          if (!body.includes('<CopyObjectResult') || body.includes('<Error>'))
            throw new Error('R2 object copy failed')
        },
        headObject: async (bucketName, key) => {
          const object = await bucket(bucketName).head(key)

          if (!object) return null

          return { size: object.size, metadata: object.customMetadata ?? {} }
        },
        listObjects: async (bucketName, prefix) => {
          const objects: Array<{ key: string; lastModified: Date; size: number }> = []
          let cursor: string | undefined

          do {
            const options = omitUndefined({ prefix: prefix || undefined, cursor })
            const page = await bucket(bucketName).list(options)
            objects.push(
              ...page.objects.map((object) => ({
                key: object.key,
                lastModified: object.uploaded,
                size: object.size,
              })),
            )
            cursor = page.truncated ? page.cursor : undefined
          } while (cursor)

          return objects
        },
        listBuckets: async () => [names.userContent, names.mixes],
        createMultipartUpload: async ({ bucketName, key, contentType, expectedSize }) => {
          const upload = await bucket(bucketName).createMultipartUpload(key, {
            httpMetadata: { contentType },
            customMetadata: { 'expected-size': String(expectedSize) },
          })

          return upload.uploadId
        },
        presignUploadPart: ({ bucketName, key, uploadId, partNumber, expiresInSeconds }) =>
          presignedUrl({
            config: signingConfig(bucketName),
            method: 'PUT',
            key,
            query: [
              ['partNumber', String(partNumber)],
              ['uploadId', uploadId],
            ],
            expiresSeconds: expiresInSeconds,
          }),
        completeMultipartUpload: async ({ bucketName, key, uploadId, parts }) => {
          await bucket(bucketName)
            .resumeMultipartUpload(key, uploadId)
            .complete(
              parts.map((part) => ({
                partNumber: part.partNumber,
                etag: part.etag.replace(/^"(.*)"$/, '$1'),
              })),
            )
        },
        abortMultipartUpload: async (bucketName, key, uploadId) => {
          await bucket(bucketName).resumeMultipartUpload(key, uploadId).abort()
        },
        listMultipartParts: async (bucketName, key, uploadId) => {
          const response = await request({
            config: signingConfig(bucketName),
            method: 'GET',
            key,
            query: [['uploadId', uploadId]],
          })

          await ensureOk(response)

          return Effect.runPromiseWith(services)(parseMultipartParts(await response.text()))
        },
      } satisfies ObjectStoreClientType
    }),
  )
