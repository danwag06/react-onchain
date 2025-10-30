/**
 * IndexerService - Abstract base class for blockchain indexer services
 *
 * Defines the interface that all indexer implementations must follow.
 * Each implementation handles service-specific API endpoints, query parameters, and response formats.
 */

import type { UTXO, TransactionResponse, UtxoQueryOptions } from 'scrypt-ts';

// Re-export types for use by other modules
export type { UTXO, TransactionResponse, UtxoQueryOptions };

/**
 * Browser-compatible indexer configuration
 *
 * This interface allows browser scripts to dynamically construct API calls
 * for different indexer services without needing the full TypeScript class.
 */
export interface BrowserIndexerConfig {
  /** Display name of the indexer service */
  name: string;

  /** Base URL for API calls */
  baseUrl: string;

  /** Content delivery URL (where inscribed files are served from) */
  contentUrl: string;

  /** Endpoint URL constructors */
  endpoints: {
    /** Construct URL to fetch latest inscription by origin */
    fetchLatestByOrigin: (origin: string) => string;

    /** Construct URL to fetch transaction by txid */
    getTransaction: (txid: string) => string;
  };

  /**
   * Optional response parser for fetchLatestByOrigin
   * If not provided, browser will expect standard format: { txid, vout, script }
   */
  parseLatestByOrigin?: (data: any) => { txid: string; vout: number; script?: string };
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

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /**
   * Fetch the latest inscription in an origin chain
   *
   * @param origin - The origin outpoint (txid_vout)
   * @returns The latest UTXO in the chain, or null if not found/spent
   */
  abstract fetchLatestByOrigin(origin: string): Promise<UTXO | null>;

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
  abstract listUnspent(
    address: string,
    options?: UtxoQueryOptions,
    type?: 'pay' | 'ordinal'
  ): Promise<UTXO[]>;

  /**
   * Get the base URL for this indexer service
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }
}
