/**
 * IndexerService - Abstract base class for blockchain indexer services
 *
 * Defines the interface that all indexer implementations must follow.
 * Each implementation handles service-specific API endpoints, query parameters, and response formats.
 */

import { Utxo } from 'js-1sat-ord';
import { VersionMetadata } from '../versioningInscriptionHandler.js';

export type GorillaPoolUtxo = {
  outpoint: string;
  height: number;
  idx: number;
  satoshis: number;
  script: string;
  owners: string[];
  data: Record<string, any>;
  score: number;
};

export type UtxoQueryOptions = {
  unspentValue: number;
  estimateSize: number;
  feePerKb: number;
  additional: number;
};

/**
 * Browser-compatible indexer configuration
 *
 * Provides basic indexer information for use in browser contexts.
 * The browser typically uses the content URL to fetch inscriptions directly.
 */
export interface BrowserIndexerConfig {
  /** Display name of the indexer service */
  name: string;

  /** Base URL for API calls */
  baseUrl: string;

  /** Content delivery URL (where inscribed files are served from) */
  contentUrl: string;
}

/**
 * Abstract base class for indexer services
 *
 * Implementations must provide:
 * - Endpoint-specific URL construction
 * - Request formatting (query params, headers, etc.)
 * - Response parsing and normalization
 */
export abstract class IndexerService {
  protected baseUrl: string;
  protected contentUrl: string;

  constructor(baseUrl: string, contentUrl: string) {
    this.baseUrl = baseUrl;
    this.contentUrl = contentUrl;
  }

  /**
   * Fetch the latest inscription in an origin chain using standard content delivery endpoint
   * Uses /content/<origin>?seq=-1 pattern which works across all ordinals service providers
   *
   * @param origin - The origin outpoint (txid_vout)
   * @returns The latest version metadata, or null if not found/spent
   */
  abstract fetchLatestVersionMetadata(
    origin: string,
    includeUtxo: boolean
  ): Promise<{ metadata: VersionMetadata; utxo: Utxo | null }>;

  /**
   * Broadcast a raw transaction to the network
   *
   * @param rawTxHex - Raw transaction in hex format
   * @returns Transaction ID of the broadcast transaction
   */
  abstract broadcastTransaction(rawTxHex: string): Promise<string>;

  /**
   * List unspent transaction outputs for an address
   *
   * @param address - Bitcoin address
   * @param options - Query options (optional)
   * @param type - Filter by UTXO type: 'pay' (>1 sat), 'ordinal' (1 sat), or undefined (all)
   * @returns Array of unspent UTXOs
   */
  abstract listUnspent(address: string, options?: UtxoQueryOptions): Promise<Utxo[]>;

  /**
   * Get the base URL for this indexer service
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }
}
