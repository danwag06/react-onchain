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
// Retry Configuration
// ============================================================================

export const RETRY_MAX_ATTEMPTS = 5;
export const RETRY_INITIAL_DELAY_MS = 2000;
export const RETRY_MAX_DELAY_MS = 30000;

// ============================================================================
// Mock Values (for dry-run mode)
// ============================================================================

export const MOCK_VERSIONING_TXID =
  'c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0';
