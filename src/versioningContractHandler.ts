/**
 * Versioning Contract Handler
 *
 * Handles deployment and interaction with the ReactOnchainVersioning smart contract
 */

import type { PrivateKey } from '@bsv/sdk';
import {
  bsv,
  TestWallet,
  toByteString,
  PubKey,
  findSig,
  MethodCallOptions,
  ByteString,
  fill,
  FixedArray,
} from 'scrypt-ts';
import { OrdiProvider } from './OrdiProvider.js';
import { ReactOnchainVersioning, VersionData } from './contracts/reactOnchainVersioning.js';
import artifact from '../artifacts/contracts/reactOnchainVersioning.json' with { type: 'json' };
import { retryWithBackoff, shouldRetryError } from './retryUtils.js';
import { createIndexer } from './config.js';
import type { IndexerService } from './services/IndexerService.js';

export const VERSIONING_ENABLED = true;

export interface VersioningContractInfo {
  outpoint: string;
  originOutpoint: string;
  appName: string;
  owner: string;
}

/**
 * Convert @bsv/sdk PrivateKey to scrypt-ts bsv.PrivateKey
 */
function convertPrivateKey(sdkKey: PrivateKey): bsv.PrivateKey {
  const wif = sdkKey.toWif();
  return bsv.PrivateKey.fromWIF(wif);
}

/**
 * Deploy a new versioning contract
 *
 * @param paymentKey - Private key for paying transaction fees
 * @param originOutpoint - The outpoint of the initial app deployment
 * @param appName - Name of the application
 * @param initialVersion - Optional initial version to set (e.g., "1.0.0")
 * @param initialDescription - Optional description for initial version
 * @param satsPerKb - Optional fee rate in satoshis per KB
 * @returns Contract outpoint (txid_vout)
 */
export async function deployVersioningContract(
  paymentKey: PrivateKey,
  originOutpoint: string,
  appName: string,
  initialVersion?: string,
  initialDescription?: string,
  satsPerKb?: number
): Promise<string> {
  try {
    // Load contract artifact
    await ReactOnchainVersioning.loadArtifact(artifact);

    // Convert private key
    const scryptPrivKey = convertPrivateKey(paymentKey);

    // Wrap deployment in retry logic
    const deployTx = await retryWithBackoff(
      async () => {
        // Create IndexerService and OrdiProvider (uses GorillaPool for broadcasting)
        const indexer = createIndexer();
        const provider = new OrdiProvider(bsv.Networks.mainnet, indexer, satsPerKb);
        await provider.connect();

        const signer = new TestWallet(scryptPrivKey, provider);

        // Prepare initial state based on whether we have an initial version
        const emptyVersionData: VersionData = {
          outpoint: toByteString(''),
          description: toByteString(''),
          timestamp: 0n,
        };
        const versionHistory: FixedArray<VersionData, typeof ReactOnchainVersioning.MAX_HISTORY> =
          fill(emptyVersionData, ReactOnchainVersioning.MAX_HISTORY);
        const versionStrings: FixedArray<ByteString, typeof ReactOnchainVersioning.MAX_HISTORY> =
          fill(toByteString(''), ReactOnchainVersioning.MAX_HISTORY);
        let versionCount = 0n;
        let latestVersion = toByteString('');

        if (initialVersion) {
          // Initialize with first version
          const timestamp = BigInt(Math.floor(Date.now() / 1000));
          const versionBytes = toByteString(initialVersion, true);
          const descriptionBytes = toByteString(initialDescription || '', true);
          const originBytes = toByteString(originOutpoint, true);

          // Set up the version history with first version
          versionHistory[0] = {
            outpoint: originBytes,
            description: descriptionBytes,
            timestamp: timestamp,
          };
          versionStrings[0] = versionBytes;
          versionCount = 1n;
          latestVersion = versionBytes;
        }

        // Create contract instance with initialized state
        const versioning = new ReactOnchainVersioning(
          PubKey(scryptPrivKey.publicKey.toByteString()),
          toByteString(originOutpoint, true),
          toByteString(appName, true),
          versionHistory,
          versionStrings,
          versionCount,
          latestVersion
        );

        // Connect signer
        await versioning.connect(signer);

        // Deploy with initial balance (1 sat to keep it spendable)
        return await versioning.deploy(1);
      },
      {
        maxAttempts: 5,
        initialDelayMs: 3000,
        maxDelayMs: 60000,
      },
      shouldRetryError
    );

    // Return contract outpoint
    return `${deployTx.id}_0`;
  } catch (error) {
    console.error('❌ Failed to deploy versioning contract:', error);
    throw new Error(
      `Versioning contract deployment failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Add a new version to an existing versioning contract
 *
 * @param contractOutpoint - The outpoint of the versioning contract
 * @param paymentKey - Private key (must be the contract owner)
 * @param version - Version string (e.g., "1.0.0")
 * @param appOutpoint - The outpoint of the new app deployment
 * @param description - Changelog or version description
 * @param satsPerKb - Fee rate in satoshis per KB
 */
export async function addVersionToContract(
  contractOutpoint: string,
  paymentKey: PrivateKey,
  version: string,
  appOutpoint: string,
  description: string,
  satsPerKb?: number
): Promise<void> {
  try {
    // Wrap the add version logic in retry mechanism
    const tx = await retryWithBackoff(
      async () => {
        // Load contract artifact
        await ReactOnchainVersioning.loadArtifact(artifact);

        // Convert private key
        const scryptPrivKey = convertPrivateKey(paymentKey);

        // Create IndexerService and OrdiProvider
        const indexer = createIndexer();
        const provider = new OrdiProvider(bsv.Networks.mainnet, indexer, satsPerKb);
        await provider.connect();

        const signer = new TestWallet(scryptPrivKey, provider);

        // Fetch the latest contract location using fetchLatestByOrigin
        // This allows using the origin outpoint and automatically finding the current UTXO
        const latestUtxo = await indexer.fetchLatestByOrigin(contractOutpoint);

        if (!latestUtxo) {
          throw new Error(`Could not find contract at origin: ${contractOutpoint}`);
        }

        const txid = latestUtxo.txId;
        const vout = latestUtxo.outputIndex;

        // Load the existing contract instance from blockchain
        const contractTx = await signer.connectedProvider.getTransaction(txid);

        // Deserialize contract - no additional data needed with FixedArray
        const versioning = ReactOnchainVersioning.fromTx(contractTx, vout);
        await versioning.connect(signer);

        // OWNERSHIP VALIDATION: Verify the payment key matches the contract owner
        // This prevents wasted transaction fees from failed contract calls
        const contractOwnerPubKey = versioning.owner.toString();
        const paymentPubKey = scryptPrivKey.publicKey.toByteString();

        if (contractOwnerPubKey !== paymentPubKey) {
          throw new Error(
            `Ownership mismatch: Payment key does not own this contract.\n` +
              `  Contract owner: ${contractOwnerPubKey}\n` +
              `  Payment key:    ${paymentPubKey}\n` +
              `  Use the same private key that deployed the original contract.`
          );
        }

        // VERSION LIMIT CHECK: Warn if approaching maximum version history (100 versions)
        const currentVersionCount = Number(versioning.versionCount);
        const maxVersions = ReactOnchainVersioning.MAX_HISTORY;

        if (currentVersionCount >= maxVersions) {
          console.warn(`⚠️  Warning: Contract has reached maximum version limit (${maxVersions}).`);
          console.warn(
            `   Oldest version tracking will be removed: ${Buffer.from(versioning.versionStrings[maxVersions - 1], 'hex').toString('utf8')}`
          );
          console.warn(
            `   Note: The version itself remains on-chain and accessible via direct URL.`
          );
          console.warn(
            `   Only the version metadata is removed from the contract's queryable history.`
          );
        } else if (currentVersionCount >= maxVersions - 10) {
          const remaining = maxVersions - currentVersionCount;
          console.warn(
            `⚠️  Warning: Approaching version limit. ${remaining} version slots remaining.`
          );
          console.warn(
            `   After reaching ${maxVersions} versions, older version tracking will be removed from the contract.`
          );
          console.warn(`   The deployments themselves remain permanently on-chain and accessible.`);
        }

        // Prepare next instance with updated state
        const nextInstance = versioning.next();
        nextInstance.versionCount = versioning.versionCount + 1n;
        nextInstance.latestVersion = toByteString(version, true);

        // Create version data
        const timestamp = BigInt(Math.floor(Date.now() / 1000));
        const versionData: VersionData = {
          outpoint: toByteString(appOutpoint, true),
          description: toByteString(description, true),
          timestamp: timestamp,
        };

        // Shift history arrays (newest first)
        for (let i = ReactOnchainVersioning.MAX_HISTORY - 1; i > 0; i--) {
          nextInstance.versionHistory[i] = versioning.versionHistory[i - 1];
          nextInstance.versionStrings[i] = versioning.versionStrings[i - 1];
        }
        nextInstance.versionHistory[0] = versionData;
        nextInstance.versionStrings[0] = toByteString(version, true);

        // Call addVersion method
        const { tx: versionTx } = await versioning.methods.addVersion(
          (sigResps: any) => findSig(sigResps, scryptPrivKey.publicKey),
          toByteString(version, true),
          toByteString(appOutpoint, true),
          toByteString(description, true),
          {
            pubKeyOrAddrToSign: scryptPrivKey.publicKey,
            lockTime: Number(timestamp),
            next: {
              instance: nextInstance,
              balance: 1, // Maintain 1 sat balance
            },
          } as MethodCallOptions<ReactOnchainVersioning>
        );

        return versionTx;
      },
      {
        maxAttempts: 5,
        initialDelayMs: 3000,
        maxDelayMs: 60000,
      },
      shouldRetryError
    );
  } catch (error) {
    console.error(`❌ Failed to add version to contract:`, error);
    throw new Error(
      `Adding version failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Get the outpoint for a specific version
 *
 * @param contractOutpoint - The outpoint of the versioning contract (will be resolved to latest)
 * @param version - Version string to query
 * @returns The outpoint (txid_vout) for that version, or null if not found
 */
export async function getOutpointByVersion(
  contractOutpoint: string,
  version: string
): Promise<string | null> {
  try {
    await ReactOnchainVersioning.loadArtifact(artifact);

    // Create indexer service
    const indexer = createIndexer();

    // First, fetch the latest contract location using fetchLatestByOrigin
    const latestUtxo = await indexer.fetchLatestByOrigin(contractOutpoint);

    if (!latestUtxo) {
      throw new Error(`Could not find latest contract at origin: ${contractOutpoint}`);
    }

    const txid = latestUtxo.txId;
    const vout = latestUtxo.outputIndex;

    // Create provider to fetch transaction
    const provider = new OrdiProvider(bsv.Networks.mainnet, indexer, undefined);
    await provider.connect();

    // Load contract instance from latest location
    const contractTx = await provider.getTransaction(txid);

    // Deserialize contract
    const versioning = ReactOnchainVersioning.fromTx(contractTx, vout);

    // Search for version in the array
    const versionKey = toByteString(version, true);
    for (let i = 0; i < Number(versioning.versionCount); i++) {
      const versionStr = versioning.versionStrings[i];
      if (versionStr === versionKey) {
        const versionData = versioning.versionHistory[i];
        // Decode the outpoint from hex to UTF-8
        return Buffer.from(versionData.outpoint, 'hex').toString('utf8');
      }
    }

    return null;
  } catch (error) {
    console.error('Failed to get outpoint by version:', error);
    throw new Error(
      `Getting outpoint for version failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Get contract information (optional helper function)
 *
 * @param contractOutpoint - The outpoint of the versioning contract
 * @returns Contract information including origin outpoint and app name
 */
export async function getContractInfo(contractOutpoint: string): Promise<VersioningContractInfo> {
  try {
    await ReactOnchainVersioning.loadArtifact(artifact);

    // Create indexer service
    const indexer = createIndexer();

    // First, fetch the latest contract location using fetchLatestByOrigin
    const latestUtxo = await indexer.fetchLatestByOrigin(contractOutpoint);

    if (!latestUtxo) {
      throw new Error(`Could not find latest contract at origin: ${contractOutpoint}`);
    }

    const txid = latestUtxo.txId;
    const vout = latestUtxo.outputIndex;

    // Create a temporary provider to fetch transaction
    const provider = new OrdiProvider(bsv.Networks.mainnet, indexer, undefined);
    await provider.connect();

    // Load contract instance from latest location
    const contractTx = await provider.getTransaction(txid);

    // Deserialize contract
    const versioning = ReactOnchainVersioning.fromTx(contractTx, vout);

    // Convert ByteStrings to regular strings
    // ByteString.toString() gives hex, we need to decode it
    const originOutpoint = Buffer.from(versioning.originOutpoint, 'hex').toString('utf8');
    const appName = Buffer.from(versioning.appName, 'hex').toString('utf8');
    const ownerPubKey = versioning.owner.toString();

    return {
      outpoint: contractOutpoint,
      originOutpoint,
      appName,
      owner: ownerPubKey,
    };
  } catch (error) {
    console.error('Failed to get contract info:', error);
    throw new Error(
      `Getting contract info failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Get version history from contract
 *
 * @param contractOutpoint - The outpoint of the versioning contract
 * @returns Array of version data (newest first, up to last 100)
 */
export async function getVersionHistory(
  contractOutpoint: string
): Promise<Array<{ version: string; description: string }>> {
  try {
    await ReactOnchainVersioning.loadArtifact(artifact);

    // Create indexer service
    const indexer = createIndexer();

    // First, fetch the latest contract location using fetchLatestByOrigin
    const latestUtxo = await indexer.fetchLatestByOrigin(contractOutpoint);

    if (!latestUtxo) {
      throw new Error(`Could not find latest contract at origin: ${contractOutpoint}`);
    }

    const txid = latestUtxo.txId;
    const vout = latestUtxo.outputIndex;

    // Create provider
    const provider = new OrdiProvider(bsv.Networks.mainnet, indexer, undefined);
    await provider.connect();

    // Load contract instance from latest location
    const contractTx = await provider.getTransaction(txid);

    // Deserialize contract
    const versioning = ReactOnchainVersioning.fromTx(contractTx, vout);

    // Extract version history with descriptions
    const history: Array<{ version: string; description: string }> = [];
    for (let i = 0; i < Number(versioning.versionCount); i++) {
      const versionBytes = versioning.versionStrings[i];
      const versionData = versioning.versionHistory[i];

      if (versionBytes && versionBytes.length > 0) {
        // Decode hex to UTF-8
        const version = Buffer.from(versionBytes, 'hex').toString('utf8');
        const description = Buffer.from(versionData.description, 'hex').toString('utf8');
        history.push({ version, description });
      }
    }

    return history;
  } catch (error) {
    console.error('Failed to get version history:', error);
    throw new Error(
      `Getting version history failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Check if a version already exists in the contract
 * Throws an error if the version exists to prevent wasted inscription costs
 *
 * @param contractOutpoint - The outpoint of the versioning contract
 * @param version - Version string to check
 * @throws Error if version already exists in contract
 */
export async function checkVersionExists(contractOutpoint: string, version: string): Promise<void> {
  try {
    await ReactOnchainVersioning.loadArtifact(artifact);

    // Create indexer service
    const indexer = createIndexer();

    // First, fetch the latest contract location using fetchLatestByOrigin
    const latestUtxo = await indexer.fetchLatestByOrigin(contractOutpoint);

    if (!latestUtxo) {
      throw new Error(`Could not find contract at origin: ${contractOutpoint}`);
    }

    const txid = latestUtxo.txId;
    const vout = latestUtxo.outputIndex;

    // Create provider
    const provider = new OrdiProvider(bsv.Networks.mainnet, indexer, undefined);
    await provider.connect();

    // Load contract instance from latest location
    const contractTx = await provider.getTransaction(txid);

    // Deserialize contract
    const versioning = ReactOnchainVersioning.fromTx(contractTx, vout);

    // Search for version in the array
    const versionKey = toByteString(version, true);
    for (let i = 0; i < Number(versioning.versionCount); i++) {
      const versionStr = versioning.versionStrings[i];
      if (versionStr === versionKey) {
        // Version already exists - throw error to prevent wasted inscription costs
        throw new Error(
          `Version "${version}" already exists in contract.\n` +
            `  Please use a different version tag (e.g., "${version}.1" or increment the version number).`
        );
      }
    }

    // Version doesn't exist - safe to proceed
  } catch (error) {
    // If error is our "version exists" error, re-throw it
    if (error instanceof Error && error.message.includes('already exists')) {
      throw error;
    }

    // Other errors (network issues, contract not found, etc.)
    console.error('Failed to check version existence:', error);
    throw new Error(
      `Version existence check failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Get specific version details from contract
 *
 * @param contractOutpoint - The outpoint of the versioning contract
 * @param version - Version string to query
 * @returns Version details including outpoint, description, and timestamp
 */
export async function getVersionDetails(
  contractOutpoint: string,
  version: string
): Promise<{
  version: string;
  outpoint: string;
  description: string;
  timestamp: string;
} | null> {
  try {
    await ReactOnchainVersioning.loadArtifact(artifact);

    // Create indexer service
    const indexer = createIndexer();

    // First, fetch the latest contract location using fetchLatestByOrigin
    const latestUtxo = await indexer.fetchLatestByOrigin(contractOutpoint);

    if (!latestUtxo) {
      throw new Error(`Could not find latest contract at origin: ${contractOutpoint}`);
    }

    const txid = latestUtxo.txId;
    const vout = latestUtxo.outputIndex;

    // Create provider
    const provider = new OrdiProvider(bsv.Networks.mainnet, indexer, undefined);
    await provider.connect();

    // Load contract instance from latest location
    const contractTx = await provider.getTransaction(txid);

    // Deserialize contract
    const versioning = ReactOnchainVersioning.fromTx(contractTx, vout);

    // Search for version in the array
    const versionKey = toByteString(version, true);
    for (let i = 0; i < Number(versioning.versionCount); i++) {
      const versionStr = versioning.versionStrings[i];
      if (versionStr === versionKey) {
        const versionData = versioning.versionHistory[i];
        return {
          version,
          outpoint: Buffer.from(versionData.outpoint, 'hex').toString('utf8'),
          description: Buffer.from(versionData.description, 'hex').toString('utf8'),
          timestamp: new Date(Number(versionData.timestamp) * 1000).toISOString(),
        };
      }
    }

    return null;
  } catch (error) {
    console.error('Failed to get version details:', error);
    throw new Error(
      `Getting version details failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
