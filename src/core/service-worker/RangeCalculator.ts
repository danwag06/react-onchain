/**
 * Range Calculator Module
 * Handles HTTP Range header parsing and chunk offset calculations
 */

import type { ParsedRange, ChunkWithOffsets, ChunkManifest } from './types.js';

/**
 * Parses an HTTP Range header
 * @param rangeHeader - Range header value (e.g., "bytes=0-1023")
 * @param totalSize - Total size of the file
 * @returns Parsed range with start, end, and length
 */
export function parseRangeHeader(rangeHeader: string, totalSize: number): ParsedRange | null {
  const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
  if (!match) {
    return null;
  }

  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : totalSize - 1;
  const length = end - start + 1;

  // Validate range
  if (start < 0 || end >= totalSize || start > end) {
    return null;
  }

  return { start, end, length };
}

/**
 * Determines which chunks are needed for a given byte range
 * @param manifest - Chunk manifest for the file
 * @param start - Start byte position
 * @param end - End byte position
 * @returns Array of chunks with calculated slice offsets
 */
export function getChunksForRange(
  manifest: ChunkManifest,
  start: number,
  end: number
): ChunkWithOffsets[] {
  const needed: ChunkWithOffsets[] = [];
  let currentOffset = 0;

  // Sort chunks by index to ensure correct order
  const sortedChunks = [...manifest.chunks].sort((a, b) => a.index - b.index);

  for (const chunk of sortedChunks) {
    const chunkStart = currentOffset;
    const chunkEnd = currentOffset + chunk.size - 1;

    // Check if this chunk overlaps with the requested range
    if (chunkEnd >= start && chunkStart <= end) {
      needed.push({
        chunk,
        fileStart: chunkStart,
        fileEnd: chunkEnd,
        sliceStart: Math.max(start - chunkStart, 0),
        sliceEnd: Math.min(end - chunkStart, chunk.size - 1),
      });
    }

    currentOffset += chunk.size;

    // Early exit if we've passed the end of the requested range
    if (currentOffset > end) {
      break;
    }
  }

  return needed;
}

/**
 * Calculates total bytes that will be extracted from chunks
 * Useful for validating range responses
 */
export function calculateExtractedSize(chunks: ChunkWithOffsets[]): number {
  return chunks.reduce((total, c) => {
    return total + (c.sliceEnd - c.sliceStart + 1);
  }, 0);
}
