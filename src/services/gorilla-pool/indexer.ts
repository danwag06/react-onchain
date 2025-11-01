/**
 * GorillaPoolIndexer - Indexer service implementation for GorillaPool/1Sat Ordinals API
 *
 * API Documentation: https://ordinals.1sat.app
 */
import axios from 'axios';
import { IndexerService, GorillaPoolUtxo, UtxoQueryOptions } from '../IndexerService.js';
import { GORILLA_POOL_INDEXER_URL, GORILLA_POOL_CONTENT_URL } from './constants.js';
import { P2PKH, Script, Transaction, Utils } from '@bsv/sdk';
import { VersionMetadata } from '../../versioningInscriptionHandler.js';
import { Utxo } from 'js-1sat-ord';
import { formatError } from '../../utils/errors.js';

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
   * Get version metadata from the latest inscription in the origin chain
   *
   * @param versionInscriptionOrigin - The origin outpoint of the versioning inscription
   * @param contentUrl - Optional content service URL (defaults to GORILLA_POOL_CONTENT_URL)
   * @returns Parsed metadata object with version:outpoint mappings
   */
  async fetchLatestVersionMetadata(
    versionInscriptionOrigin: string,
    includeUtxo: boolean
  ): Promise<{ metadata: VersionMetadata; utxo: Utxo | null }> {
    try {
      // Construct the URL to fetch the latest version metadata seq=-1 and map=true to get latest and metadata
      const url = `${this.contentUrl}/content/${versionInscriptionOrigin}?seq=-1&map=true&out=${includeUtxo ? 'true' : 'false'}`;

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch metadata: HTTP ${response.status}`);
      }

      // Read x-map header
      const mapHeader = response.headers.get('x-map');

      if (!mapHeader) {
        throw new Error('No version metadata found in inscription');
      }

      // Parse JSON metadata
      const metadata = JSON.parse(mapHeader) as VersionMetadata;
      const output = includeUtxo ? response.headers.get('x-output') : null;
      const outpoint = includeUtxo ? response.headers.get('x-outpoint') : null;
      const parsedOutput = output ? this.parseOutput(output) : null;

      let utxo = null;
      if (includeUtxo) {
        // Handle both underscore (txid_vout) and dot (txid.vout) notation
        const separator = outpoint?.includes('_') ? '_' : '.';
        utxo = {
          txid: outpoint?.split(separator)[0] || '',
          vout: parseInt(outpoint?.split(separator)[1] ?? '0'),
          satoshis: parsedOutput?.satoshis ?? 1,
          script: parsedOutput?.script || '',
        };
      }

      return { metadata, utxo };
    } catch (error) {
      console.error('Failed to get version metadata:', formatError(error));
      throw new Error(`Getting version metadata failed: ${formatError(error)}`);
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
    let allSpendableUtxos: Utxo[] = [];

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
