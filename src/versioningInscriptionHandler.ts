/**
 * Versioning Inscription Handler
 *
 * Handles deployment and interaction with ordinal-based versioning inscriptions.
 * Uses inscription metadata instead of smart contracts for lightweight version tracking.
 */

import type { PrivateKey } from '@bsv/sdk';
import { createOrdinals, sendOrdinals } from 'js-1sat-ord';
import { createIndexer } from './config.js';
import { retryWithBackoff, shouldRetryError } from './retryUtils.js';
import { GORILLA_POOL_CONTENT_URL } from './services/gorilla-pool/constants.js';

export const VERSIONING_ENABLED = true;

export interface VersioningInscriptionInfo {
  outpoint: string;
  originOutpoint: string;
  appName: string;
  metadata: Record<string, any>;
}

/**
 * Version metadata structure in inscription
 */
export interface VersionMetadata {
  app: string;
  type: string;
  [key: string]: string | number; // Dynamic version keys: version -> outpoint, version_description -> string
}

/**
 * Deploy a new versioning inscription (first deployment only)
 *
 * @param paymentKey - Private key for paying transaction fees
 * @param originOutpoint - The outpoint of the initial app deployment (entry point)
 * @param appName - Name of the application
 * @param initialVersion - Initial version to set (e.g., "1.0.0")
 * @param initialDescription - Description for initial version
 * @param destinationAddress - Address to receive the inscription
 * @param satsPerKb - Fee rate in satoshis per KB
 * @returns Inscription outpoint (txid_vout)
 */
export async function deployVersioningInscription(
  paymentKey: PrivateKey,
  originOutpoint: string,
  appName: string,
  initialVersion: string,
  initialDescription: string,
  destinationAddress: string,
  satsPerKb?: number
): Promise<string> {
  try {
    // Wrap deployment in retry logic
    const result = await retryWithBackoff(
      async () => {
        // Create indexer for fetching UTXOs
        const indexer = createIndexer();

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

        // Convert UTXOs to js-1sat-ord format
        const formattedUtxos = paymentUtxos.map((utxo) => ({
          txid: utxo.txId,
          vout: utxo.outputIndex,
          satoshis: utxo.satoshis,
          script: Buffer.from(utxo.script, 'hex').toString('base64'),
        }));

        // Prepare inscription metadata
        const metadata: VersionMetadata = {
          app: 'react-onchain',
          type: 'version',
          [`version.${initialVersion}`]: JSON.stringify({
            outpoint: originOutpoint,
            description: initialDescription,
            utcTimeStamp: Date.now(),
          }),
        };

        // Minimal content for versioning inscription (metadata is stored in x-map header)
        const versionManifestContent = JSON.stringify({
          type: 'react-onchain-version-manifest',
          app: appName,
        });
        const dataB64 = Buffer.from(versionManifestContent).toString('base64');

        // Create inscription transaction
        const ordResult = await createOrdinals({
          utxos: formattedUtxos,
          destinations: [
            {
              address: destinationAddress,
              inscription: {
                dataB64,
                contentType: 'application/json',
              },
            },
          ],
          metaData: metadata,
          paymentPk: paymentKey,
          changeAddress: paymentAddress,
          satsPerKb: satsPerKb ?? 1,
        });

        // Broadcast transaction
        const txid = await indexer.broadcastTransaction(ordResult.tx.toHex());

        // Return inscription outpoint (always vout 0 for first output)
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
        const indexer = createIndexer();

        // Fetch latest inscription in origin chain
        const latestInscription = await indexer.fetchLatestByOrigin(versionInscriptionOrigin);

        if (!latestInscription) {
          throw new Error(
            `Could not find versioning inscription at origin: ${versionInscriptionOrigin}`
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

        // Convert payment UTXOs to js-1sat-ord format
        const formattedUtxos = paymentUtxos.map((utxo) => ({
          txid: utxo.txId,
          vout: utxo.outputIndex,
          satoshis: utxo.satoshis,
          script: Buffer.from(utxo.script, 'hex').toString('base64'),
        }));

        // Prepare new metadata (protocol will merge with existing)
        const metadata: VersionMetadata = {
          app: 'react-onchain',
          type: 'version',
          [`version.${version}`]: JSON.stringify({
            outpoint: versionOutpoint,
            description: description,
            utcTimeStamp: Date.now(),
          }),
        };

        // Create transaction spending the previous inscription
        const ordResult = await sendOrdinals({
          // Spend the latest inscription in the origin chain
          ordinals: [
            {
              txid: latestInscription.txId,
              vout: latestInscription.outputIndex,
              satoshis: 1,
              script: latestInscription.script
                ? Buffer.from(latestInscription.script, 'hex').toString('base64')
                : '',
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
          paymentUtxos: formattedUtxos,
          changeAddress: paymentAddress,
          satsPerKb: satsPerKb ?? 1,
        });

        // Broadcast transaction
        const txid = await indexer.broadcastTransaction(ordResult.tx.toHex());

        // Return new inscription outpoint
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
 * Get version metadata from the latest inscription in the origin chain
 *
 * @param versionInscriptionOrigin - The origin outpoint of the versioning inscription
 * @param contentUrl - Optional content service URL (defaults to GORILLA_POOL_CONTENT_URL)
 * @returns Parsed metadata object with version:outpoint mappings
 */
export async function getVersionMetadata(
  versionInscriptionOrigin: string,
  contentUrl?: string
): Promise<VersionMetadata> {
  try {
    // Fetch metadata from content service using seq=-1 for latest
    const serviceUrl = contentUrl || GORILLA_POOL_CONTENT_URL;
    const url = `${serviceUrl}/content/${versionInscriptionOrigin}?seq=-1&map=true`;

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

    return metadata;
  } catch (error) {
    console.error('Failed to get version metadata:', error);
    throw new Error(
      `Getting version metadata failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Check if a version already exists in the inscription metadata
 * Throws an error if the version exists to prevent wasted inscription costs
 *
 * @param versionInscriptionOrigin - The origin outpoint of the versioning inscription
 * @param version - Version string to check
 * @param contentUrl - Optional content service URL (defaults to GORILLA_POOL_CONTENT_URL)
 * @throws Error if version already exists
 */
export async function checkVersionExists(
  versionInscriptionOrigin: string,
  version: string,
  contentUrl?: string
): Promise<void> {
  try {
    const metadata = await getVersionMetadata(versionInscriptionOrigin, contentUrl);

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
 * @param contentUrl - Optional content service URL (defaults to GORILLA_POOL_CONTENT_URL)
 * @returns Version details including outpoint and description
 */
export async function getVersionDetails(
  versionInscriptionOrigin: string,
  version: string,
  contentUrl?: string
): Promise<{
  version: string;
  outpoint: string;
  description: string;
} | null> {
  try {
    const metadata = await getVersionMetadata(versionInscriptionOrigin, contentUrl);

    // Get version metadata (format: version.X.X.X)
    const versionKey = `version.${version}`;
    const versionData = metadata[versionKey];

    if (!versionData || typeof versionData !== 'string') {
      return null;
    }

    // Parse the nested JSON
    const versionMetadata = JSON.parse(versionData);
    const outpoint = versionMetadata.outpoint;
    const description = versionMetadata.description || '';

    if (!outpoint || typeof outpoint !== 'string') {
      return null;
    }

    return {
      version,
      outpoint,
      description: typeof description === 'string' ? description : '',
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
 * @param contentUrl - Optional content service URL (defaults to GORILLA_POOL_CONTENT_URL)
 * @returns Inscription information including metadata
 */
export async function getInscriptionInfo(
  versionInscriptionOrigin: string,
  contentUrl?: string
): Promise<VersioningInscriptionInfo> {
  try {
    const metadata = await getVersionMetadata(versionInscriptionOrigin, contentUrl);

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
 * Get version history from inscription metadata
 *
 * @param versionInscriptionOrigin - The origin outpoint of the versioning inscription
 * @param contentUrl - Optional content service URL (defaults to GORILLA_POOL_CONTENT_URL)
 * @returns Array of version data sorted by timestamp (newest first)
 */
export async function getVersionHistory(
  versionInscriptionOrigin: string,
  contentUrl?: string
): Promise<Array<{ version: string; description: string; outpoint: string }>> {
  try {
    const metadata = await getVersionMetadata(versionInscriptionOrigin, contentUrl);

    // Extract version entries (keys without _description suffix)
    const versionEntries: Array<{ version: string; description: string; outpoint: string }> = [];

    for (const key of Object.keys(metadata)) {
      // Skip system fields and description keys
      if (!key.startsWith('version')) {
        continue;
      }

      const version = key.replace('version.', '');
      const versionMetadata = JSON.parse(metadata[key] as string);
      const outpoint = versionMetadata.outpoint;
      const description = versionMetadata.description;

      // Only add if outpoint is a string (skip if it's a number)
      if (typeof outpoint === 'string') {
        versionEntries.push({
          version,
          outpoint,
          description: typeof description === 'string' ? description : '',
        });
      }
    }

    // Sort by version string (simple lexicographic sort)
    // For more advanced sorting, could use semver library
    versionEntries.sort((a, b) => b.version.localeCompare(a.version));

    return versionEntries;
  } catch (error) {
    console.error('Failed to get version history:', error);
    throw new Error(
      `Getting version history failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Get both inscription info and version history with a single metadata fetch
 * This is more efficient than calling getInscriptionInfo and getVersionHistory separately
 *
 * @param versionInscriptionOrigin - The origin outpoint of the versioning inscription
 * @param contentUrl - Optional content service URL (defaults to GORILLA_POOL_CONTENT_URL)
 * @returns Object containing both inscription info and version history
 */
export async function getVersionInfoAndHistory(
  versionInscriptionOrigin: string,
  contentUrl?: string
): Promise<{
  info: VersioningInscriptionInfo;
  history: Array<{ version: string; description: string; outpoint: string }>;
}> {
  try {
    // Fetch metadata once
    const metadata = await getVersionMetadata(versionInscriptionOrigin, contentUrl);

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
      // Skip system fields and description keys
      if (!key.startsWith('version')) {
        continue;
      }

      const version = key.replace('version.', '');
      const versionMetadata = JSON.parse(metadata[key] as string);
      const outpoint = versionMetadata.outpoint;
      const description = versionMetadata.description;

      // Only add if outpoint is a string (skip if it's a number)
      if (typeof outpoint === 'string') {
        versionEntries.push({
          version,
          outpoint,
          description: typeof description === 'string' ? description : '',
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
