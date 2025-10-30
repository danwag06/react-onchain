/**
 * GorillaPoolIndexer - Indexer service implementation for GorillaPool/1Sat Ordinals API
 *
 * API Documentation: https://ordinals.1sat.app
 */

import type { UTXO, TransactionResponse, UtxoQueryOptions } from 'scrypt-ts';
import superagent from 'superagent';
import { IndexerService } from '../IndexerService.js';
import { GORILLA_POOL_INDEXER_URL } from './constants.js';
import { GorillaPoolUTXO } from './types.js';
import { P2PKH, Transaction, Utils } from '@bsv/sdk';
import { bsv } from 'scrypt-ts';

/**
 * IndexerService implementation for GorillaPool/1Sat Ordinals API
 */
export class GorillaPoolIndexer extends IndexerService {
  constructor(baseUrl: string = GORILLA_POOL_INDEXER_URL) {
    super(baseUrl);
  }

  /**
   * Fetch the latest inscription in an origin chain
   * Endpoint: GET /inscriptions/{origin}/latest?script=true
   */
  async fetchLatestByOrigin(origin: string): Promise<UTXO | null> {
    const url = `${this.baseUrl}/inscriptions/${origin}/latest?script=true`;

    try {
      const response = await superagent.get(url);
      const { spend, txid, vout, script } = response.body;

      // If the inscription is spent, it's no longer the latest
      if (spend) {
        return null;
      }

      return {
        txId: txid,
        outputIndex: vout,
        satoshis: 1,
        script: Buffer.from(script, 'base64').toString('hex'),
      };
    } catch (error) {
      // Handle 404 or other errors
      console.error(`Failed to fetch latest by origin ${origin}:`, error);
      return null;
    }
  }

  /**
   * Broadcast a raw transaction
   * Endpoint: POST /tx
   */
  async broadcastTransaction(rawTxHex: string): Promise<string> {
    const url = `${this.baseUrl}/tx`;

    try {
      const response = await superagent.post(url).send({
        rawtx: Buffer.from(rawTxHex, 'hex').toString('base64'),
      });

      if (response.status !== 200) {
        throw new Error(`Broadcast failed with status: ${response.status}`);
      }

      return response.body;
    } catch (error: any) {
      // Log detailed error information
      console.error('Broadcast transaction failed:');
      console.error('  URL:', url);
      console.error('  Status:', error.status);
      console.error('  Response:', error.response?.text || error.response?.body);
      console.error('  Error:', error.message);

      throw new Error(
        `Broadcast failed: ${error.status} - ${error.response?.text || error.message}`
      );
    }
  }

  /**
   * List unspent UTXOs for an address
   * Endpoint: GET /api/txos/address/{address}/unspent
   *
   * If UtxoQueryOptions are provided, returns enough UTXOs to satisfy funding requirements.
   * Otherwise returns all available UTXOs.
   *
   * Uses pagination to fetch all available UTXOs across multiple API calls if needed.
   *
   * @param address - Bitcoin address
   * @param options - Query options (optional)
   * @param type - Filter by UTXO type: 'pay' (>1 sat), 'ordinal' (1 sat), or undefined (all)
   */
  async listUnspent(
    address: string,
    options?: UtxoQueryOptions,
    type?: 'pay' | 'ordinal'
  ): Promise<UTXO[]> {
    const limit = 100; // GorillaPool API pagination limit
    let offset = 0;
    let allSpendableUtxos: UTXO[] = [];

    // Derive P2PKH locking script from address
    const lockingScript = new P2PKH().lock(Utils.fromBase58Check(address).data).toHex();

    // Calculate required satoshis if options provided
    let requiredSats = 0;
    if (options) {
      const { unspentValue, estimateSize, feePerKb, additional = 0 } = options;
      const estimatedFee = Math.ceil((estimateSize / 1000) * feePerKb);
      requiredSats = unspentValue + estimatedFee + additional;
    }

    // Fetch UTXOs in batches until we have enough or no more are available
    while (true) {
      const url = `${this.baseUrl}/txos/address/${address}/unspent?limit=${limit}&offset=${offset}&bsv20=false&origins=false&refresh=false`;
      const response = await superagent.get(url);

      // If no results, we've fetched all available UTXOs
      if (!response.body || response.body.length === 0) {
        break;
      }

      // Convert to UTXO format
      const batchUtxos = response.body.map(
        (u: GorillaPoolUTXO): UTXO => ({
          address: address,
          txId: u.txid,
          outputIndex: u.vout,
          script: lockingScript,
          satoshis: u.satoshis,
        })
      ) as UTXO[];

      // Filter based on type parameter
      let filteredBatch: UTXO[];
      if (type === 'pay') {
        // Payment UTXOs: filter for >1 sat (exclude ordinal inscriptions)
        filteredBatch = batchUtxos.filter((u: UTXO) => u.satoshis > 1);
      } else if (type === 'ordinal') {
        // Ordinal UTXOs: filter for exactly 1 sat (inscriptions)
        filteredBatch = batchUtxos.filter((u: UTXO) => u.satoshis === 1);
      } else {
        // No filter: return all UTXOs
        filteredBatch = batchUtxos;
      }
      allSpendableUtxos.push(...filteredBatch);

      // If options provided, check if we have enough funds
      if (options) {
        // Sort by size (largest first for efficiency)
        const sortedUtxos = allSpendableUtxos.sort((a, b) => b.satoshis - a.satoshis);

        // Calculate accumulated satoshis
        let accumulatedSats = 0;
        for (const utxo of sortedUtxos) {
          accumulatedSats += utxo.satoshis;
          if (accumulatedSats >= requiredSats) {
            // We have enough funds, return selected UTXOs
            const selectedUtxos: UTXO[] = [];
            let selectedSats = 0;
            for (const u of sortedUtxos) {
              selectedUtxos.push(u);
              selectedSats += u.satoshis;
              if (selectedSats >= requiredSats) {
                return selectedUtxos;
              }
            }
          }
        }
      }

      // If response had fewer results than limit, we've reached the end
      if (response.body.length < limit) {
        break;
      }

      // Move to next page
      offset += limit;
    }

    // If no options provided, return all spendable UTXOs
    if (!options) {
      return allSpendableUtxos;
    }

    // If we reached here with options, we don't have enough funds
    const totalAvailable = allSpendableUtxos.reduce((sum, u) => sum + u.satoshis, 0);
    throw new Error(
      `Insufficient funds: need ${requiredSats} sats, but only ${totalAvailable} available across ${allSpendableUtxos.length} UTXOs`
    );
  }
}
