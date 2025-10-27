/**
 * Versioning Contract Handler
 *
 * Handles deployment and interaction with the ReactOnchainVersioning smart contract
 */

import type { PrivateKey } from '@bsv/sdk';
import {
  bsv,
  TestWallet,
  DefaultProvider,
  toByteString,
  HashedMap,
  PubKey,
  findSig,
  MethodCallOptions,
  ByteString,
} from 'scrypt-ts';
import { ReactOnchainVersioning, VersionData } from './contracts/reactOnchainVersioning.js';
import artifact from '../artifacts/reactOnchainVersioning.json' with { type: 'json' };
import { ORDINALS_GORILLA_POOL_URL, WOC_API_KEY } from './config.js';
import { retryWithBackoff, shouldRetryError } from './retryUtils.js';

export const VERSIONING_ENABLED = true;

export interface VersioningContractInfo {
  outpoint: string;
  originOutpoint: string;
  appName: string;
  owner: string;
}

/**
 * Submit a transaction to the ordinals indexer
 * This notifies GorillaPool's indexer to index the transaction as an ordinal
 */
async function submitToOrdinalIndexer(txid: string): Promise<void> {
  const url = `${ORDINALS_GORILLA_POOL_URL}/api/tx/${txid}/submit`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'accept': '*/*',
      },
    });

    if (response.status !== 204 && response.status !== 200) {
      console.warn(`Ordinal indexer submission returned status ${response.status} - transaction may not be indexed immediately`);
    }
  } catch (error) {
    console.warn('Failed to submit to ordinal indexer:', error);
    console.warn('Transaction is still valid, but may not appear in ordinals API immediately');
  }
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
 * @param destinationAddress - Address to receive the contract inscription
 * @param originOutpoint - The outpoint of the initial app deployment
 * @param appName - Name of the application
 * @param satsPerKb - Fee rate in satoshis per KB
 * @returns Contract outpoint (txid_vout)
 */
export async function deployVersioningContract(
  paymentKey: PrivateKey,
  destinationAddress: string,
  originOutpoint: string,
  appName: string,
  satsPerKb?: number
): Promise<{ contractOutpoint: string }> {
  try {
    // Load contract artifact
    await ReactOnchainVersioning.loadArtifact(artifact);

    // Convert private key
    const scryptPrivKey = convertPrivateKey(paymentKey);

    // Wrap deployment in retry logic
    const deployTx = await retryWithBackoff(
      async () => {
        console.log('   Connecting to DefaultProvider...');

        // Create signer with DefaultProvider (uses WhatsOnChain and other reliable endpoints)
        const provider = new DefaultProvider({
          network: bsv.Networks.mainnet,
          taal: WOC_API_KEY,
        });
        await provider.connect();

        const signer = new TestWallet(scryptPrivKey, provider);

        // Create contract instance with initial state
        const versioning = new ReactOnchainVersioning(
          PubKey(scryptPrivKey.publicKey.toByteString()),
          toByteString(originOutpoint, true),
          toByteString(appName, true),
          new HashedMap<ByteString, VersionData>()
        );

        // Connect signer
        await versioning.connect(signer);

        console.log('   Deploying versioning contract...');

        // Deploy with initial balance (1000 sats to keep it spendable)
        return await versioning.deploy(1000);
      },
      {
        maxAttempts: 5,
        initialDelayMs: 3000,
        maxDelayMs: 60000,
      },
      shouldRetryError
    );

    // Submit to ordinals indexer so it gets indexed as an ordinal
    await submitToOrdinalIndexer(deployTx.id);

    // Return contract outpoint
    return {
      contractOutpoint: `${deployTx.id}_0`,
    };
  } catch (error) {
    console.error('❌ Failed to deploy versioning contract:', error);
    throw new Error(`Versioning contract deployment failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Update the origin outpoint (one-time only if currently "pending")
 *
 * @param contractOutpoint - The outpoint of the versioning contract
 * @param paymentKey - Private key (must be the contract owner)
 * @param newOrigin - The actual origin outpoint after inscription
 * @param satsPerKb - Fee rate in satoshis per KB
 */
export async function updateContractOrigin(
  contractOutpoint: string,
  paymentKey: PrivateKey,
  newOrigin: string,
  satsPerKb?: number
): Promise<void> {
  try {
    // Load contract artifact
    await ReactOnchainVersioning.loadArtifact(artifact);

    // Parse contract outpoint
    const [txid, voutStr] = contractOutpoint.split('_');
    const vout = parseInt(voutStr, 10);

    if (!txid || isNaN(vout)) {
      throw new Error(`Invalid contract outpoint: ${contractOutpoint}`);
    }

    // Convert private key
    const scryptPrivKey = convertPrivateKey(paymentKey);

    // Create signer with DefaultProvider
    const provider = new DefaultProvider({
      network: bsv.Networks.mainnet,
      taal: WOC_API_KEY,
    });
    await provider.connect();

    const signer = new TestWallet(scryptPrivKey, provider);

    // Load the existing contract instance from blockchain
    const contractTx = await signer.connectedProvider.getTransaction(txid);

    // Provide empty versionMap for loading
    const currentVersionMap = new HashedMap<ByteString, VersionData>();

    const versioning = ReactOnchainVersioning.fromTx(contractTx, vout, {
      versionMap: currentVersionMap
    });
    await versioning.connect(signer);

    // Prepare next instance with updated origin
    const nextInstance = versioning.next();
    nextInstance.originOutpoint = toByteString(newOrigin, true);

    const timestamp = BigInt(Math.floor(Date.now() / 1000));

    // Call updateOrigin method
    const { tx } = await versioning.methods.updateOrigin(
      (sigResps: any) => findSig(sigResps, scryptPrivKey.publicKey),
      toByteString(newOrigin, true),
      {
        pubKeyOrAddrToSign: scryptPrivKey.publicKey,
        lockTime: Number(timestamp),
        next: {
          instance: nextInstance,
          balance: 1000, // Maintain 1000 sats balance
        },
      } as MethodCallOptions<ReactOnchainVersioning>
    );

    console.log(`✅ Origin updated to: ${newOrigin}`);
    console.log(`   Transaction ID: ${tx.id}`);

    // Submit to ordinals indexer
    await submitToOrdinalIndexer(tx.id);
  } catch (error) {
    console.error(`❌ Failed to update origin:`, error);
    throw new Error(`Updating origin failed: ${error instanceof Error ? error.message : String(error)}`);
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
    // Load contract artifact
    await ReactOnchainVersioning.loadArtifact(artifact);

    // Parse contract outpoint
    const [txid, voutStr] = contractOutpoint.split('_');
    const vout = parseInt(voutStr, 10);

    if (!txid || isNaN(vout)) {
      throw new Error(`Invalid contract outpoint: ${contractOutpoint}`);
    }

    // Convert private key
    const scryptPrivKey = convertPrivateKey(paymentKey);

    // Create signer with DefaultProvider
    const provider = new DefaultProvider({
      network: bsv.Networks.mainnet,
      taal: WOC_API_KEY,
    });
    await provider.connect();

    const signer = new TestWallet(scryptPrivKey, provider);

    // Load the existing contract instance from blockchain
    const contractTx = await signer.connectedProvider.getTransaction(txid);

    // For HashedMap contracts, we need to provide the current map data
    const currentVersionMap = new HashedMap<ByteString, VersionData>();

    const versioning = ReactOnchainVersioning.fromTx(contractTx, vout, {
      versionMap: currentVersionMap
    });
    await versioning.connect(signer);

    // Prepare next instance with updated state
    const nextInstance = versioning.next();
    nextInstance.versionCount = versioning.versionCount + 1n;
    nextInstance.latestVersion = toByteString(version, true);

    // Shift history array (newest first)
    for (let i = ReactOnchainVersioning.MAX_HISTORY - 1; i > 0; i--) {
      nextInstance.versionHistory[i] = versioning.versionHistory[i - 1];
    }
    nextInstance.versionHistory[0] = toByteString(version, true);

    // Add version to map
    const timestamp = BigInt(Math.floor(Date.now() / 1000));
    nextInstance.versionMap.set(toByteString(version, true), {
      outpoint: toByteString(appOutpoint, true),
      description: toByteString(description, true),
      timestamp: timestamp,
    });

    // Call addVersion method
    const { tx } = await versioning.methods.addVersion(
      (sigResps: any) => findSig(sigResps, scryptPrivKey.publicKey),
      toByteString(version, true),
      toByteString(appOutpoint, true),
      toByteString(description, true),
      {
        pubKeyOrAddrToSign: scryptPrivKey.publicKey,
        lockTime: Number(timestamp),
        next: {
          instance: nextInstance,
          balance: 1000, // Maintain 1000 sats balance
        },
      } as MethodCallOptions<ReactOnchainVersioning>
    );

    console.log(`✅ Version ${version} added to contract: ${tx.id}`);

    // Submit to ordinals indexer
    await submitToOrdinalIndexer(tx.id);
  } catch (error) {
    console.error(`❌ Failed to add version to contract:`, error);
    throw new Error(`Adding version failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get contract information (optional helper function)
 *
 * @param contractOutpoint - The outpoint of the versioning contract
 * @returns Contract information including origin outpoint and app name
 */
export async function getContractInfo(
  contractOutpoint: string
): Promise<VersioningContractInfo> {
  try {
    await ReactOnchainVersioning.loadArtifact(artifact);

    const [txid, voutStr] = contractOutpoint.split('_');
    const vout = parseInt(voutStr, 10);

    if (!txid || isNaN(vout)) {
      throw new Error(`Invalid contract outpoint: ${contractOutpoint}`);
    }

    // Create a temporary provider to fetch transaction
    const provider = new DefaultProvider({
      network: bsv.Networks.mainnet,
      taal: WOC_API_KEY,
    });
    await provider.connect();

    // Load contract instance
    const contractTx = await provider.getTransaction(txid);

    // Provide empty versionMap for read-only access
    const currentVersionMap = new HashedMap<ByteString, VersionData>();
    const versioning = ReactOnchainVersioning.fromTx(contractTx, vout, {
      versionMap: currentVersionMap
    });

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
    throw new Error(`Getting contract info failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get version history from contract
 *
 * @param contractOutpoint - The outpoint of the versioning contract
 * @returns Array of version strings (newest first, up to last 10)
 */
export async function getVersionHistory(
  contractOutpoint: string
): Promise<string[]> {
  try {
    await ReactOnchainVersioning.loadArtifact(artifact);

    const [txid, voutStr] = contractOutpoint.split('_');
    const vout = parseInt(voutStr, 10);

    if (!txid || isNaN(vout)) {
      throw new Error(`Invalid contract outpoint: ${contractOutpoint}`);
    }

    // Create provider
    const provider = new DefaultProvider({
      network: bsv.Networks.mainnet,
      taal: WOC_API_KEY,
    });
    await provider.connect();

    // Load contract instance
    const contractTx = await provider.getTransaction(txid);

    // Provide empty versionMap for read-only access
    const currentVersionMap = new HashedMap<ByteString, VersionData>();
    const versioning = ReactOnchainVersioning.fromTx(contractTx, vout, {
      versionMap: currentVersionMap
    });

    // Extract version history (convert ByteString to string)
    const history: string[] = [];
    for (let i = 0; i < Number(versioning.versionCount); i++) {
      const versionBytes = versioning.versionHistory[i];
      if (versionBytes && versionBytes.length > 0) {
        // Decode hex to UTF-8
        const versionStr = Buffer.from(versionBytes, 'hex').toString('utf8');
        history.push(versionStr);
      }
    }

    return history;
  } catch (error) {
    console.error('Failed to get version history:', error);
    throw new Error(`Getting version history failed: ${error instanceof Error ? error.message : String(error)}`);
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

    const [txid, voutStr] = contractOutpoint.split('_');
    const vout = parseInt(voutStr, 10);

    if (!txid || isNaN(vout)) {
      throw new Error(`Invalid contract outpoint: ${contractOutpoint}`);
    }

    // Create provider
    const provider = new DefaultProvider({
      network: bsv.Networks.mainnet,
      taal: WOC_API_KEY,
    });
    await provider.connect();

    // Load contract instance
    const contractTx = await provider.getTransaction(txid);

    // Provide empty versionMap for read-only access
    const currentVersionMap = new HashedMap<ByteString, VersionData>();
    const versioning = ReactOnchainVersioning.fromTx(contractTx, vout, {
      versionMap: currentVersionMap
    });

    // Query the versionMap for this specific version
    const versionKey = toByteString(version, true);
    const versionData = versioning.versionMap.get(versionKey);

    if (!versionData) {
      return null;
    }

    return {
      version,
      outpoint: Buffer.from(versionData.outpoint, 'hex').toString('utf8'),
      description: Buffer.from(versionData.description, 'hex').toString('utf8'),
      timestamp: new Date(Number(versionData.timestamp) * 1000).toISOString(),
    };
  } catch (error) {
    console.error('Failed to get version details:', error);
    throw new Error(`Getting version details failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
