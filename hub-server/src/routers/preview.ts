import { Hono, Context } from 'hono'
import { badRequest, badGateway } from '../lib/errors'

const preview = new Hono()

const VALID_PROTOCOLS = ['http:', 'https:']

function isValidUrl(raw: string): URL {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw badRequest('NETWORK_INVALID_URL', 'Invalid URL format')
  }
  if (!VALID_PROTOCOLS.includes(parsed.protocol)) {
    throw badRequest('NETWORK_UNSUPPORTED_PROTOCOL', 'Only http and https URLs are supported')
  }
  return parsed
}

const RESOLVE_TIMEOUT_MS = 10_000
const PROXY_TIMEOUT_MS = 30_000

preview.post('/api/preview/resolve', async (c: Context) => {
  const body = await c.req.json()
  const rawUrl: string = body?.url

  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw badRequest('NETWORK_INVALID_URL', 'url is required and must be a string')
  }

  const trimmedUrl = rawUrl.trim()
  isValidUrl(trimmedUrl)

  try {
    const response = await fetch(trimmedUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
    })

    const reader = response.body?.getReader()
    if (reader) {
      await reader.cancel().catch(() => {})
    }

    return c.json({
      finalUrl: response.url,
      statusCode: response.status,
      redirected: response.redirected,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw badGateway('NETWORK_TIMEOUT', 'Request timed out while resolving URL')
    }
    throw badGateway('NETWORK_REQUEST_FAILED', 'Failed to fetch URL')
  }
})

preview.get('/api/preview/proxy', async (c: Context) => {
  const rawUrl = c.req.query('url')
  if (!rawUrl) {
    throw badRequest('NETWORK_INVALID_URL', 'url query parameter is required')
  }

  const parsedUrl = isValidUrl(rawUrl)

  const targetUrl = rawUrl.startsWith('http://localhost') || rawUrl.startsWith('https://localhost')
    ? rawUrl
    : parsedUrl.href

  try {
    const response = await fetch(targetUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    })

    const responseHeaders = new Headers()
    const stripHeaders = new Set([
      'x-frame-options',
      'content-security-policy',
      'content-security-policy-report-only',
      'cross-origin-resource-policy',
      'transfer-encoding',
      'connection',
      'keep-alive',
      'content-length',
      'content-encoding',
    ])

    for (const [key, value] of response.headers) {
      if (!stripHeaders.has(key.toLowerCase())) {
        responseHeaders.set(key, value)
      }
    }

    const contentType = response.headers.get('content-type') ?? ''
    let body: BodyInit | null = response.body

    if (/text\/html/i.test(contentType) && body) {
      const baseUrl = response.url
      const baseTag = `<base href="${baseUrl}">`
      let html = await response.text()
      if (/<head[^>]*>/i.test(html)) {
        html = html.replace(/<head[^>]*>/i, (match) => `${match}\n${baseTag}`)
      }
      body = html
    }

    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw badGateway('NETWORK_TIMEOUT', 'Request timed out while proxying URL')
    }
    throw badGateway('NETWORK_REQUEST_FAILED', 'Failed to proxy URL')
  }
})

export default preview
