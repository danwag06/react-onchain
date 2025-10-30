/**
 * Versioning Inscription Handler
 *
 * Handles deployment and interaction with ordinal-based versioning inscriptions.
 * Uses inscription metadata instead of smart contracts for lightweight version tracking.
 */

import type { PrivateKey } from '@bsv/sdk';
import { createOrdinals, sendOrdinals, Utxo } from 'js-1sat-ord';
import { createIndexer } from './config.js';
import { retryWithBackoff, shouldRetryError } from './retryUtils.js';
import { IndexerService, GorillaPoolUtxo } from './services/IndexerService.js';

let _indexer: IndexerService | null = null;

function getIndexer(): IndexerService {
  if (!_indexer) {
    _indexer = createIndexer();
  }
  return _indexer;
}

export const VERSIONING_ENABLED = true;

export interface VersioningInscriptionInfo {
  outpoint: string;
  originOutpoint: string;
  appName: string;
  metadata: Record<string, any>;
}

/**
 * Structure of individual version entry (before stringification)
 */
export interface VersionEntry {
  outpoint: string;
  description: string;
  utcTimeStamp: number;
}

/**
 * Version metadata structure in inscription
 * Version keys must be prefixed with "version." and values are stringified VersionEntry objects
 * Use createVersionEntry() helper to ensure type safety when adding version entries
 */
export interface VersionMetadata {
  app: string;
  type: string;
  [key: string]: string; // Allows js-1sat-ord compatibility and dynamic indexing
}

/**
 * Helper to create a version entry (provides type safety)
 */
export function createVersionEntry(
  outpoint: string,
  description: string,
  utcTimeStamp: number = Date.now()
): string {
  const entry: VersionEntry = {
    outpoint,
    description,
    utcTimeStamp,
  };
  return JSON.stringify(entry);
}

/**
 * Helper to parse a version entry (provides type safety)
 */
export function parseVersionEntry(json: string): VersionEntry {
  return JSON.parse(json) as VersionEntry;
}

/**
 * Deploy an empty versioning inscription (becomes the origin)
 * This is deployed BEFORE the HTML so the origin can be injected into the redirect script
 * Metadata is added later by spending this inscription with updateVersioningInscription
 *
 * @param paymentKey - Private key for paying transaction fees
 * @param appName - Name of the application
 * @param destinationAddress - Address to receive the inscription
 * @param satsPerKb - Fee rate in satoshis per KB
 * @returns Inscription outpoint (txid_vout)
 */
export async function deployVersioningInscription(
  paymentKey: PrivateKey,
  appName: string,
  destinationAddress: string,
  satsPerKb?: number
): Promise<string> {
  try {
    const result = await retryWithBackoff(
      async () => {
        // Create indexer for fetching UTXOs
        const indexer = getIndexer();

        // Get payment address from key
        const paymentAddress = paymentKey.toAddress().toString();

        // Validate that destination matches payment address for versioning to work
        if (destinationAddress !== paymentAddress) {
          console.warn('\n⚠️  Warning: Destination address differs from payment key address.');
          console.warn(
            '   For versioning to work on subsequent deployments, you must use the payment key associated with the destination address.\n'
          );
          console.warn(`   Payment key address: ${paymentAddress}`);
          console.warn(`   Destination address: ${destinationAddress}\n`);
        }

        // Fetch payment UTXOs (filtering for 'pay' type to exclude ordinals)
        const paymentUtxos = await indexer.listUnspent(paymentAddress, undefined, 'pay');

        if (paymentUtxos.length === 0) {
          throw new Error(
            `No spendable UTXOs found for payment address: ${paymentAddress}. Fund this address first.`
          );
        }
        // Prepare empty metadata (just app identifier)
        const metadata: VersionMetadata = {
          app: 'react-onchain',
          type: 'version',
        };

        // Create the inscription transaction with empty content
        const ordResult = await createOrdinals({
          utxos: paymentUtxos,
          destinations: [
            {
              address: destinationAddress,
              inscription: {
                dataB64: Buffer.from(appName).toString('base64'), // Empty data
                contentType: 'text/plain',
              },
            },
          ],
          metaData: metadata,
          paymentPk: paymentKey,
          changeAddress: paymentAddress,
          satsPerKb: satsPerKb ?? 1,
        });

        // Broadcast the transaction
        const txid = await indexer.broadcastTransaction(ordResult.tx.toHex());

        // Return the inscription outpoint (txid_vout)
        return `${txid}_0`;
      },
      {
        maxAttempts: 5,
        initialDelayMs: 3000,
        maxDelayMs: 60000,
      },
      shouldRetryError
    );

    return result;
  } catch (error) {
    console.error('❌ Failed to deploy versioning inscription:', error);
    throw new Error(
      `Versioning inscription deployment failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Update an existing versioning inscription (subsequent deployments)
 * Spends the previous inscription and creates a new one with merged metadata
 *
 * @param versionInscriptionOrigin - The origin outpoint of the versioning inscription chain
 * @param paymentKey - Private key for paying transaction fees
 * @param ordPk - Private key that owns the ordinal (usually same as payment key)
 * @param version - Version string (e.g., "1.0.1")
 * @param versionOutpoint - The outpoint of the new app deployment
 * @param description - Changelog or version description
 * @param destinationAddress - Address to receive the inscription
 * @param satsPerKb - Fee rate in satoshis per KB
 * @returns New inscription outpoint
 */
export async function updateVersioningInscription(
  versionInscriptionOrigin: string,
  paymentKey: PrivateKey,
  ordPk: PrivateKey,
  version: string,
  versionOutpoint: string,
  description: string,
  destinationAddress: string,
  satsPerKb?: number
): Promise<string> {
  try {
    const result = await retryWithBackoff(
      async () => {
        // Create indexer
        const indexer = getIndexer();

        // Fetch latest inscription in origin chain
        const { utxo: latestVersionUtxo } = await indexer.fetchLatestVersionMetadata(
          versionInscriptionOrigin,
          true
        );

        if (!latestVersionUtxo) {
          throw new Error(
            `Could not find versioning inscription utxo at origin: ${versionInscriptionOrigin}`
          );
        }

        // Get payment address
        const paymentAddress = paymentKey.toAddress().toString();

        // Validate that ordPk can unlock the versioning inscription
        const ordinalAddress = ordPk.toAddress().toString();
        if (ordinalAddress !== destinationAddress) {
          throw new Error(
            `Cannot update versioning inscription: ordinal key mismatch.\n` +
              `  The versioning inscription is controlled by: ${destinationAddress}\n` +
              `  Your payment key address is: ${ordinalAddress}\n` +
              `  Solution: Use the same payment key as the original deployment.`
          );
        }

        // Fetch payment UTXOs (excluding ordinals)
        const paymentUtxos = await indexer.listUnspent(paymentAddress, undefined, 'pay');

        if (paymentUtxos.length === 0) {
          throw new Error(
            `No spendable UTXOs found for payment address: ${paymentAddress}. Fund this address first.`
          );
        }

        // Prepare new metadata (protocol will merge with existing)
        const metadata: VersionMetadata = {
          app: 'react-onchain',
          type: 'version',
          [`version.${version}`]: createVersionEntry(versionOutpoint, description),
        };

        const ordData = {
          ordinals: [
            {
              txid: latestVersionUtxo.txid || '',
              vout: latestVersionUtxo.vout || 0,
              satoshis: latestVersionUtxo.satoshis || 1,
              script: latestVersionUtxo.script || '',
            },
          ],
          destinations: [
            {
              address: destinationAddress,
            },
          ],
          metaData: metadata,
          paymentPk: paymentKey,
          ordPk: ordPk,
          paymentUtxos,
          changeAddress: paymentAddress,
          satsPerKb: satsPerKb ?? 1,
        };

        // Create transaction spending the previous inscription
        const ordResult = await sendOrdinals(ordData);

        // Broadcast transaction
        const txid = await indexer.broadcastTransaction(ordResult.tx.toHex());

        // Return new inscription outpoint (txid_vout)
        return `${txid}_0`;
      },
      {
        maxAttempts: 5,
        initialDelayMs: 3000,
        maxDelayMs: 60000,
      },
      shouldRetryError
    );

    return result;
  } catch (error) {
    console.error('❌ Failed to update versioning inscription:', error);
    throw new Error(
      `Versioning inscription update failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Check if a version already exists in the inscription metadata
 * Throws an error if the version exists to prevent wasted inscription costs
 *
 * @param versionInscriptionOrigin - The origin outpoint of the versioning inscription
 * @param version - Version string to check
 * @throws Error if version already exists
 */
export async function checkVersionExists(
  versionInscriptionOrigin: string,
  version: string
): Promise<void> {
  try {
    const indexer = getIndexer();
    const { metadata } = await indexer.fetchLatestVersionMetadata(versionInscriptionOrigin, false);

    if (!metadata) {
      throw new Error(
        `Could not find versioning inscription at origin: ${versionInscriptionOrigin}`
      );
    }

    // Check if version key exists in metadata (format: version.X.X.X)
    const versionKey = `version.${version}`;
    if (metadata[versionKey]) {
      const lastNumberInVersion = version.split('.').pop();
      const newVersion = `${version.split('.').slice(0, -1).join('.')}.${Number(lastNumberInVersion) + 1}`;
      throw new Error(
        `Version "${version}" already exists in inscription.\n` +
          `  Please use a different version tag (e.g., "${newVersion}" or increment the version number).`
      );
    }

    // Version doesn't exist - safe to proceed
  } catch (error) {
    // If error is our "version exists" error, re-throw it
    if (error instanceof Error && error.message.includes('already exists')) {
      throw error;
    }

    // Other errors (network issues, inscription not found, etc.)
    // If inscription doesn't exist yet, that's OK (first deployment)
    if (error instanceof Error && error.message.includes('No version metadata found')) {
      return; // First deployment, no metadata yet
    }

    console.error('Failed to check version existence:', error);
    throw new Error(
      `Version existence check failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Get specific version details from inscription metadata
 *
 * @param versionInscriptionOrigin - The origin outpoint of the versioning inscription
 * @param version - Version string to query
 * @returns Version details including outpoint and description
 */
export async function getVersionDetails(
  versionInscriptionOrigin: string,
  version: string
): Promise<{
  version: string;
  outpoint: string;
  description: string;
} | null> {
  try {
    const indexer = getIndexer();
    const { metadata } = await indexer.fetchLatestVersionMetadata(versionInscriptionOrigin, false);

    if (!metadata) {
      return null;
    }

    // Get version metadata (format: version.X.X.X)
    const versionKey = `version.${version}`;
    const versionData = metadata[versionKey];

    if (!versionData || typeof versionData !== 'string') {
      return null;
    }

    // Parse the stringified version entry
    const versionEntry = parseVersionEntry(versionData);

    return {
      version,
      outpoint: versionEntry.outpoint,
      description: versionEntry.description,
    };
  } catch (error) {
    console.error('Failed to get version details:', error);
    throw new Error(
      `Getting version details failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Get inscription information
 *
 * @param versionInscriptionOrigin - The origin outpoint of the versioning inscription
 * @returns Inscription information including metadata
 */
export async function getInscriptionInfo(
  versionInscriptionOrigin: string
): Promise<VersioningInscriptionInfo> {
  try {
    const indexer = getIndexer();
    const { metadata } = await indexer.fetchLatestVersionMetadata(versionInscriptionOrigin, false);

    if (!metadata) {
      throw new Error(`No metadata found for versioning inscription: ${versionInscriptionOrigin}`);
    }

    return {
      outpoint: versionInscriptionOrigin,
      originOutpoint: versionInscriptionOrigin,
      appName: metadata.app || 'react-onchain',
      metadata,
    };
  } catch (error) {
    console.error('Failed to get inscription info:', error);
    throw new Error(
      `Getting inscription info failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Get both inscription info and version history with a single metadata fetch
 * This is more efficient than calling getInscriptionInfo and getVersionHistory separately
 *
 * @param versionInscriptionOrigin - The origin outpoint of the versioning inscription
 * @returns Object containing both inscription info and version history
 */
export async function getVersionInfoAndHistory(versionInscriptionOrigin: string): Promise<{
  info: VersioningInscriptionInfo;
  history: Array<{ version: string; description: string; outpoint: string }>;
}> {
  try {
    // Fetch metadata once
    const indexer = getIndexer();
    const { metadata } = await indexer.fetchLatestVersionMetadata(versionInscriptionOrigin, false);

    if (!metadata) {
      throw new Error(`No metadata found for versioning inscription: ${versionInscriptionOrigin}`);
    }

    // Build inscription info
    const info: VersioningInscriptionInfo = {
      outpoint: versionInscriptionOrigin,
      originOutpoint: versionInscriptionOrigin,
      appName: metadata.app || 'react-onchain',
      metadata,
    };

    // Build version history
    const versionEntries: Array<{ version: string; description: string; outpoint: string }> = [];

    for (const key of Object.keys(metadata)) {
      // Skip system fields
      if (!key.startsWith('version')) {
        continue;
      }

      const version = key.replace('version.', '');
      const versionData = metadata[key];

      // Parse the stringified version entry
      if (typeof versionData === 'string') {
        const versionEntry = parseVersionEntry(versionData);
        versionEntries.push({
          version,
          outpoint: versionEntry.outpoint,
          description: versionEntry.description,
        });
      }
    }

    // Sort by version string (simple lexicographic sort)
    versionEntries.sort((a, b) => b.version.localeCompare(a.version));

    return {
      info,
      history: versionEntries,
    };
  } catch (error) {
    console.error('Failed to get version info and history:', error);
    throw new Error(
      `Getting version info and history failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
