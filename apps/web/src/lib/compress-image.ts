/** Menu photos are WebP, at most 1280 px on the long side and 200 KB (Phase 3 acceptance). */
export const MAX_PHOTO_EDGE = 1280;
export const MAX_PHOTO_BYTES = 204_800;

/** Scale that fits `width × height` inside `maxEdge` without enlarging. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Resizes and re-encodes a photo to WebP in the browser, lowering quality (then size) until it is
 * at most 200 KB, so budget phones upload small files and the bucket limit is never hit.
 */
export async function compressToWebp(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    let edge = MAX_PHOTO_EDGE;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const { width, height } = fitWithin(bitmap.width, bitmap.height, edge);
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is not available");
      context.drawImage(bitmap, 0, 0, width, height);
      for (const quality of [0.82, 0.7, 0.58]) {
        const blob = await canvas.convertToBlob({ type: "image/webp", quality });
        if (blob.type === "image/webp" && blob.size <= MAX_PHOTO_BYTES) return blob;
      }
      edge = Math.round(edge * 0.75);
    }
  } finally {
    bitmap.close();
  }
  throw new Error("The photo is too large even after compressing.");
}
