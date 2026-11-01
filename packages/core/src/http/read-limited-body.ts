export const readLimitedBody = async (request: Request, limit: number): Promise<string | null> => {
  if (Number(request.headers.get('content-length')) > limit) return null
  const reader = request.body?.getReader()

  if (!reader) return ''
  const decoder = new TextDecoder()
  let length = 0
  let text = ''

  try {
    while (true) {
      const chunk = await reader.read()

      if (chunk.done) return text + decoder.decode()
      length += chunk.value.byteLength

      if (length > limit) return null
      text += decoder.decode(chunk.value, { stream: true })
    }
  } finally {
    await reader.cancel()
  }
}
