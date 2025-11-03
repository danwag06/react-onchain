/**
 * Inscription Types
 * Types for inscribed files and on-chain references
 */

import type { ChunkReference } from '../chunking/chunking.types.js';

/**
 * Inscribed file with its on-chain reference
 */
export interface InscribedFile {
  /** Original file path */
  originalPath: string;
  /** Transaction ID */
  txid: string;
  /** Output index */
  vout: number;
  /** URL path for the inscription (e.g., "/content/txid_vout") */
  urlPath: string;
  /** File size in bytes (total size for chunked files) */
  size: number;
  /** SHA256 hash of original file content (before rewriting) - optional for backward compatibility */
  contentHash?: string;
  /** Hash of dependency URLs (for cache invalidation when dependencies change) */
  dependencyHash?: string;
  /** Whether this file was reused from cache (not newly inscribed) */
  cached?: boolean;
  /** Whether this file was chunked during inscription */
  isChunked?: boolean;
  /** Number of chunks (only present if isChunked is true) */
  chunkCount?: number;
  /** Array of chunk references (only present if isChunked is true) */
  chunks?: ChunkReference[];
}
