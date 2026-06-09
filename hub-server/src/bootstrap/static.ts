import { serveStatic } from 'hono/bun'
import type { Hono } from 'hono'

interface StaticWebOptions {
  publicDir: string
}

function looksLikeStaticAssetPath(path: string): boolean {
  const lastSegment = path.split('/').pop() ?? ''
  return lastSegment.includes('.')
}

export function attachStaticWeb(app: Hono, options: StaticWebOptions): void {
  app.get('*', async (c, next) => {
    if (c.req.path === '/api' || c.req.path.startsWith('/api/')) {
      return c.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: 'API route not found',
          },
        },
        404,
      )
    }
    await next()
  })

  app.get('*', serveStatic({ root: options.publicDir }))

  app.get('*', async (c, next) => {
    if (looksLikeStaticAssetPath(c.req.path)) {
      return c.notFound()
    }
    await next()
  })

  app.get('*', serveStatic({
    root: options.publicDir,
    rewriteRequestPath: () => '/index.html',
  }))
}
