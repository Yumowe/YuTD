import type { ImageCropInfo } from './ImageCropper.vue'

export type CropImageRequest = ImageCropInfo & { src: string }
export type CropImageReply = { blob: Blob } | { error: string }

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<CropImageRequest>) => void
  postMessage: (reply: CropImageReply) => void
}

async function cropImage({ src, x, y, width, height }: CropImageRequest): Promise<Blob> {
  const response = await fetch(src)
  if (!response.ok) throw new Error('无法读取待裁剪图片')
  const image = await createImageBitmap(await response.blob())
  try {
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建裁剪画布')
    context.drawImage(image, x, y, width, height, 0, 0, width, height)
    return await canvas.convertToBlob({ type: 'image/png' })
  } finally {
    image.close()
  }
}

scope.onmessage = ({ data }) => {
  void cropImage(data).then(
    blob => scope.postMessage({ blob }),
    error => scope.postMessage({ error: error instanceof Error ? error.message : String(error) })
  )
}
