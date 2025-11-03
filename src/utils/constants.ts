/**
 * Shared constants across the application
 */

// ============================================================================
// File Names
// ============================================================================

export const MANIFEST_FILENAME = 'deployment-manifest.json';
export const INDEX_HTML = 'index.html';
export const INDEX_HTML_PATH = '/index.html';

// ============================================================================
// Inscription Types
// ============================================================================

export const VERSIONING_ORIGIN_TYPE = 'versioning-origin';
export const VERSIONING_METADATA_TYPE = 'versioning-metadata';

// ============================================================================
// URL Patterns
// ============================================================================

export const CONTENT_PATH_PREFIX = '/content/';
export const OUTPOINT_SEPARATOR = '_';

// ============================================================================
// Defaults
// ============================================================================

export const DEFAULT_SATS_PER_KB = 1;
export const DEFAULT_INSCRIPTION_VOUT = 0;
export const INSCRIPTION_DELAY_MS = 1000;
export const MANIFEST_VERSION = '1.0.0';

// ============================================================================
// Inscription-specific Constants
// ============================================================================

export const INSCRIPTION_OUTPUT_SATS = 1;
export const TX_OVERHEAD_BYTES = 500;
export const UTXO_FETCH_BUFFER_SATS = 100;
export const DRY_RUN_DELAY_MS = 100;

// ============================================================================
// UTXO Splitter Transaction Size Constants
// ============================================================================

// Approximate size of transaction components in bytes
export const TX_BASE_SIZE = 10; // Base transaction overhead
export const TX_INPUT_SIZE = 148; // Approximate size of each transaction input
export const TX_OUTPUT_SIZE = 34; // Approximate size of each transaction output

// ============================================================================
// Chunking Configuration
// ============================================================================

// Default to 5MB threshold for chunking large files
export const DEFAULT_CHUNK_THRESHOLD = 5 * 1024 * 1024; // 5MB
export const DEFAULT_CHUNK_SIZE = 10 * 1024 * 1024; // 10MB (optimal for non-video files)
export const MIN_CHUNK_SIZE = 1 * 1024 * 1024; // 1MB minimum
export const MAX_CHUNK_SIZE = 100 * 1024 * 1024; // 100MB max
export const DEFAULT_CHUNK_BATCH_SIZE = 10; // Process 10 chunks in parallel per batch
export const CHUNK_BUFFER_MULTIPLIER = 1.1; // 10% buffer

// Progressive chunking strategy for video files
// Uses Fibonacci-like progression for optimal streaming:
// - Small initial chunks (1MB) enable fast playback startup (~1 second)
// - Progressively larger chunks reduce total chunk count
// - Caps at 5MB for optimal streaming performance and memory usage
export const PROGRESSIVE_VIDEO_CHUNK_SIZES = [
  1 * 1024 * 1024, // 1MB - first chunk for instant startup
  1 * 1024 * 1024, // 1MB - second chunk for early buffering
  2 * 1024 * 1024, // 2MB
  3 * 1024 * 1024, // 3MB
  5 * 1024 * 1024, // 5MB - optimal for streaming
];

// After the progression, all remaining chunks use this size
export const PROGRESSIVE_VIDEO_MAX_CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

// Video file extensions that will use progressive chunking
export const VIDEO_FILE_EXTENSIONS = ['.mp4', '.mov', '.webm', '.avi', '.mkv', '.m4v'];

// Legacy constants (kept for backward compatibility)
export const RECOMMENDED_CHUNK_SIZE_VIDEO = 10 * 1024 * 1024; // 10MB for smooth video playback
export const OPTIMAL_CHUNK_SIZE_VIDEO = 25 * 1024 * 1024; // 25MB for best video experience
export const SMALL_CHUNK_WARNING_THRESHOLD = 10 * 1024 * 1024; // Warn if video chunks < 10MB

// ============================================================================
// Retry Configuration
// ============================================================================

export const RETRY_MAX_ATTEMPTS = 5;
export const RETRY_INITIAL_DELAY_MS = 2000;
export const RETRY_MAX_DELAY_MS = 30000;

// ============================================================================
// Static Utility Scripts (Permanent Inscriptions)
// ============================================================================

/**
 * Webpack Public Path Fix Script
 * Sets __webpack_public_path__ to empty string before webpack bundles load
 * This prevents webpack from breaking inscription URL concatenation
 * Includes attribution log and debug mode support
 */
export const STATIC_WEBPACK_FIX_OUTPOINT =
  '250b354d57c6d1fe7ed955e0afba9bbc6bc78521271d41090f3449668b2cdd09_0';

/**
 * Base Path Fix Script
 * Detects content provider deployment paths and sets up <base> tag
 * Configures window.__REACT_ONCHAIN_BASE__ for React Router
 * Includes debug mode support
 */
export const STATIC_BASE_PATH_FIX_OUTPOINT =
  '3a8b559790a25684e5c5e61da34522710925b595aff0fb7f42e3ab3637b2b429_0';

// ============================================================================
// Mock Values (for dry-run mode)
// ============================================================================

export const MOCK_VERSIONING_TXID =
  'c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0';
