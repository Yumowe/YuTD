import type { AnaOptions, Color, ColorRegion } from './types'
import type { SimplifyImageReply, SimplifyImageRequest, SimplifyImageResult } from './simplify.worker'

export { analyzePixels, defaultAnalysisOptions, getLineProtectionMask } from './ana'
export { toOklab } from './math'
export { regionJSONToPixels, toRegionJSON } from './render'
export type { AnaOptions, Color, ColorAnalysis, ColorRegion } from './types'

export interface SimplifiedImageData {
  width: number
  height: number
  palette: [number, number, number][]
  labels: number[]
  /** 逐像素透明度，0~255；省略时全部不透明。 */
  alpha?: number[]
}

export interface SimplifiedImageRegions {
  version: 1
  width: number
  height: number
  colors: {
    color: Color
    regions: Omit<ColorRegion, 'label' | 'area'>[]
  }[]
}

export interface SimplifiedImageComparison {
  png: Blob
  plainPng: Blob
  colorCount: number
  width: number
  height: number
}

export function simplifyImage(blob: Blob, format: 'comparison', options?: AnaOptions): Promise<SimplifiedImageComparison>
export function simplifyImage(blob: Blob, format: 'regions', options?: AnaOptions): Promise<SimplifiedImageRegions>
export function simplifyImage(blob: Blob, format: 'json', options?: AnaOptions): Promise<SimplifiedImageData>
export function simplifyImage(blob: Blob, format?: 'png', options?: AnaOptions): Promise<Blob>
export async function simplifyImage(blob: Blob, format: 'json' | 'png' | 'comparison' | 'regions' = 'png', options?: AnaOptions): Promise<SimplifiedImageData | SimplifiedImageComparison | SimplifiedImageRegions | Blob> {
  return new Promise<SimplifyImageResult>((resolve, reject) => {
    const worker = new Worker(new URL('./simplify.worker.ts', import.meta.url), { type: 'module' })
    const fail = (error: unknown) => {
      worker.terminate()
      reject(error)
    }
    worker.onmessage = ({ data }: MessageEvent<SimplifyImageReply>) => {
      worker.terminate()
      if ('error' in data) reject(new Error(data.error))
      else resolve(data.result)
    }
    worker.onerror = (event) => {
      event.preventDefault()
      fail(new Error(event.message || '图片简化线程运行失败'))
    }
    worker.onmessageerror = () => fail(new Error('无法读取图片简化结果'))
    try {
      worker.postMessage({ blob, format, options: options ? { ...options } : undefined } satisfies SimplifyImageRequest)
    } catch (error) {
      fail(error)
    }
  })
}
