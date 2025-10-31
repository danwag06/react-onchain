import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { createHash } from 'crypto';
import { PrivateKey } from '@bsv/sdk';
import { analyzeBuildDirectory } from './analyzer.js';
import { rewriteFile, injectVersionScript } from './rewriter.js';
import { inscribeFile, estimateInscriptionCost } from './inscriber.js';
import {
  deployVersioningInscription,
  updateVersioningInscription,
  checkVersionExists,
  VERSIONING_ENABLED,
} from './versioningInscriptionHandler.js';
import { createIndexer, config as envConfig } from './config.js';
import type {
  DeploymentConfig,
  DeploymentResult,
  DeploymentManifest,
  DeploymentManifestHistory,
  InscribedFile,
} from './types.js';

export interface OrchestratorCallbacks {
  onAnalysisStart?: () => void;
  onAnalysisComplete?: (fileCount: number) => void;
  onInscriptionStart?: (file: string, current: number, total: number) => void;
  onInscriptionComplete?: (file: string, url: string) => void;
  onInscriptionSkipped?: (file: string, url: string) => void;
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
    satsPerKb,
    dryRun,
    version,
    versionDescription,
    versioningOriginInscription,
    appName,
    ordinalContentUrl,
    ordinalIndexerUrl,
  } = config;

  // Get service URLs (use config override or fall back to env/defaults)
  const primaryContentUrl = ordinalContentUrl || envConfig.ordinalContentUrl;

  // Parse payment key (skip in dry-run mode)
  let paymentPk: PrivateKey;
  if (dryRun) {
    // Use a valid dummy key for dry-run mode
    paymentPk = PrivateKey.fromRandom();
  } else {
    paymentPk = PrivateKey.fromWif(paymentKey);
  }

  // Derive destination address from payment key
  const destinationAddress = paymentPk.toAddress().toString();

  // Create IndexerService for blockchain operations
  const indexer = createIndexer(ordinalIndexerUrl);

  // Step 1: Analyze the build directory
  callbacks?.onAnalysisStart?.();
  const { files, graph, order } = await analyzeBuildDirectory(buildDir);
  callbacks?.onAnalysisComplete?.(files.length);

  if (files.length === 0) {
    throw new Error(`No files found in build directory: ${buildDir}`);
  }

  // Step 1.5: Setup versioning variables (inscription deployment happens AFTER file inscriptions)
  // Note: For inscription-based versioning, we always inject the version redirect script.
  // On FIRST deployments: The script will use the entry point outpoint as the inscription origin.
  // On SUBSEQUENT deployments: The script will use the existing inscription origin from manifest.
  // The version redirect script gracefully handles cases where no inscription metadata exists yet.
  let finalVersioningOriginInscription = versioningOriginInscription; // Note: field name kept for compatibility, but stores inscription origin
  let changeUtxo: any = undefined; // Track change from previous transaction

  // Step 1.6: Check manifest for duplicate version (LOCAL CHECK - always run)
  // This prevents deploying the same version multiple times locally, which would waste satoshis on re-inscription
  const manifestPath = 'deployment-manifest.json';
  if (existsSync(manifestPath)) {
    try {
      const manifestJson = await readFile(manifestPath, 'utf-8');
      const manifestData = JSON.parse(manifestJson);

      let existingVersions: string[] = [];

      if ('manifestVersion' in manifestData && 'deployments' in manifestData) {
        // New format
        const history = manifestData as DeploymentManifestHistory;
        existingVersions = history.deployments
          .map((d) => d.version)
          .filter((v): v is string => v !== undefined);
      } else if ('version' in manifestData) {
        // Old format
        const manifest = manifestData as DeploymentManifest;
        if (manifest.version) {
          existingVersions = [manifest.version];
        }
      }

      if (existingVersions.includes(version)) {
        const lastNumberInVersion = version.split('.').pop();
        const newVersion = `${version.split('.').slice(0, -1).join('.')}.${Number(lastNumberInVersion) + 1}`;
        throw new Error(
          `Version "${version}" already exists in local manifest.\n` +
            `  Please use a different version tag (e.g., "${newVersion}" or increment the version number).\n` +
            `  Existing versions: ${existingVersions.join(', ')}`
        );
      }
    } catch (error) {
      // If error is our duplicate version error, re-throw it
      if (error instanceof Error && error.message.includes('already exists')) {
        throw error;
      }
      // Otherwise, continue (failed to read manifest - not critical)
    }
  }

  // Step 1.7: Validate version doesn't exist in inscription metadata (ON-CHAIN CHECK - subsequent deployments only)
  // This prevents wasting satoshis on inscription when the version already exists in the metadata.
  // Skip this check for:
  //   - First deployments (versioning origin inscription is undefined)
  //   - Dry-run mode (don't hit the network)
  if (versioningOriginInscription && !dryRun && VERSIONING_ENABLED) {
    try {
      await checkVersionExists(versioningOriginInscription, version);
    } catch (error) {
      // Version exists or other error - fail fast before inscribing anything
      throw new Error(
        `Cannot proceed with deployment: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Step 1.8: Load previous deployment manifest for cache
  // This allows us to reuse inscriptions for files that haven't changed
  // Note: manifestPath already declared above in Step 1.6
  const previousInscriptions = new Map<string, InscribedFile>();

  if (existsSync(manifestPath)) {
    try {
      const manifestJson = await readFile(manifestPath, 'utf-8');
      const manifestData = JSON.parse(manifestJson);

      // Handle both old (single deployment) and new (history) format
      let deploymentsToProcess: DeploymentManifest[] = [];

      if ('manifestVersion' in manifestData && 'deployments' in manifestData) {
        // New format - use most recent deployment
        const history = manifestData as DeploymentManifestHistory;
        if (history.deployments.length > 0) {
          deploymentsToProcess = [history.deployments[history.deployments.length - 1]];
        }
      } else if ('timestamp' in manifestData && 'entryPoint' in manifestData) {
        // Old format - single deployment
        deploymentsToProcess = [manifestData as DeploymentManifest];
      }

      // Build lookup map from most recent deployment
      for (const deployment of deploymentsToProcess) {
        for (const file of deployment.files) {
          // Only cache if file has contentHash (backward compatibility)
          if (file.contentHash) {
            previousInscriptions.set(file.originalPath, file);
          }
        }
      }
    } catch (error) {
      // Failed to load previous manifest - continue without cache
      console.warn('⚠️  Warning: Could not load previous manifest for cache');
    }
  }

  // Calculate total inscriptions for progress tracking
  let totalInscriptions = order.length;
  // Add empty versioning inscription for first deployment
  if (!versioningOriginInscription) {
    totalInscriptions += 1;
  }
  // Add metadata update inscription (always added)
  totalInscriptions += 1;

  let currentInscriptionIndex = 0;

  // Step 1.9: Deploy empty versioning inscription (FIRST DEPLOYMENT ONLY)
  // This happens BEFORE HTML inscription so we can inject the origin into the redirect script
  // The empty inscription becomes the origin, and we'll spend it after HTML deployment to add metadata

  // Initialize txids Set early to maintain chronological order
  const txids = new Set<string>();

  if (!versioningOriginInscription && !dryRun && VERSIONING_ENABLED) {
    currentInscriptionIndex++;
    callbacks?.onInscriptionStart?.(
      'versioning-origin',
      currentInscriptionIndex,
      totalInscriptions
    );
    try {
      finalVersioningOriginInscription = await deployVersioningInscription(
        paymentPk,
        appName || 'ReactApp',
        destinationAddress,
        satsPerKb
      );
      // Add versioning origin txid immediately (maintains chronological order)
      const originTxid = finalVersioningOriginInscription.split('_')[0];
      txids.add(originTxid);

      callbacks?.onInscriptionComplete?.(
        'versioning-origin',
        `/content/${finalVersioningOriginInscription}`
      );
    } catch (error) {
      throw new Error(
        `Failed to deploy versioning inscription: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  } else if (dryRun && !versioningOriginInscription) {
    // DRY RUN MODE - Create mock versioning inscription origin
    const mockInscriptionTxid = 'c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0';
    finalVersioningOriginInscription = `${mockInscriptionTxid}_0`;
  }

  // Step 2: Process files in topological order
  const inscriptions: InscribedFile[] = [];
  const urlMap = new Map<string, string>();
  let totalCost = 0;
  let totalSize = 0;
  // changeUtxo is initialized above (either from inscription deployment or undefined)

  for (let i = 0; i < order.length; i++) {
    const filePath = order[i];
    const node = graph.get(filePath);

    if (!node) continue;

    const fileRef = node.file;
    const absolutePath = fileRef.absolutePath;

    currentInscriptionIndex++;
    callbacks?.onInscriptionStart?.(filePath, currentInscriptionIndex, totalInscriptions);

    // Step 2.1: Check if we can reuse a previous inscription (cache hit)
    const previousInscription = previousInscriptions.get(filePath);
    const isIndexHtml = filePath === 'index.html' || filePath.endsWith('/index.html');

    // Always re-inscribe index.html (dynamic script injection)
    let canReuseInscription = false;

    if (previousInscription && !isIndexHtml) {
      // Content hash matches - check dependency hash
      if (previousInscription.contentHash === fileRef.contentHash) {
        const hasDependencies = fileRef.dependencies.length > 0;

        if (!hasDependencies) {
          // No dependencies - can safely reuse
          canReuseInscription = true;
        } else {
          // Has dependencies - compute dependency hash
          const dependencyUrls = fileRef.dependencies
            .map((dep) => urlMap.get(dep))
            .filter((url): url is string => url !== undefined)
            .sort();

          const dependencyHash = createHash('sha256')
            .update(dependencyUrls.join('|'))
            .digest('hex');

          // Check if dependency hash matches
          if (previousInscription.dependencyHash === dependencyHash) {
            canReuseInscription = true;
          }
        }
      }
    }

    // If we can reuse, skip inscription and add to urlMap
    if (canReuseInscription && previousInscription) {
      inscriptions.push({
        ...previousInscription,
        // Keep original contentHash and dependencyHash
        cached: true,
      });
      urlMap.set(filePath, previousInscription.urlPath);
      txids.add(previousInscription.txid);
      totalSize += previousInscription.size;

      // Reset change UTXO since we're not creating a transaction
      changeUtxo = undefined;

      callbacks?.onInscriptionSkipped?.(filePath, previousInscription.urlPath);
      continue;
    }

    // Check if this file has dependencies that have been inscribed
    const hasDependencies = fileRef.dependencies.length > 0;
    let content: string | undefined;

    if (hasDependencies) {
      // Rewrite the file content to use ordfs URLs
      content = await rewriteFile(absolutePath, buildDir, filePath, fileRef.contentType, urlMap);
    }

    // Inject scripts into index.html if needed
    // Note: isIndexHtml already declared above in cache check section
    if (isIndexHtml) {
      // Read the HTML content if not already read
      if (!content) {
        content = await readFile(absolutePath, 'utf-8');
      }

      // Inject version script if inscription origin is known
      // The finalVersioningOriginInscription is now deployed BEFORE HTML inscription (Step 1.9),
      // so it's always available for script injection on both first and subsequent deployments
      if (finalVersioningOriginInscription) {
        content = await injectVersionScript(
          content,
          finalVersioningOriginInscription // This is the inscription origin outpoint
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
      indexer,
      content,
      satsPerKb,
      dryRun,
      changeUtxo
    );

    // Compute dependency hash for files with dependencies
    let dependencyHash: string | undefined;
    if (hasDependencies) {
      const dependencyUrls = fileRef.dependencies
        .map((dep) => urlMap.get(dep))
        .filter((url): url is string => url !== undefined)
        .sort();

      dependencyHash = createHash('sha256').update(dependencyUrls.join('|')).digest('hex');
    }

    // Add hash fields to inscription
    const inscribedFile: InscribedFile = {
      ...result.inscription,
      contentHash: fileRef.contentHash,
      dependencyHash,
    };

    inscriptions.push(inscribedFile);
    urlMap.set(filePath, result.inscription.urlPath);
    txids.add(result.inscription.txid);

    // Update change UTXO for next iteration
    changeUtxo = result.changeUtxo;

    // Track total size
    totalSize += result.inscription.size;

    callbacks?.onInscriptionComplete?.(filePath, result.inscription.urlPath);

    // Calculate cost using proper estimation (only for newly inscribed files, not cached)
    totalCost += estimateInscriptionCost(result.inscription.size, satsPerKb || 50);

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

  // Step 3: Update versioning inscription with version metadata
  //
  // TWO DEPLOYMENT PATHS:
  // 1. FIRST DEPLOYMENT (no --versioning-origin-inscription flag):
  //    - Empty versioning inscription was deployed in Step 1.9
  //    - finalVersioningOriginInscription is the origin (empty inscription)
  //    - Now we spend it to add the first version metadata
  //
  // 2. SUBSEQUENT DEPLOYMENT (--versioning-origin-inscription flag provided):
  //    - finalVersioningOriginInscription = versioningOriginInscription (origin from CLI)
  //    - We spend the latest inscription in the chain to add new version metadata
  let latestVersioningInscription: string | undefined;

  if (finalVersioningOriginInscription) {
    if (!versioningOriginInscription) {
      // PATH 1: FIRST DEPLOYMENT - Update the empty inscription we deployed in Step 1.9
      if (dryRun) {
        // DRY RUN MODE - Mock the update
        latestVersioningInscription = `${finalVersioningOriginInscription.split('_')[0]}_1`; // Mock spending creates new outpoint
      } else if (VERSIONING_ENABLED) {
        currentInscriptionIndex++;
        callbacks?.onInscriptionStart?.(
          'versioning-metadata',
          currentInscriptionIndex,
          totalInscriptions
        );
        try {
          const entryPointOutpoint =
            entryPoint.urlPath.split('/').pop() || entryPoint.txid + '_' + entryPoint.vout;

          latestVersioningInscription = await updateVersioningInscription(
            finalVersioningOriginInscription, // Spend the empty inscription we created
            paymentPk,
            paymentPk, // same key for ordPk
            version,
            entryPointOutpoint,
            versionDescription || `Version ${version}`,
            destinationAddress,
            satsPerKb
          );
          // Add versioning metadata txid immediately (maintains chronological order)
          const metadataTxid = latestVersioningInscription.split('_')[0];
          txids.add(metadataTxid);

          callbacks?.onInscriptionComplete?.(
            'versioning-metadata',
            `/content/${latestVersioningInscription}`
          );
        } catch (error) {
          // Inscription update failed, but app inscription succeeded
          console.warn(
            '⚠️  Warning: Failed to update versioning inscription with version metadata.'
          );
          console.warn(`   Error: ${error instanceof Error ? error.message : String(error)}`);
          latestVersioningInscription = undefined;
        }
      }
    } else {
      // PATH 2: SUBSEQUENT DEPLOYMENT - Update versioning inscription by spending previous one
      if (!dryRun && VERSIONING_ENABLED) {
        currentInscriptionIndex++;
        callbacks?.onInscriptionStart?.(
          'versioning-metadata',
          currentInscriptionIndex,
          totalInscriptions
        );
        try {
          latestVersioningInscription = await updateVersioningInscription(
            versioningOriginInscription, // origin outpoint of versioning inscription chain
            paymentPk,
            paymentPk, // same key for ordPk
            version,
            entryPoint.urlPath.split('/').pop() || entryPoint.txid + '_' + entryPoint.vout,
            versionDescription || `Version ${version}`,
            destinationAddress,
            satsPerKb
          );
          // Add versioning metadata txid immediately (maintains chronological order)
          const metadataTxid = latestVersioningInscription.split('_')[0];
          txids.add(metadataTxid);

          callbacks?.onInscriptionComplete?.(
            'versioning-metadata',
            `/content/${latestVersioningInscription}`
          );
        } catch (error) {
          // Inscription update failed, but app inscription succeeded
          console.warn(
            '⚠️  Warning: Failed to update versioning inscription. App is deployed but version tracking failed.'
          );
          console.warn(`   Error: ${error instanceof Error ? error.message : String(error)}`);
          console.warn(
            `   This likely means the payment key does not control the versioning inscription.`
          );
          console.warn(`   Original inscription sent to: ${destinationAddress}`);
          console.warn(`   Current payment key controls: ${paymentPk.toAddress().toString()}`);
          console.warn(`   Solution: Use the same payment key for all deployments.`);
        }
      }
    }
  }

  callbacks?.onDeploymentComplete?.(entryPoint.urlPath);

  // Ensure versioning inscription is always set (required for all deployments)
  if (!finalVersioningOriginInscription) {
    throw new Error('Versioning inscription origin was not set. This should not happen.');
  }

  return {
    entryPointUrl: entryPoint.urlPath,
    inscriptions,
    totalCost,
    totalSize,
    txids: Array.from(txids),
    versioningOriginInscription: finalVersioningOriginInscription,
    versioningLatestInscription: latestVersioningInscription,
    version: version,
    versionDescription: versionDescription,
    buildDir,
    destinationAddress,
    ordinalContentUrl: primaryContentUrl,
  };
}

/**
 * Generates a deployment manifest file
 */
export function generateManifest(result: DeploymentResult): DeploymentManifest {
  // Calculate statistics for new vs cached files
  const newFiles = result.inscriptions.filter((f) => !f.cached);
  const cachedFiles = result.inscriptions.filter((f) => f.cached);

  // Count transactions for new file inscriptions
  const newFileTransactions = result.txids.filter((txid) =>
    newFiles.some((file) => file.txid === txid)
  );

  return {
    timestamp: new Date().toISOString(),
    entryPoint: result.entryPointUrl,
    files: result.inscriptions,
    totalFiles: result.inscriptions.length,
    totalCost: result.totalCost,
    totalSize: result.totalSize,
    transactions: result.txids, // All transactions (files + versioning)
    latestVersioningInscription: result.versioningLatestInscription,
    version: result.version,
    versionDescription: result.versionDescription,
    buildDir: result.buildDir,
    destinationAddress: result.destinationAddress,
    ordinalContentUrl: result.ordinalContentUrl,
    newFiles: newFiles.length,
    cachedFiles: cachedFiles.length,
    newTransactions: newFileTransactions.length,
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
  outputPath: string,
  originVersioningInscription: string
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

        // Keep existing originVersioningInscription (origin) - it never changes
        // Only set it if not already set
        if (!history.originVersioningInscription) {
          history.originVersioningInscription = originVersioningInscription;
        }
      } else if ('timestamp' in parsed && 'entryPoint' in parsed) {
        // Old format - migrate to new format
        const oldManifest = parsed as DeploymentManifest;

        // Remove old originVersioningInscription field if it exists for backward compatibility
        const { originVersioningInscription: _, ...cleanedOldManifest } = oldManifest as any;

        history = {
          manifestVersion: '1.0.0',
          originVersioningInscription: originVersioningInscription,
          totalDeployments: 2, // Old deployment + new deployment
          deployments: [cleanedOldManifest, manifest],
        };
      } else {
        // Unknown format - start fresh
        console.warn('⚠️  Warning: Unknown manifest format, creating new history');
        history = createNewHistory(manifest, originVersioningInscription);
      }
    } catch (error) {
      // Error reading/parsing - start fresh
      console.warn('⚠️  Warning: Could not read existing manifest, creating new history');
      history = createNewHistory(manifest, originVersioningInscription);
    }
  } else {
    // No existing manifest - create new history
    history = createNewHistory(manifest, originVersioningInscription);
  }

  // Save updated history
  const json = JSON.stringify(history, null, 2);
  await writeFile(outputPath, json, 'utf-8');

  return history;
}

/**
 * Helper function to create a new deployment history
 */
function createNewHistory(
  manifest: DeploymentManifest,
  originVersioningInscription: string
): DeploymentManifestHistory {
  return {
    manifestVersion: '1.0.0',
    originVersioningInscription: originVersioningInscription,
    totalDeployments: 1,
    deployments: [manifest],
  };
}
