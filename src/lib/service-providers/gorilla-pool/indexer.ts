/**
 * GorillaPoolIndexer - Indexer service implementation for GorillaPool/1Sat Ordinals API
 *
 * API Documentation: https://ordinals.1sat.app
 */
import axios from 'axios';
import { IndexerService, GorillaPoolUtxo, UtxoQueryOptions } from '../IndexerService.js';
import { GORILLA_POOL_INDEXER_URL, GORILLA_POOL_CONTENT_URL } from './constants.js';
import { Utils } from '@bsv/sdk';
import { VersionMetadata } from '../../../core/versioning/index.js';
import { Utxo } from 'js-1sat-ord';
import { formatError } from '../../../utils/errors.js';

/**
 * IndexerService implementation for GorillaPool/1Sat Ordinals API
 */
export class GorillaPoolIndexer extends IndexerService {
  constructor(
    baseUrl: string = GORILLA_POOL_INDEXER_URL,
    contentUrl: string = GORILLA_POOL_CONTENT_URL
  ) {
    super(baseUrl, contentUrl);
  }

  private parseOutput(output: string) {
    const outputBin = Utils.toArray(output, 'base64');
    const br = new Utils.Reader(outputBin);

    const satoshis = br.readUInt64LEBn().toNumber();
    const scriptLength = br.readVarIntNum();
    const scriptBin = br.read(scriptLength);
    return {
      satoshis,
      script: Utils.toBase64(scriptBin),
    };
  }

  /**
   * Fetch the output of an origin
   * @param origin - The origin outpoint (txid_vout)
   * @returns The output of the origin in base64
   */
  private async fetchOutput(origin: string): Promise<string> {
    const txid = origin.split('_')[0];
    const vout = origin.split('_')[1];
    const url = `${this.contentUrl}/v2/tx/${txid}/${vout}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch from origin: HTTP ${response.status}`);
    }
    const body = await response.arrayBuffer();
    const bodyBase64 = Buffer.from(new Uint8Array(body)).toString('base64');
    return bodyBase64;
  }

  /**
   * Fetch the latest inscription in an origin chain using :-1 resolution
   * Generic method that works for any origin chain (versioning, HTML, etc.)
   *
   * @param origin - The origin outpoint (txid_vout)
   * @param options - Fetch options
   * @param options.includeUtxo - Whether to fetch UTXO details (for spending in next deployment)
   * @param options.includeMap - Whether to fetch metadata from x-map header
   * @returns The latest inscription details
   */
  async fetchLatestFromOrigin(
    origin: string,
    options: { includeUtxo: boolean; includeMap: boolean }
  ): Promise<{ metadata: VersionMetadata | null; utxo: Utxo | null }> {
    try {
      // Build query params based on options
      const params = new URLSearchParams();
      if (options.includeMap) {
        params.append('map', 'true');
      }

      const url = `${this.contentUrl}/content/${origin}:-1?${params.toString()}`;
      const response = await fetch(url, { method: 'HEAD' });

      if (!response.ok) {
        throw new Error(`Failed to fetch from origin: HTTP ${response.status}`);
      }

      // Parse metadata if requested
      let metadata: VersionMetadata | null = null;
      if (options.includeMap) {
        const mapHeader = response.headers.get('x-map');
        if (!mapHeader) {
          throw new Error('No metadata found in inscription');
        }
        metadata = JSON.parse(mapHeader) as VersionMetadata;
      }

      // Parse UTXO if requested
      let utxo: Utxo | null = null;
      if (options.includeUtxo) {
        const outpoint = response.headers.get('x-outpoint');
        if (!outpoint) {
          throw new Error('No x-outpoint header found');
        }
        const output = await this.fetchOutput(outpoint);
        const parsedOutput = output ? this.parseOutput(output) : null;

        if (outpoint && parsedOutput) {
          // Handle both underscore (txid_vout) and dot (txid.vout) notation
          const separator = outpoint.includes('_') ? '_' : '.';
          utxo = {
            txid: outpoint.split(separator)[0] || '',
            vout: parseInt(outpoint.split(separator)[1] ?? '0'),
            satoshis: parsedOutput.satoshis ?? 1,
            script: parsedOutput.script || '',
          };
        }
      }

      return { metadata, utxo };
    } catch (error) {
      console.error('Failed to fetch from origin:', formatError(error));
      throw new Error(`Fetching from origin failed: ${formatError(error)}`);
    }
  }

  /**
   * Broadcast a raw transaction
   * Endpoint: POST /tx
   */
  async broadcastTransaction(rawTxHex: string): Promise<string> {
    const url = `${this.baseUrl}/v5/tx`;

    try {
      const response = await axios.post(url, rawTxHex, {
        headers: {
          'Content-Type': 'text/plain',
        },
      });

      if (response.status !== 200) {
        throw new Error(`Broadcast failed with status: ${response.status}`);
      }

      return response.data.txid;
    } catch (error) {
      console.error('  ❌ Broadcast error details:');
      if (axios.isAxiosError(error)) {
        console.error('  Status:', error.response?.status);
        console.error('  Status text:', error.response?.statusText);
        console.error('  Response data:', error.response?.data);
        console.error('  Response headers:', error.response?.headers);
      }
      console.error('  Error:', formatError(error));
      throw new Error(`Broadcast failed: ${formatError(error)}`);
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
  async listUnspent(address: string, options?: UtxoQueryOptions): Promise<Utxo[]> {
    const limit = 100; // GorillaPool API pagination limit
    let from = 0;
    const allSpendableUtxos: Utxo[] = [];

    // Calculate required satoshis if options provided
    let requiredSats = 0;
    if (options) {
      const { unspentValue, estimateSize, feePerKb, additional = 0 } = options;
      const estimatedFee = Math.ceil((estimateSize / 1000) * feePerKb);
      requiredSats = unspentValue + estimatedFee + additional;
    }

    // Fetch UTXOs in batches until we have enough or no more are available
    while (true) {
      const url = `${this.baseUrl}/v5/evt/p2pkh/own/${address}?unspent=true&txo=true&script=true&from=${from}&limit=${limit}`;
      const response = await axios.get(url);
      const utxo = response.data as GorillaPoolUtxo[];

      // If no results, we've fetched all available UTXOs
      if (!utxo || utxo.length === 0) {
        break;
      }

      // Convert to UTXO format
      const batchUtxos = utxo.map((u: GorillaPoolUtxo) => ({
        txid: u.outpoint.split('_')[0],
        vout: parseInt(u.outpoint.split('_')[1]),
        satoshis: u.satoshis,
        script: u.script,
      })) as Utxo[];

      // Filter based on type parameter
      const filteredBatch = batchUtxos.filter((u: Utxo) => u.satoshis > 1);
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
            const selectedUtxos: Utxo[] = [];
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
      if (utxo.length < limit) {
        break;
      }

      // Move to next page
      from = utxo[utxo.length - 1].score;
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
