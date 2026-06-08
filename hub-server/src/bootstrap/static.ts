import { serveStatic } from 'hono/bun'
import type { Hono } from 'hono'

interface StaticWebOptions {
  publicDir: string
}

export function attachStaticWeb(app: Hono, options: StaticWebOptions): void {
  app.use('/assets/*', serveStatic({ root: options.publicDir }))
  app.get('/favicon*', serveStatic({ root: options.publicDir }))
  app.get('/manifest*', serveStatic({ root: options.publicDir }))

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

  app.get('*', serveStatic({
    root: options.publicDir,
    rewriteRequestPath: () => '/index.html',
  }))
}
