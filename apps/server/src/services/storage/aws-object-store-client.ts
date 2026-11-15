import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
  type CompletedPart,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Effect, Layer, Option, Schema } from 'effect'

import { omitUndefined } from '@/lib/omit-undefined'
import { ConfigService } from '@/services/config.service'

import {
  ObjectStoreClient,
  type ObjectStoreClient as ObjectStoreClientType,
} from './object-store-client'
import { StorageProvider } from './provider'

const AwsFailure = Schema.Struct({
  name: Schema.String,
  $metadata: Schema.optional(Schema.Struct({ httpStatusCode: Schema.optional(Schema.Number) })),
})

const isNotFoundError = (cause: unknown) => {
  const failure = Option.getOrUndefined(Schema.decodeUnknownOption(AwsFailure)(cause))

  return (
    failure !== undefined &&
    (failure.name === 'NotFound' ||
      failure.name === 'NoSuchKey' ||
      failure.$metadata?.httpStatusCode === 404)
  )
}

const destroyClient = (client: S3Client) =>
  Effect.sync(() => {
    client.destroy()
  })

/** Creates the ECS object-storage capability backed by its ambient AWS role. */
export const makeAwsObjectStoreClientLayer = (makeClient: () => S3Client) =>
  Layer.effect(
    ObjectStoreClient,
    Effect.gen(function* () {
      const config = yield* ConfigService

      if (config.storage.provider !== StorageProvider.aws) {
        return yield* Effect.die(new Error('AWS object storage requires the aws provider'))
      }

      const client = yield* Effect.acquireRelease(Effect.sync(makeClient), destroyClient)

      return {
        provider: StorageProvider.aws,
        putObject: async ({ bucketName, key, body, contentType }) => {
          await client.send(
            new PutObjectCommand({
              Bucket: bucketName,
              Key: key,
              Body: body,
              ContentType: contentType,
            }),
          )
        },
        presignPutObject: ({ bucketName, key, contentType, expiresInSeconds, integrity }) =>
          getSignedUrl(
            client,
            new PutObjectCommand({
              Bucket: bucketName,
              Key: key,
              ContentType: contentType,
              ContentMD5: integrity?.contentMd5,
              ContentLength: integrity?.fileSize,
              IfNoneMatch: integrity ? '*' : undefined,
              Metadata: integrity ? { 'artwork-receipt': integrity.receipt } : undefined,
            }),
            omitUndefined({
              expiresIn: expiresInSeconds,
              unhoistableHeaders: integrity ? new Set(['x-amz-meta-artwork-receipt']) : undefined,
              signableHeaders: integrity
                ? new Set(['content-type', 'content-md5', 'content-length', 'if-none-match'])
                : undefined,
            }),
          ),
        deleteObject: async (bucketName, key) => {
          await client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }))
        },
        copyObject: async (bucketName, sourceKey, key) => {
          await client.send(
            new CopyObjectCommand({
              Bucket: bucketName,
              Key: key,
              CopySource: `/${encodeURIComponent(bucketName)}/${sourceKey.split('/').map(encodeURIComponent).join('/')}`,
            }),
          )
        },
        headObject: async (bucketName, key) => {
          try {
            const response = await client.send(
              new HeadObjectCommand({ Bucket: bucketName, Key: key }),
            )

            return { size: response.ContentLength ?? 0, metadata: response.Metadata ?? {} }
          } catch (error) {
            if (isNotFoundError(error)) return null
            throw error
          }
        },
        listObjects: async (bucketName, prefix) => {
          const objects: Array<{ key: string; lastModified: Date; size: number }> = []
          let continuationToken: string | undefined

          do {
            const response = await client.send(
              new ListObjectsV2Command({
                Bucket: bucketName,
                Prefix: prefix || undefined,
                ContinuationToken: continuationToken,
              }),
            )

            objects.push(
              ...(response.Contents ?? []).flatMap((object) =>
                object.Key && object.LastModified
                  ? [{ key: object.Key, lastModified: object.LastModified, size: object.Size ?? 0 }]
                  : [],
              ),
            )
            continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined
          } while (continuationToken)

          return objects
        },
        listBuckets: async () => {
          const response = await client.send(new ListBucketsCommand({}))

          return (response.Buckets ?? []).flatMap((bucket) => (bucket.Name ? [bucket.Name] : []))
        },
        createMultipartUpload: async ({ bucketName, key, contentType, expectedSize }) => {
          const response = await client.send(
            new CreateMultipartUploadCommand({
              Bucket: bucketName,
              Key: key,
              ContentType: contentType,
              Metadata: { 'expected-size': String(expectedSize) },
            }),
          )

          if (!response.UploadId) throw new Error('S3 did not return an UploadId')

          return response.UploadId
        },
        presignUploadPart: ({ bucketName, key, uploadId, partNumber, expiresInSeconds }) =>
          getSignedUrl(
            client,
            new UploadPartCommand({
              Bucket: bucketName,
              Key: key,
              UploadId: uploadId,
              PartNumber: partNumber,
            }),
            { expiresIn: expiresInSeconds },
          ),
        completeMultipartUpload: async ({ bucketName, key, uploadId, parts }) => {
          const sortedParts: Array<CompletedPart> = parts
            .toSorted((left, right) => left.partNumber - right.partNumber)
            .map((part) => ({ ETag: part.etag, PartNumber: part.partNumber }))

          await client.send(
            new CompleteMultipartUploadCommand({
              Bucket: bucketName,
              Key: key,
              UploadId: uploadId,
              MultipartUpload: { Parts: sortedParts },
            }),
          )
        },
        abortMultipartUpload: async (bucketName, key, uploadId) => {
          await client.send(
            new AbortMultipartUploadCommand({ Bucket: bucketName, Key: key, UploadId: uploadId }),
          )
        },
        listMultipartParts: async (bucketName, key, uploadId) => {
          const parts: Array<{ partNumber: number; etag: string; size: number }> = []
          let partNumberMarker: string | undefined

          do {
            const response = await client.send(
              new ListPartsCommand({
                Bucket: bucketName,
                Key: key,
                UploadId: uploadId,
                PartNumberMarker: partNumberMarker,
              }),
            )

            parts.push(
              ...(response.Parts ?? []).flatMap((part) =>
                part.PartNumber && part.ETag
                  ? [{ partNumber: part.PartNumber, etag: part.ETag, size: part.Size ?? 0 }]
                  : [],
              ),
            )
            partNumberMarker =
              response.IsTruncated && response.NextPartNumberMarker
                ? response.NextPartNumberMarker
                : undefined
          } while (partNumberMarker)

          return parts.toSorted((left, right) => left.partNumber - right.partNumber)
        },
      } satisfies ObjectStoreClientType
    }),
  )

export const AwsObjectStoreClientLayer = makeAwsObjectStoreClientLayer(() => new S3Client({}))
