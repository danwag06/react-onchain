import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { PrivateKey } from '@bsv/sdk';
import { analyzeBuildDirectory } from './analyzer.js';
import { rewriteFile, injectVersionScript, injectServiceResolverScript } from './rewriter.js';
import { inscribeFile } from './inscriber.js';
import {
  deployVersioningContract,
  addVersionToContract,
  checkVersionExists,
  VERSIONING_ENABLED,
} from './versioningContractHandler.js';
import {
  getAllOrdinalContentServices,
  getAllIndexerConfigs,
  createIndexer,
  config as envConfig,
} from './config.js';
import { OrdiProvider } from './OrdiProvider.js';
import type {
  DeploymentConfig,
  DeploymentResult,
  DeploymentManifest,
  DeploymentManifestHistory,
  InscribedFile,
} from './types.js';
import { bsv } from 'scrypt-ts';

export interface OrchestratorCallbacks {
  onAnalysisStart?: () => void;
  onAnalysisComplete?: (fileCount: number) => void;
  onInscriptionStart?: (file: string, current: number, total: number) => void;
  onInscriptionComplete?: (file: string, url: string) => void;
  onVersioningContractStart?: () => void;
  onVersioningContractComplete?: () => void;
  onDeploymentComplete?: (entryPointUrl: string) => void;
}

/**
 * Main deployment orchestrator
 */
export async function deployToChain(
  config: DeploymentConfig,
  callbacks?: OrchestratorCallbacks
): Promise<DeploymentResult> {
  const {
    buildDir,
    paymentKey,
    destinationAddress,
    satsPerKb,
    dryRun,
    enableVersioning,
    version,
    versionDescription,
    versioningContract,
    appName,
    ordinalContentUrl,
    ordinalIndexerUrl,
    enableServiceResolver,
  } = config;

  // Get service URLs (use config override or fall back to env/defaults)
  const primaryContentUrl = ordinalContentUrl || envConfig.ordinalContentUrl;
  const shouldEnableServiceResolver = enableServiceResolver ?? envConfig.enableServiceResolver;

  // Get all known services for fallback
  const allContentServices = getAllOrdinalContentServices(primaryContentUrl);
  const allIndexerConfigs = getAllIndexerConfigs();

  // Parse payment key (skip in dry-run mode)
  let paymentPk: PrivateKey;
  if (dryRun) {
    // Use a valid dummy key for dry-run mode
    paymentPk = PrivateKey.fromRandom();
  } else {
    paymentPk = PrivateKey.fromWif(paymentKey);
  }

  // Create IndexerService and OrdiProvider for broadcasting transactions
  const indexer = createIndexer(ordinalIndexerUrl);
  const provider = new OrdiProvider(bsv.Networks.mainnet, indexer, satsPerKb);
  await provider.connect();

  // Step 1: Analyze the build directory
  callbacks?.onAnalysisStart?.();
  const { files, graph, order } = await analyzeBuildDirectory(buildDir);
  callbacks?.onAnalysisComplete?.(files.length);

  if (files.length === 0) {
    throw new Error(`No files found in build directory: ${buildDir}`);
  }

  // Step 1.5: Setup versioning variables (deployment happens AFTER inscriptions)
  // Note: For FIRST deployments (no --versioning-contract flag), finalVersioningContract will be undefined
  // until AFTER inscriptions complete. This is because the contract needs the entry point outpoint,
  // which we only know after inscribing index.html.
  //
  // Consequence: First deployments will NOT have the version redirect script injected into index.html.
  // This is acceptable because there's only one version, so version redirects are meaningless.
  // Subsequent deployments WILL have the script because finalVersioningContract is known upfront.
  let finalVersioningContract = versioningContract;
  let changeUtxo: any = undefined; // Track change from previous transaction

  // Step 1.6: Validate version doesn't already exist (ONLY for subsequent deployments)
  // This prevents wasting satoshis on inscription when the version already exists in the contract.
  // Skip this check for:
  //   - First deployments (versioningContract is undefined)
  //   - Dry-run mode (don't hit the network)
  if (versioningContract && enableVersioning && version && !dryRun && VERSIONING_ENABLED) {
    try {
      await checkVersionExists(versioningContract, version);
    } catch (error) {
      // Version exists or other error - fail fast before inscribing anything
      throw new Error(
        `Cannot proceed with deployment: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Step 2: Process files in topological order
  const inscriptions: InscribedFile[] = [];
  const urlMap = new Map<string, string>();
  let totalCost = 0;
  let totalSize = 0;
  const txids = new Set<string>();
  // changeUtxo is initialized above (either from contract deployment or undefined)

  for (let i = 0; i < order.length; i++) {
    const filePath = order[i];
    const node = graph.get(filePath);

    if (!node) continue;

    const fileRef = node.file;
    const absolutePath = fileRef.absolutePath;

    callbacks?.onInscriptionStart?.(filePath, i + 1, order.length);

    // Check if this file has dependencies that have been inscribed
    const hasDependencies = fileRef.dependencies.length > 0;
    let content: string | undefined;

    if (hasDependencies) {
      // Rewrite the file content to use ordfs URLs
      content = await rewriteFile(absolutePath, buildDir, filePath, fileRef.contentType, urlMap);
    }

    // Inject scripts into index.html if needed
    const isIndexHtml = filePath === 'index.html' || filePath.endsWith('/index.html');
    if (isIndexHtml) {
      // Read the HTML content if not already read
      if (!content) {
        content = await readFile(absolutePath, 'utf-8');
      }

      // Inject service resolver script if enabled
      if (shouldEnableServiceResolver) {
        content = await injectServiceResolverScript(content, allContentServices, primaryContentUrl);
      }

      // Inject version script if versioning is enabled AND contract is known
      // IMPORTANT: This check will FAIL on first deployments because finalVersioningContract is undefined.
      // The version redirect script will only be injected on SUBSEQUENT deployments when the contract
      // outpoint is provided via --versioning-contract flag. This is by design:
      //   - First deployment: No other versions exist, so version redirects are unnecessary
      //   - Subsequent deployments: Multiple versions exist, version redirect script enables ?version= functionality
      if (enableVersioning && finalVersioningContract) {
        // Inject the version redirect script
        // Note: The origin outpoint is read from the contract state, not injected
        content = await injectVersionScript(
          content,
          finalVersioningContract,
          allIndexerConfigs,
          allContentServices
        );

        if (dryRun) {
          console.log('📝 Version redirect script injected (dry-run mode)');
        }
      }
    }

    // Inscribe the file (or simulate in dry-run mode)
    // Pass the change UTXO from the previous transaction (if any)
    const result = await inscribeFile(
      absolutePath,
      filePath,
      fileRef.contentType,
      destinationAddress,
      paymentPk,
      provider,
      content,
      satsPerKb,
      dryRun,
      changeUtxo,
      primaryContentUrl
    );

    inscriptions.push(result.inscription);
    urlMap.set(filePath, result.inscription.url);
    txids.add(result.inscription.txid);

    // Update change UTXO for next iteration
    changeUtxo = result.changeUtxo;

    // Track total size
    totalSize += result.inscription.size;

    callbacks?.onInscriptionComplete?.(filePath, result.inscription.url);

    // Estimate cost (rough approximation)
    totalCost += Math.ceil(((result.inscription.size + 200) / 1000) * (satsPerKb || 50)) + 1;

    // Small delay between inscriptions (only needed if NOT using change UTXO)
    if (i < order.length - 1 && !changeUtxo) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  // Find the entry point (index.html)
  const entryPoint = inscriptions.find(
    (i) => i.originalPath === 'index.html' || i.originalPath.endsWith('/index.html')
  );

  if (!entryPoint) {
    throw new Error('No index.html found in build directory');
  }

  // Step 3: Deploy versioning contract with actual origin (only for first deployment)
  // OR add version to existing contract (for updates)
  //
  // TWO DEPLOYMENT PATHS:
  // 1. FIRST DEPLOYMENT (no --versioning-contract flag):
  //    - finalVersioningContract is undefined during inscription
  //    - Contract is deployed HERE with entry point as origin
  //    - Version redirect script was NOT injected (acceptable - only one version exists)
  //
  // 2. SUBSEQUENT DEPLOYMENT (--versioning-contract flag provided):
  //    - finalVersioningContract was set from CLI flag during inscription
  //    - Version redirect script WAS injected into index.html
  //    - New version is added to existing contract HERE
  if (enableVersioning && version) {
    callbacks?.onVersioningContractStart?.();

    if (!versioningContract) {
      // PATH 1: FIRST DEPLOYMENT - Deploy contract with initial version
      if (dryRun) {
        // DRY RUN MODE - Create mock versioning contract
        const mockContractTxid = 'c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0';
        finalVersioningContract = `${mockContractTxid}_0`;
      } else if (VERSIONING_ENABLED) {
        try {
          const entryPointOutpoint =
            entryPoint.url.split('/').pop() || entryPoint.txid + '_' + entryPoint.vout;

          finalVersioningContract = await deployVersioningContract(
            paymentPk,
            entryPointOutpoint,
            appName || 'ReactApp',
            version,
            versionDescription || `Version ${version}`,
            satsPerKb
          );
        } catch (error) {
          // Contract deployment failed, but app inscription succeeded
          console.warn(
            '⚠️  Warning: Contract deployment failed. App is deployed but version tracking unavailable.'
          );
          console.warn(`   Error: ${error instanceof Error ? error.message : String(error)}`);
          finalVersioningContract = undefined;
        }
      }
    } else {
      // PATH 2: SUBSEQUENT DEPLOYMENT - Add version to existing contract
      if (!dryRun && VERSIONING_ENABLED) {
        try {
          await addVersionToContract(
            versioningContract,
            paymentPk,
            version,
            entryPoint.url.split('/').pop() || entryPoint.txid + '_' + entryPoint.vout,
            versionDescription || `Version ${version}`,
            satsPerKb
          );
        } catch (error) {
          // Contract update failed, but app inscription succeeded
          console.warn(
            '⚠️  Warning: Failed to add version to contract. App is deployed but version tracking failed.'
          );
          console.warn(`   Error: ${error instanceof Error ? error.message : String(error)}`);
          console.warn(
            `   Possible causes: Wrong payment key, contract doesn't exist, or network issue.`
          );
        }
      }
    }

    callbacks?.onVersioningContractComplete?.();
  }

  callbacks?.onDeploymentComplete?.(entryPoint.url);

  return {
    entryPointUrl: entryPoint.url,
    inscriptions,
    totalCost,
    totalSize,
    txids: Array.from(txids),
    versioningContract: finalVersioningContract,
    version: version,
    versionDescription: versionDescription,
  };
}

/**
 * Generates a deployment manifest file
 */
export function generateManifest(result: DeploymentResult): DeploymentManifest {
  return {
    timestamp: new Date().toISOString(),
    entryPoint: result.entryPointUrl,
    files: result.inscriptions,
    totalFiles: result.inscriptions.length,
    totalCost: result.totalCost,
    totalSize: result.totalSize,
    transactions: result.txids,
    versioningContract: result.versioningContract,
    version: result.version,
    versionDescription: result.versionDescription,
  };
}

/**
 * Saves the deployment manifest to a file
 */
export async function saveManifest(
  manifest: DeploymentManifest,
  outputPath: string
): Promise<void> {
  const json = JSON.stringify(manifest, null, 2);
  await writeFile(outputPath, json, 'utf-8');
}

/**
 * Saves the deployment manifest with full deployment history tracking
 * Maintains a complete record of all deployments in a single file
 */
export async function saveManifestWithHistory(
  manifest: DeploymentManifest,
  outputPath: string
): Promise<DeploymentManifestHistory> {
  let history: DeploymentManifestHistory;

  // Check if manifest file already exists
  if (existsSync(outputPath)) {
    try {
      const existing = await readFile(outputPath, 'utf-8');
      const parsed = JSON.parse(existing);

      // Check if it's the new format (has manifestVersion) or old format
      if ('manifestVersion' in parsed && 'deployments' in parsed) {
        // New format - load existing history
        history = parsed as DeploymentManifestHistory;

        // Append new deployment
        history.deployments.push(manifest);
        history.totalDeployments = history.deployments.length;

        // Update shared versioning contract if present
        if (manifest.versioningContract) {
          history.versioningContract = manifest.versioningContract;
        }
      } else if ('timestamp' in parsed && 'entryPoint' in parsed) {
        // Old format - migrate to new format
        const oldManifest = parsed as DeploymentManifest;
        history = {
          manifestVersion: '1.0.0',
          versioningContract: oldManifest.versioningContract,
          totalDeployments: 2, // Old deployment + new deployment
          deployments: [oldManifest, manifest],
        };
      } else {
        // Unknown format - start fresh
        console.warn('⚠️  Warning: Unknown manifest format, creating new history');
        history = createNewHistory(manifest);
      }
    } catch (error) {
      // Error reading/parsing - start fresh
      console.warn('⚠️  Warning: Could not read existing manifest, creating new history');
      history = createNewHistory(manifest);
    }
  } else {
    // No existing manifest - create new history
    history = createNewHistory(manifest);
  }

  // Save updated history
  const json = JSON.stringify(history, null, 2);
  await writeFile(outputPath, json, 'utf-8');

  return history;
}

/**
 * Helper function to create a new deployment history
 */
function createNewHistory(manifest: DeploymentManifest): DeploymentManifestHistory {
  return {
    manifestVersion: '1.0.0',
    versioningContract: manifest.versioningContract,
    totalDeployments: 1,
    deployments: [manifest],
  };
}
