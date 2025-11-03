/**
 * Chunking Module
 * File chunking for large files
 */

export { shouldChunkFile, splitFileIntoChunks, createChunkManifest } from './chunker.js';
export type { ChunkReference, ChunkManifest } from './chunking.types.js';
