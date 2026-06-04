import { Hono, Context } from 'hono'
import { badRequest, badGateway } from '../lib/errors'

const preview = new Hono()

const VALID_PROTOCOLS = ['http:', 'https:']
const PREVIEW_NAV_MESSAGE_TYPE = 'PREVIEW_NAVIGATE'

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

function buildPreviewNavigationScript(): string {
  return [
    '<script>(function(){',
    'var d=document;',
    'function resolveUrl(u){try{return new URL(String(u),d.baseURI).href}catch(e){return null}}',
    `function postNavigate(u){var r=resolveUrl(u);if(!r)return false;var p;try{p=new URL(r)}catch(e){return false}if(p.protocol!=='http:'&&p.protocol!=='https:')return false;window.parent.postMessage({type:'${PREVIEW_NAV_MESSAGE_TYPE}',url:r},'*');return true}`,
    "d.addEventListener('click',function(e){var l=e.target&&e.target.closest?e.target.closest('a'):null;if(!l)return;var h=l.getAttribute('href');if(!h||h.startsWith('#'))return;if(!postNavigate(h))return;e.preventDefault()},{capture:true});",
    'var originalOpen=window.open;window.open=function(u){if(u&&postNavigate(u))return null;return typeof originalOpen===\'function\'?originalOpen.apply(this,arguments):null};',
    '})()</script>',
  ].join('')
}

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
      const navScript = buildPreviewNavigationScript()
      let html = await response.text()
      if (/<head[^>]*>/i.test(html)) {
        html = html.replace(/<head[^>]*>/i, (match) => `${match}\n${baseTag}\n${navScript}`)
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
