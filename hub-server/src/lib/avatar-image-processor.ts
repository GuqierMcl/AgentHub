import sharp from 'sharp'
import sanitizeHtml from 'sanitize-html'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, extname } from 'node:path'

const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
])

const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'])

export const AVATAR_MAX_SIZE = 5 * 1024 * 1024
export const AVATAR_TARGET_SIZE = 256

export function isAllowedImageType(mimeType: string): boolean {
  return ALLOWED_MIME_TYPES.has(mimeType)
}

export function isAllowedExtension(filename: string): boolean {
  const ext = extname(filename).toLowerCase()
  return ALLOWED_EXTENSIONS.has(ext)
}

export function extensionToMimeType(filename: string): string | null {
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
  }
  return map[extname(filename).toLowerCase()] ?? null
}

export async function processBitmap(inputPath: string, outputDir: string, filename: string): Promise<{ width: number; height: number; size: number }> {
  const outputFile = resolve(outputDir, filename)

  const image = sharp(inputPath)
  await image
    .resize(AVATAR_TARGET_SIZE, AVATAR_TARGET_SIZE, { fit: 'cover', position: 'centre' })
    .webp({ quality: 90 })
    .toFile(outputFile)

  const result = await sharp(outputFile).metadata()
  return {
    width: result.width ?? AVATAR_TARGET_SIZE,
    height: result.height ?? AVATAR_TARGET_SIZE,
    size: (await sharp(outputFile).toBuffer()).length,
  }
}

export function sanitizeAndSaveSvg(inputPath: string, outputDir: string, filename: string): { width: number; height: number; size: number } {
  const rawSvg = readFileSync(inputPath, 'utf-8')

  const cleanSvg = sanitizeHtml(rawSvg, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      'svg', 'g', 'path', 'circle', 'rect', 'line', 'polyline',
      'polygon', 'ellipse', 'text', 'tspan', 'defs', 'use',
      'mask', 'clipPath', 'linearGradient', 'radialGradient',
      'stop', 'filter', 'feGaussianBlur', 'feOffset', 'feMerge',
      'feMergeNode', 'feColorMatrix', 'feComposite', 'feBlend',
      'feFlood', 'feTile', 'feImage', 'animate', 'animateTransform',
      'animateMotion', 'set', 'desc', 'metadata', 'title',
    ]),
    allowedAttributes: {
      svg: ['xmlns', 'viewBox', 'width', 'height', 'fill', 'stroke', 'stroke-width',
        'color', 'style', 'role', 'aria-label', 'preserveAspectRatio'],
      g: ['fill', 'stroke', 'stroke-width', 'transform', 'opacity', 'style'],
      path: ['d', 'fill', 'stroke', 'stroke-width', 'transform', 'opacity', 'style',
        'stroke-linecap', 'stroke-linejoin', 'fill-rule', 'clip-rule'],
      circle: ['cx', 'cy', 'r', 'fill', 'stroke', 'stroke-width', 'opacity', 'style'],
      rect: ['x', 'y', 'width', 'height', 'rx', 'ry', 'fill', 'stroke', 'stroke-width', 'opacity', 'style'],
      line: ['x1', 'y1', 'x2', 'y2', 'fill', 'stroke', 'stroke-width', 'opacity', 'style'],
      polyline: ['points', 'fill', 'stroke', 'stroke-width', 'opacity', 'style'],
      polygon: ['points', 'fill', 'stroke', 'stroke-width', 'opacity', 'style'],
      ellipse: ['cx', 'cy', 'rx', 'ry', 'fill', 'stroke', 'stroke-width', 'opacity', 'style'],
      text: ['x', 'y', 'fill', 'stroke', 'font-size', 'font-family', 'text-anchor',
        'dominant-baseline', 'transform', 'opacity', 'style'],
      tspan: ['x', 'y', 'dx', 'dy', 'fill', 'stroke', 'font-size', 'font-family', 'style'],
      use: ['href', 'x', 'y', 'width', 'height', 'fill', 'stroke'],
      stop: ['offset', 'stop-color', 'stop-opacity'],
      feGaussianBlur: ['stdDeviation', 'in', 'result'],
      feOffset: ['dx', 'dy', 'in', 'result'],
      feMerge: ['in'],
      feMergeNode: ['in'],
      feColorMatrix: ['in', 'type', 'values'],
      feComposite: ['in', 'in2', 'operator'],
      feBlend: ['in', 'in2', 'mode'],
      feFlood: ['flood-color', 'flood-opacity'],
      filter: ['id', 'x', 'y', 'width', 'height'],
      mask: ['id', 'x', 'y', 'width', 'height', 'fill'],
      clipPath: ['id'],
      defs: [],
      animate: ['attributeName', 'from', 'to', 'dur', 'repeatCount', 'values', 'keyTimes'],
      animateTransform: ['attributeName', 'type', 'from', 'to', 'dur', 'repeatCount', 'values'],
      animateMotion: ['dur', 'repeatCount', 'path'],
      metadata: [],
      title: [],
      desc: [],
    },
    allowedSchemes: ['http', 'https'],
    allowedSchemesAppliedToAttributes: ['href', 'src', 'xlink:href'],
    disallowedTagsMode: 'discard',
    allowProtocolRelative: false,
    enforceHtmlBoundary: true,
  })

  const outputFile = resolve(outputDir, filename)
  writeFileSync(outputFile, cleanSvg, 'utf-8')

  const size = Buffer.byteLength(cleanSvg, 'utf-8')
  return { width: AVATAR_TARGET_SIZE, height: AVATAR_TARGET_SIZE, size }
}
