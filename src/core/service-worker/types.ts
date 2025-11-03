/**
 * Shared types for Service Worker modules
 */

/**
 * Metadata for a single chunk in the manifest
 */
export interface ChunkMetadata {
  index: number;
  txid: string;
  vout: number;
  urlPath: string;
  size: number;
}

/**
 * Chunk manifest for a chunked file
 */
export interface ChunkManifest {
  version: string;
  originalPath: string;
  mimeType: string;
  totalSize: number;
  chunkSize: number;
  chunks: ChunkMetadata[];
}

/**
 * Parsed HTTP Range request
 */
export interface ParsedRange {
  start: number;
  end: number;
  length: number;
}

/**
 * Chunk with calculated slice offsets for a range request
 */
export interface ChunkWithOffsets {
  chunk: ChunkMetadata;
  fileStart: number; // Absolute position of chunk start in full file
  fileEnd: number; // Absolute position of chunk end in full file
  sliceStart: number; // Offset within chunk where needed data starts
  sliceEnd: number; // Offset within chunk where needed data ends
}

/**
 * Configuration for stream assembly
 */
export interface StreamConfig {
  baseUrl: string;
  cacheName: string;
}
