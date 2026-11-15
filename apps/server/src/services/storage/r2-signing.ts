import { omitUndefined } from '@/lib/omit-undefined'

export interface R2SigningConfig {
  readonly accountId: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly bucketName: string
}

export interface CompletedUploadPart {
  readonly partNumber: number
  readonly etag: string
}

const textEncoder = new TextEncoder()

const encodeString = (value: string) => {
  const encoded = textEncoder.encode(value)
  const buffer = new ArrayBuffer(encoded.byteLength)
  new Uint8Array(buffer).set(encoded)

  return buffer
}

const toHex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('')

const sha256Hex = async (value: string) =>
  toHex(await crypto.subtle.digest('SHA-256', encodeString(value)))

const hmac = async (key: ArrayBuffer, value: string) => {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  return crypto.subtle.sign('HMAC', cryptoKey, encodeString(value))
}

const encodeRfc3986 = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )

const encodeKeyPath = (key: string) => key.split('/').map(encodeRfc3986).join('/')

const formatAmzDate = (date: Date) => date.toISOString().replace(/[:-]|\.\d{3}/g, '')

const signingKey = async (secretAccessKey: string, dateStamp: string) => {
  const dateKey = await hmac(encodeString(`AWS4${secretAccessKey}`), dateStamp)
  const regionKey = await hmac(dateKey, 'auto')
  const serviceKey = await hmac(regionKey, 's3')

  return hmac(serviceKey, 'aws4_request')
}

export const canonicalQuery = (params: ReadonlyArray<[string, string]>) =>
  [...params]
    .map(([key, value]): [string, string] => [encodeRfc3986(key), encodeRfc3986(value)])
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')

export const signedRequest = async (input: {
  readonly config: R2SigningConfig
  readonly method: string
  readonly key: string
  readonly query: ReadonlyArray<[string, string]>
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: string
  readonly now?: Date
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>
}) => {
  const now = input.now ?? new Date()
  const amzDate = formatAmzDate(now)
  const dateStamp = amzDate.slice(0, 8)
  const host = `${input.config.accountId}.r2.cloudflarestorage.com`
  const payload = input.body ?? ''
  const payloadHash = await sha256Hex(payload)

  const headers = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...input.headers,
  }

  const sortedHeaders = Object.entries(headers)
    .map(([key, value]): [string, string] => [key.toLowerCase(), value])
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))

  const signedHeaders = sortedHeaders.map(([key]) => key).join(';')
  const canonicalHeaders = sortedHeaders.map(([key, value]) => `${key}:${value.trim()}\n`).join('')
  const path = `/${input.config.bucketName}/${encodeKeyPath(input.key)}`
  const query = canonicalQuery(input.query)

  const canonicalRequest = [
    input.method,
    path,
    query,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const credentialScope = `${dateStamp}/auto/s3/aws4_request`

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n')

  const signature = toHex(
    await hmac(await signingKey(input.config.secretAccessKey, dateStamp), stringToSign),
  )

  const authorization = `AWS4-HMAC-SHA256 Credential=${input.config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  const url = `https://${host}${path}${query ? `?${query}` : ''}`

  return (input.fetch ?? fetch)(
    url,
    omitUndefined({
      method: input.method,
      headers: { ...headers, authorization },
      body: input.body,
    }),
  )
}

export const presignedUrl = async (input: {
  readonly config: R2SigningConfig
  readonly method: string
  readonly key: string
  readonly query: ReadonlyArray<[string, string]>
  readonly expiresSeconds: number
  readonly headers?: Readonly<Record<string, string>>
  readonly now?: Date
}) => {
  const now = input.now ?? new Date()
  const amzDate = formatAmzDate(now)
  const dateStamp = amzDate.slice(0, 8)
  const host = `${input.config.accountId}.r2.cloudflarestorage.com`
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`
  const path = `/${input.config.bucketName}/${encodeKeyPath(input.key)}`

  const headers = Object.entries({ host, ...input.headers })
    .map(([key, value]): [string, string] => [key.toLowerCase(), value.trim()])
    .sort(([left], [right]) => left.localeCompare(right))

  const signedHeaders = headers.map(([key]) => key).join(';')
  const canonicalHeaders = headers.map(([key, value]) => `${key}:${value}\n`).join('')

  const query = canonicalQuery([
    ...input.query,
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${input.config.accessKeyId}/${credentialScope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(input.expiresSeconds)],
    ['X-Amz-SignedHeaders', signedHeaders],
  ])

  const canonicalRequest = [
    input.method,
    path,
    query,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n')

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n')

  const signature = toHex(
    await hmac(await signingKey(input.config.secretAccessKey, dateStamp), stringToSign),
  )

  return `https://${host}${path}?${query}&X-Amz-Signature=${signature}`
}

export const parseUploadId = async (response: Response) => {
  const body = await response.text()

  if (!response.ok) throw new Error(body || `R2 responded with ${response.status}`)

  const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(body)?.[1]

  if (!uploadId) throw new Error('R2 did not return an upload id')

  return uploadId
}

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

export const completeMultipartXml = (parts: ReadonlyArray<CompletedUploadPart>) =>
  `<CompleteMultipartUpload>${parts
    .map(
      (part) =>
        `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${escapeXml(part.etag)}</ETag></Part>`,
    )
    .join('')}</CompleteMultipartUpload>`

export const ensureOk = async (response: Response) => {
  if (!response.ok)
    throw new Error((await response.text()) || `R2 responded with ${response.status}`)
}
