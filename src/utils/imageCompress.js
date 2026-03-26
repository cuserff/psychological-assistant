/**
 * 使用 Canvas 将图片压成 JPEG data URL，控制边长与体积（便于塞进对话请求）
 */

const DEFAULT_MAX_EDGE = 1280
const DEFAULT_QUALITY = 0.82
const DEFAULT_MAX_DATA_URL_LENGTH = 480_000

/**
 * @param {File} file
 * @param {Object} [options]
 * @param {number} [options.maxEdge]
 * @param {number} [options.quality]
 * @param {number} [options.maxDataUrlLength]
 * @returns {Promise<string>}
 */
export function compressImageFileToDataUrl(file, options = {}) {
  const maxEdge = options.maxEdge ?? DEFAULT_MAX_EDGE
  const maxDataUrlLength = options.maxDataUrlLength ?? DEFAULT_MAX_DATA_URL_LENGTH

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const imageElement = new Image()

    imageElement.onload = () => {
      URL.revokeObjectURL(objectUrl)
      try {
        let drawWidth = imageElement.naturalWidth
        let drawHeight = imageElement.naturalHeight
        const longest = Math.max(drawWidth, drawHeight)
        const scale = longest > maxEdge ? maxEdge / longest : 1
        drawWidth = Math.max(1, Math.round(drawWidth * scale))
        drawHeight = Math.max(1, Math.round(drawHeight * scale))

        const canvas = document.createElement('canvas')
        canvas.width = drawWidth
        canvas.height = drawHeight
        const context = canvas.getContext('2d')
        if (!context) {
          reject(new Error('无法创建画布上下文'))
          return
        }
        context.drawImage(imageElement, 0, 0, drawWidth, drawHeight)

        let currentQuality = options.quality ?? DEFAULT_QUALITY
        let dataUrl = canvas.toDataURL('image/jpeg', currentQuality)
        while (dataUrl.length > maxDataUrlLength && currentQuality > 0.38) {
          currentQuality -= 0.08
          dataUrl = canvas.toDataURL('image/jpeg', currentQuality)
        }
        resolve(dataUrl)
      } catch (error) {
        reject(error)
      }
    }

    imageElement.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('图片加载失败'))
    }

    imageElement.src = objectUrl
  })
}

const DEFAULT_MAX_BLOB_BYTES = 750_000

/**
 * 压缩为 JPEG Blob，便于 FormData 上传（比 data URL 更省内存）
 * @param {File} file
 * @param {Object} [options]
 * @returns {Promise<Blob>}
 */
export function compressImageFileToBlob(file, options = {}) {
  const maxEdge = options.maxEdge ?? DEFAULT_MAX_EDGE
  const maxBlobBytes = options.maxBlobBytes ?? DEFAULT_MAX_BLOB_BYTES

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const imageElement = new Image()

    imageElement.onload = () => {
      URL.revokeObjectURL(objectUrl)
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {number} quality
     */
      function canvasToJpegBlob(canvas, quality) {
        return new Promise((resolveBlob, rejectBlob) => {
          canvas.toBlob(
            (blob) => {
              if (blob) resolveBlob(blob)
              else rejectBlob(new Error('无法导出图片'))
            },
            'image/jpeg',
            quality
          )
        })
      }

      void (async () => {
        try {
          let drawWidth = imageElement.naturalWidth
          let drawHeight = imageElement.naturalHeight
          const longest = Math.max(drawWidth, drawHeight)
          const scale = longest > maxEdge ? maxEdge / longest : 1
          drawWidth = Math.max(1, Math.round(drawWidth * scale))
          drawHeight = Math.max(1, Math.round(drawHeight * scale))

          const canvas = document.createElement('canvas')
          canvas.width = drawWidth
          canvas.height = drawHeight
          const context = canvas.getContext('2d')
          if (!context) {
            reject(new Error('无法创建画布上下文'))
            return
          }
          context.drawImage(imageElement, 0, 0, drawWidth, drawHeight)

          let currentQuality = options.quality ?? DEFAULT_QUALITY
          let blob = await canvasToJpegBlob(canvas, currentQuality)
          while (blob.size > maxBlobBytes && currentQuality > 0.38) {
            currentQuality -= 0.08
            blob = await canvasToJpegBlob(canvas, currentQuality)
          }
          resolve(blob)
        } catch (error) {
          reject(error)
        }
      })()
    }

    imageElement.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('图片加载失败'))
    }

    imageElement.src = objectUrl
  })
}
