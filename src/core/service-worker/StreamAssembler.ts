/**
 * Stream Assembler Module
 * Creates ReadableStreams for progressive chunk delivery
 */

import type { ChunkWithOffsets, ChunkManifest, StreamConfig } from './types.js';
import { fetchChunk } from './ChunkFetcher.js';

/**
 * Creates a ReadableStream that progressively delivers chunk data
 * This enables zero-memory streaming without buffering the entire response
 *
 * @param chunks - Array of chunks with calculated slice offsets
 * @param config - Stream configuration
 * @returns ReadableStream that yields chunk data progressively
 */
export function createRangeStream(
  chunks: ChunkWithOffsets[],
  config: StreamConfig
): ReadableStream<Uint8Array> {
  let chunkIndex = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      // All chunks delivered
      if (chunkIndex >= chunks.length) {
        controller.close();
        return;
      }

      const chunkInfo = chunks[chunkIndex];
      chunkIndex++;

      try {
        // Fetch the chunk (from cache or network)
        const chunkBuffer = await fetchChunk(chunkInfo.chunk.urlPath, config);

        // Extract only the needed slice
        const slice = chunkBuffer.slice(chunkInfo.sliceStart, chunkInfo.sliceEnd + 1);

        // Enqueue the slice for delivery
        controller.enqueue(new Uint8Array(slice));
      } catch (error) {
        controller.error(error);
      }
    },

    cancel() {
      // Stream was aborted by the browser
      console.log('[SW] Stream cancelled');
    },
  });
}

/**
 * Creates a stream for the entire file (non-range request)
 * @param manifest - Chunk manifest for the file
 * @param config - Stream configuration
 * @returns ReadableStream that delivers the full file progressively
 */
export function createFullFileStream(
  manifest: ChunkManifest,
  config: StreamConfig
): ReadableStream<Uint8Array> {
  const sortedChunks = [...manifest.chunks].sort((a, b) => a.index - b.index);
  let chunkIndex = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (chunkIndex >= sortedChunks.length) {
        controller.close();
        return;
      }

      const chunk = sortedChunks[chunkIndex];
      chunkIndex++;

      try {
        const chunkBuffer = await fetchChunk(chunk.urlPath, config);
        controller.enqueue(new Uint8Array(chunkBuffer));
      } catch (error) {
        controller.error(error);
      }
    },

    cancel() {
      console.log('[SW] Full file stream cancelled');
    },
  });
}
