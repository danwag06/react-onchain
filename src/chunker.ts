import type { ChunkManifest, InscribedFile } from './types.js';
import {
  DEFAULT_CHUNK_THRESHOLD,
  DEFAULT_CHUNK_SIZE,
  INDEX_HTML_PATH,
  PROGRESSIVE_VIDEO_CHUNK_SIZES,
  PROGRESSIVE_VIDEO_MAX_CHUNK_SIZE,
  VIDEO_FILE_EXTENSIONS,
} from './utils/constants.js';

/**
 * Determines if a file should be chunked based on its size
 *
 * @param fileSize - Size of the file in bytes
 * @param filePath - Path to the file (to check if it's index.html)
 * @param threshold - Size threshold in bytes (default: 4.5MB)
 * @returns true if file should be chunked
 */
export function shouldChunkFile(
  fileSize: number,
  filePath: string,
  threshold: number = DEFAULT_CHUNK_THRESHOLD
): boolean {
  // Never chunk index.html (needs script injection)
  if (
    filePath === INDEX_HTML_PATH ||
    filePath.endsWith('/index.html') ||
    filePath === 'index.html'
  ) {
    return false;
  }

  // Chunk if file exceeds threshold
  return fileSize > threshold;
}

/**
 * Checks if a file is a video file based on its extension
 *
 * @param filePath - Path to the file
 * @returns true if file is a video file
 */
function isVideoFile(filePath?: string): boolean {
  if (!filePath) return false;
  return VIDEO_FILE_EXTENSIONS.some((ext) => filePath.toLowerCase().endsWith(ext));
}

/**
 * Splits a buffer into chunks with progressive sizing for video files
 *
 * For video files, uses Fibonacci-like progression (1MB → 1MB → 2MB → 3MB → 5MB → 8MB → 10MB)
 * to enable fast playback startup while maintaining efficient streaming.
 *
 * For non-video files, uses uniform chunk size.
 *
 * @param buffer - The buffer to split
 * @param chunkSize - Maximum size of each chunk (used for non-video files)
 * @param filePath - Optional file path to detect video files
 * @returns Array of chunk buffers
 */
export function splitFileIntoChunks(
  buffer: Buffer,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
  filePath?: string
): Buffer[] {
  const chunks: Buffer[] = [];
  const useProgressiveChunking = isVideoFile(filePath);

  if (useProgressiveChunking) {
    // Progressive chunking for video files
    let offset = 0;
    let chunkIndex = 0;

    while (offset < buffer.length) {
      // Use progressive size for first N chunks, then max size for remaining
      const currentChunkSize =
        chunkIndex < PROGRESSIVE_VIDEO_CHUNK_SIZES.length
          ? PROGRESSIVE_VIDEO_CHUNK_SIZES[chunkIndex]
          : PROGRESSIVE_VIDEO_MAX_CHUNK_SIZE;

      const end = Math.min(offset + currentChunkSize, buffer.length);
      chunks.push(buffer.subarray(offset, end));

      offset = end;
      chunkIndex++;
    }
  } else {
    // Uniform chunking for non-video files
    for (let offset = 0; offset < buffer.length; offset += chunkSize) {
      const end = Math.min(offset + chunkSize, buffer.length);
      chunks.push(buffer.subarray(offset, end));
    }
  }

  return chunks;
}

/**
 * Creates a chunk manifest for client-side reassembly
 *
 * @param originalPath - Original file path
 * @param mimeType - MIME type of the file
 * @param totalSize - Total size of the complete file
 * @param chunkSize - Size of each chunk (for uniform chunking) or max chunk size (for progressive)
 * @param chunkInscriptions - Array of inscribed chunks
 * @returns Chunk manifest object
 */
export function createChunkManifest(
  originalPath: string,
  mimeType: string,
  totalSize: number,
  chunkSize: number,
  chunkInscriptions: InscribedFile[]
): ChunkManifest {
  return {
    version: '1.0',
    originalPath,
    mimeType,
    totalSize,
    chunkSize, // Note: For progressive chunking, this represents max chunk size
    chunks: chunkInscriptions.map((inscription, index) => ({
      index,
      txid: inscription.txid,
      vout: inscription.vout,
      urlPath: inscription.urlPath,
      size: inscription.size, // Actual chunk size is stored here
      hash: inscription.contentHash || '',
    })),
  };
}
