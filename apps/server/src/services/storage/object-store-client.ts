import { Context, Layer } from 'effect'

import type { StorageProvider } from './provider'

export interface StoredObjectMetadata {
  readonly size: number
  readonly metadata: Readonly<Record<string, string>>
}

export interface StoredObject {
  readonly key: string
  readonly lastModified: Date
  readonly size: number
}

export interface MultipartPart {
  readonly partNumber: number
  readonly etag: string
  readonly size: number
}

export interface ObjectStoreClient {
  readonly provider: StorageProvider
  readonly putObject: (input: {
    readonly bucketName: string
    readonly key: string
    readonly body: Uint8Array | Blob | string
    readonly contentType: string
  }) => Promise<void>
  readonly presignPutObject: (input: {
    readonly bucketName: string
    readonly key: string
    readonly contentType: string
    readonly expiresInSeconds: number
    readonly integrity?: {
      readonly contentMd5: string
      readonly fileSize: number
      readonly receipt: string
    }
  }) => Promise<string>
  readonly deleteObject: (bucketName: string, key: string) => Promise<void>
  /** Server-side copy; source bytes and metadata are preserved. */
  readonly copyObject: (bucketName: string, sourceKey: string, key: string) => Promise<void>
  readonly headObject: (bucketName: string, key: string) => Promise<StoredObjectMetadata | null>
  readonly listObjects: (bucketName: string, prefix: string) => Promise<Array<StoredObject>>
  readonly listBuckets: () => Promise<Array<string>>
  readonly createMultipartUpload: (input: {
    readonly bucketName: string
    readonly key: string
    readonly contentType: string
    readonly expectedSize: number
  }) => Promise<string>
  readonly presignUploadPart: (input: {
    readonly bucketName: string
    readonly key: string
    readonly uploadId: string
    readonly partNumber: number
    readonly expiresInSeconds: number
  }) => Promise<string>
  readonly completeMultipartUpload: (input: {
    readonly bucketName: string
    readonly key: string
    readonly uploadId: string
    readonly parts: ReadonlyArray<{ readonly partNumber: number; readonly etag: string }>
  }) => Promise<void>
  readonly abortMultipartUpload: (
    bucketName: string,
    key: string,
    uploadId: string,
  ) => Promise<void>
  readonly listMultipartParts: (
    bucketName: string,
    key: string,
    uploadId: string,
  ) => Promise<Array<MultipartPart>>
}

export const ObjectStoreClient = Context.Service<ObjectStoreClient>('ObjectStoreClient')

const unavailable = () => Promise.reject(new Error('Object storage is unavailable in this runtime'))

export const UnavailableObjectStoreClientLayer = Layer.succeed(ObjectStoreClient, {
  provider: 'aws',
  putObject: unavailable,
  presignPutObject: unavailable,
  deleteObject: unavailable,
  copyObject: unavailable,
  headObject: unavailable,
  listObjects: unavailable,
  listBuckets: unavailable,
  createMultipartUpload: unavailable,
  presignUploadPart: unavailable,
  completeMultipartUpload: unavailable,
  abortMultipartUpload: unavailable,
  listMultipartParts: unavailable,
} satisfies ObjectStoreClient)
