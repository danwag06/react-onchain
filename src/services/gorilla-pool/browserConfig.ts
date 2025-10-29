import { BrowserIndexerConfig } from '../IndexerService.js';
import { GORILLA_POOL_CONTENT_URL, GORILLA_POOL_INDEXER_URL } from './constants.js';

/**
 * Browser-compatible configuration for GorillaPool indexer
 *
 * This config can be serialized and used in browser scripts to construct
 * API calls dynamically without needing the full IndexerService class.
 */
export const GorillaPoolBrowserConfig: BrowserIndexerConfig = {
  name: 'GorillaPool',
  baseUrl: GORILLA_POOL_INDEXER_URL,
  contentUrl: GORILLA_POOL_CONTENT_URL,
  endpoints: {
    fetchLatestByOrigin: (origin: string) => `/inscriptions/${origin}/latest?script=true`,
    getTransaction: (txid: string) => `/tx/${txid}/raw`,
  },
  // Response parser for fetchLatestByOrigin
  // GorillaPool returns { txid, vout, script (base64), spend }
  parseLatestByOrigin: (data: any) => ({
    txid: data.txid,
    vout: data.vout,
    // Script is base64 encoded, but browser might need hex
    script: data.script, // Keep as base64, browser can decode if needed
  }),
};
