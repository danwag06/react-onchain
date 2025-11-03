/**
 * Chunking Types
 * Types for file chunking and chunk manifest management
 */

/**
 * Reference to a single chunk in a chunked file
 */
export interface ChunkReference {
  /** Chunk sequence number (0, 1, 2, ...) */
  index: number;
  /** Transaction ID for this chunk */
  txid: string;
  /** Output index */
  vout: number;
  /** Size of this chunk in bytes */
  size: number;
}

/**
 * Manifest for a chunked file - inscribed on-chain for client-side reassembly
 */
export interface ChunkManifest {
  /** Manifest schema version */
  version: '1.0';
  /** Original file path */
  originalPath: string;
  /** MIME type of the complete file */
  mimeType: string;
  /** Total size of the complete file in bytes */
  totalSize: number;
  /** Size of each chunk (last chunk may be smaller) */
  chunkSize: number;
  /** Array of chunk references in order */
  chunks: Array<{
    /** Chunk index */
    index: number;
    /** Transaction ID */
    txid: string;
    /** Output index */
    vout: number;
    /** URL path to fetch chunk */
    urlPath: string;
    /** Size of this chunk in bytes */
    size: number;
  }>;
}
