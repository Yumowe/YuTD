import { ANALYSIS_MAX_SIZE, analyzePixels } from './ana'
import { encodeAnalysisPng } from './png'
import { toRegionJSON } from './render'
import type { AnaOptions } from './types'
import type { SimplifiedImageComparison, SimplifiedImageData, SimplifiedImageRegions } from './index'

export interface SimplifyImageRequest {
  blob: Blob
  format: 'png' | 'json' | 'comparison' | 'regions'
  options?: AnaOptions
}
export type SimplifyImageResult = Blob | SimplifiedImageData | SimplifiedImageComparison | SimplifiedImageRegions
export type SimplifyImageReply = { result: SimplifyImageResult } | { error: string }

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<SimplifyImageRequest>) => void
  postMessage: (reply: SimplifyImageReply) => void
}

async function simplify({ blob, format, options }: SimplifyImageRequest): Promise<SimplifyImageResult> {
  const image = await createImageBitmap(blob)
  try {
    const scale = Math.min(1, ANALYSIS_MAX_SIZE / Math.max(image.width, image.height))
    const width = Math.max(1, Math.round(image.width * scale))
    const height = Math.max(1, Math.round(image.height * scale))
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' })
    if (!context) throw new Error('无法创建图片分析画布')
    context.drawImage(image, 0, 0, width, height)
    const pixels = context.getImageData(0, 0, width, height).data
    const analysis = analyzePixels(pixels, width, height, options)
    if (format === 'regions') return toRegionJSON(analysis)
    if (format === 'json') {
      return {
        width,
        height,
        palette: analysis.palette,
        labels: Array.from(analysis.labels),
        ...(analysis.alpha ? { alpha: Array.from(analysis.alpha) } : {})
      }
    }
    const { png, plainPng } = await encodeAnalysisPng(analysis)
    if (format === 'comparison') return { png, plainPng, colorCount: analysis.palette.length, width, height }
    return png
  } finally {
    image.close()
  }
}

scope.onmessage = ({ data }) => {
  void simplify(data).then(
    result => scope.postMessage({ result }),
    error => scope.postMessage({ error: error instanceof Error ? error.message : String(error) })
  )
}
