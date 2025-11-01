import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { PrivateKey } from '@bsv/sdk';
import { analyzeBuildDirectory } from './analyzer.js';
import { rewriteFile, injectVersionScript, injectBasePathFix } from './rewriter.js';
import { inscribeFile, estimateInscriptionCost, uploadBFile } from './inscriber.js';
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
import { Utxo } from 'js-1sat-ord';
import { formatError } from './utils/errors.js';
import {
  MANIFEST_FILENAME,
  VERSIONING_ORIGIN_TYPE,
  VERSIONING_METADATA_TYPE,
  CONTENT_PATH_PREFIX,
  OUTPOINT_SEPARATOR,
  DEFAULT_SATS_PER_KB,
  DEFAULT_INSCRIPTION_VOUT,
  INSCRIPTION_DELAY_MS,
  MANIFEST_VERSION,
  MOCK_VERSIONING_TXID,
} from './utils/constants.js';
import {
  extractOutpointFromFile,
  calculateDependencyHash,
  suggestNextVersion,
  isIndexHtmlFile,
} from './utils/inscription.js';

// ============================================================================
// Orchestrator-specific Helper Functions
// ============================================================================

/**
 * Initializes payment key (random for dry-run, from WIF otherwise)
 */
function initializePaymentKey(paymentKey: string, dryRun: boolean): PrivateKey {
  if (dryRun) {
    return PrivateKey.fromRandom();
  }
  return PrivateKey.fromWif(paymentKey);
}

/**
 * Calculates total number of inscriptions for progress tracking
 */
function calculateTotalInscriptions(fileCount: number, isFirstDeployment: boolean): number {
  let total = fileCount;
  if (isFirstDeployment) total += 1; // Empty versioning inscription
  total += 1; // Metadata update inscription
  return total;
}

// ============================================================================
// Manifest Helper Functions
// ============================================================================

/**
 * Result of loading and parsing manifest data
 */
interface ManifestData {
  existingVersions: string[];
  previousInscriptions: Map<string, InscribedFile>;
  versioningOrigin?: string;
}

/**
 * Loads manifest file and extracts versions and previous inscriptions
 * Consolidates duplicate manifest loading logic
 */
async function loadManifestData(manifestPath: string): Promise<ManifestData | null> {
  if (!existsSync(manifestPath)) {
    return null;
  }

  try {
    const manifestJson = await readFile(manifestPath, 'utf-8');
    const manifestData = JSON.parse(manifestJson);

    const result: ManifestData = {
      existingVersions: [],
      previousInscriptions: new Map(),
    };

    // Handle both old (single deployment) and new (history) format
    if ('manifestVersion' in manifestData && 'deployments' in manifestData) {
      // New format
      const history = manifestData as DeploymentManifestHistory;

      // Extract existing versions
      result.existingVersions = history.deployments
        .map((d) => d.version)
        .filter((v): v is string => v !== undefined);

      // Extract versioning origin
      result.versioningOrigin = history.originVersioningInscription;

      // Build lookup map from most recent deployment only
      if (history.deployments.length > 0) {
        const recentDeployment = history.deployments[history.deployments.length - 1];
        for (const file of recentDeployment.files) {
          if (file.contentHash) {
            result.previousInscriptions.set(file.originalPath, file);
          }
        }
      }
    } else if ('timestamp' in manifestData && 'entryPoint' in manifestData) {
      // Old format - single deployment
      const manifest = manifestData as DeploymentManifest;

      if (manifest.version) {
        result.existingVersions = [manifest.version];
      }

      // Load previous inscriptions for cache
      for (const file of manifest.files) {
        if (file.contentHash) {
          result.previousInscriptions.set(file.originalPath, file);
        }
      }
    }

    return result;
  } catch (error) {
    // Failed to load manifest - not critical
    return null;
  }
}

/**
 * Prepares index.html with injected scripts
 */
async function prepareIndexHtml(
  htmlContent: string,
  versioningOriginInscription: string | undefined,
  dryRun: boolean
): Promise<Buffer> {
  // Inject base path fix script (MUST run before React loads)
  let processedHtml = await injectBasePathFix(htmlContent);

  if (dryRun) {
    console.log('📝 Base path fix script injected (dry-run mode)');
  }

  // Inject version script if inscription origin is known
  if (versioningOriginInscription) {
    processedHtml = await injectVersionScript(processedHtml, versioningOriginInscription);

    if (dryRun) {
      console.log('📝 Version redirect script injected (dry-run mode)');
    }
  }

  return Buffer.from(processedHtml, 'utf-8');
}

/**
 * Determines if a previous inscription can be reused (cached)
 */
function canReuseInscription(
  filePath: string,
  fileRef: any, // FileReference type from analyzer
  previousInscription: InscribedFile | undefined,
  urlMap: Map<string, string>
): boolean {
  // Early rejections
  if (!previousInscription) return false;
  if (isIndexHtmlFile(filePath)) return false; // Always re-inscribe index.html
  if (previousInscription.contentHash !== fileRef.contentHash) return false;

  // No dependencies - can reuse
  if (fileRef.dependencies.length === 0) return true;

  // Has dependencies - check dependency hash
  const currentDepHash = calculateDependencyHash(fileRef.dependencies, urlMap);
  return previousInscription.dependencyHash === currentDepHash;
}

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

  // Initialize payment key and address
  const paymentPk = initializePaymentKey(paymentKey, dryRun || false);
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

  // Step 1.5: Setup versioning variables
  let finalVersioningOriginInscription = versioningOriginInscription;
  let changeUtxo: any = undefined; // Track change from previous transaction

  // Step 1.6-1.8: Load manifest data (consolidates duplicate checks and cache loading)
  const manifestData = await loadManifestData(MANIFEST_FILENAME);

  // Check for duplicate version (LOCAL CHECK)
  if (manifestData && manifestData.existingVersions.includes(version)) {
    const newVersion = suggestNextVersion(version);
    throw new Error(
      `Version "${version}" already exists in local manifest.\n` +
        `  Please use a different version tag (e.g., "${newVersion}" or increment the version number).\n` +
        `  Existing versions: ${manifestData.existingVersions.join(', ')}`
    );
  }

  // Validate version doesn't exist on-chain (SUBSEQUENT DEPLOYMENTS ONLY)
  if (versioningOriginInscription && !dryRun && VERSIONING_ENABLED) {
    try {
      await checkVersionExists(versioningOriginInscription, version);
    } catch (error) {
      throw new Error(`Cannot proceed with deployment: ${formatError(error)}`);
    }
  }

  // Extract previous inscriptions for cache
  const previousInscriptions =
    manifestData?.previousInscriptions || new Map<string, InscribedFile>();

  // Calculate total inscriptions for progress tracking
  const isFirstDeployment = !versioningOriginInscription;
  const totalInscriptions = calculateTotalInscriptions(order.length, isFirstDeployment);

  let currentInscriptionIndex = 0;

  // Step 1.9: Deploy empty versioning inscription (FIRST DEPLOYMENT ONLY)
  // This happens BEFORE HTML inscription so we can inject the origin into the redirect script
  // The empty inscription becomes the origin, and we'll spend it after HTML deployment to add metadata

  // Initialize txids Set early to maintain chronological order
  const txids = new Set<string>();

  if (!versioningOriginInscription && !dryRun && VERSIONING_ENABLED) {
    currentInscriptionIndex++;
    callbacks?.onInscriptionStart?.(
      VERSIONING_ORIGIN_TYPE,
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
      const originTxid = finalVersioningOriginInscription.split(OUTPOINT_SEPARATOR)[0];
      txids.add(originTxid);

      callbacks?.onInscriptionComplete?.(
        VERSIONING_ORIGIN_TYPE,
        `${CONTENT_PATH_PREFIX}${finalVersioningOriginInscription}`
      );
    } catch (error) {
      throw new Error(`Failed to deploy versioning inscription: ${formatError(error)}`);
    }
  } else if (dryRun && !versioningOriginInscription) {
    // DRY RUN MODE - Create mock versioning inscription origin
    finalVersioningOriginInscription = `${MOCK_VERSIONING_TXID}${OUTPOINT_SEPARATOR}${DEFAULT_INSCRIPTION_VOUT}`;
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
    const shouldReuseInscription = canReuseInscription(
      filePath,
      fileRef,
      previousInscription,
      urlMap
    );

    // If we can reuse, skip inscription and add to urlMap
    if (shouldReuseInscription && previousInscription) {
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
    let content: Buffer | undefined;

    if (hasDependencies) {
      // Rewrite the file content to use ordfs URLs
      content = await rewriteFile(absolutePath, buildDir, filePath, fileRef.contentType, urlMap);
    }

    // Inject scripts into index.html if needed
    let result: { inscription: InscribedFile; changeUtxo?: Utxo } | undefined;
    const isHtmlFile = isIndexHtmlFile(filePath);

    if (isHtmlFile) {
      // Read the HTML content if not already read, or convert Buffer to string
      const htmlContent = content
        ? content.toString('utf-8')
        : await readFile(absolutePath, 'utf-8');

      // Inject base path fix and version scripts
      content = await prepareIndexHtml(
        htmlContent,
        finalVersioningOriginInscription,
        dryRun || false
      );

      // Inscribe the file
      result = await inscribeFile(
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
    } else {
      result = await uploadBFile(
        absolutePath,
        filePath,
        fileRef.contentType,
        paymentPk,
        indexer,
        content,
        satsPerKb,
        dryRun,
        changeUtxo
      );
    }

    // Compute dependency hash for files with dependencies
    const dependencyHash = hasDependencies
      ? calculateDependencyHash(fileRef.dependencies, urlMap)
      : undefined;

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
    totalCost += estimateInscriptionCost(result.inscription.size, satsPerKb || DEFAULT_SATS_PER_KB);

    // Small delay between inscriptions (only needed if NOT using change UTXO)
    if (i < order.length - 1 && !changeUtxo) {
      await new Promise((resolve) => setTimeout(resolve, INSCRIPTION_DELAY_MS));
    }
  }

  // Find the entry point (index.html)
  const entryPoint = inscriptions.find((i) => isIndexHtmlFile(i.originalPath));

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
        latestVersioningInscription = `${finalVersioningOriginInscription.split(OUTPOINT_SEPARATOR)[0]}${OUTPOINT_SEPARATOR}1`;
      } else if (VERSIONING_ENABLED) {
        currentInscriptionIndex++;
        callbacks?.onInscriptionStart?.(
          VERSIONING_METADATA_TYPE,
          currentInscriptionIndex,
          totalInscriptions
        );
        try {
          const entryPointOutpoint = extractOutpointFromFile(entryPoint);

          latestVersioningInscription = await updateVersioningInscription(
            finalVersioningOriginInscription,
            paymentPk,
            paymentPk,
            version,
            entryPointOutpoint,
            versionDescription || `Version ${version}`,
            destinationAddress,
            satsPerKb
          );
          const metadataTxid = latestVersioningInscription.split(OUTPOINT_SEPARATOR)[0];
          txids.add(metadataTxid);

          callbacks?.onInscriptionComplete?.(
            VERSIONING_METADATA_TYPE,
            `${CONTENT_PATH_PREFIX}${latestVersioningInscription}`
          );
        } catch (error) {
          console.error('❌ Failed to update versioning inscription with version metadata.');
          console.error(`   Error: ${formatError(error)}`);
          throw error; // Fail deployment - don't swallow the error
        }
      }
    } else {
      // PATH 2: SUBSEQUENT DEPLOYMENT - Update versioning inscription by spending previous one
      if (!dryRun && VERSIONING_ENABLED) {
        currentInscriptionIndex++;
        callbacks?.onInscriptionStart?.(
          VERSIONING_METADATA_TYPE,
          currentInscriptionIndex,
          totalInscriptions
        );
        try {
          latestVersioningInscription = await updateVersioningInscription(
            versioningOriginInscription,
            paymentPk,
            paymentPk,
            version,
            extractOutpointFromFile(entryPoint),
            versionDescription || `Version ${version}`,
            destinationAddress,
            satsPerKb
          );
          const metadataTxid = latestVersioningInscription.split(OUTPOINT_SEPARATOR)[0];
          txids.add(metadataTxid);

          callbacks?.onInscriptionComplete?.(
            VERSIONING_METADATA_TYPE,
            `${CONTENT_PATH_PREFIX}${latestVersioningInscription}`
          );
        } catch (error) {
          console.error('❌ Failed to update versioning inscription. Deployment aborted.');
          console.error(`   Error: ${formatError(error)}`);
          console.error(
            `   This likely means the payment key does not control the versioning inscription.`
          );
          console.error(`   Original inscription sent to: ${destinationAddress}`);
          console.error(`   Current payment key controls: ${paymentPk.toAddress().toString()}`);
          console.error(`   Solution: Use the same payment key for all deployments.`);
          throw error; // Fail deployment - don't swallow the error
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
          manifestVersion: MANIFEST_VERSION,
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
    manifestVersion: MANIFEST_VERSION,
    originVersioningInscription: originVersioningInscription,
    totalDeployments: 1,
    deployments: [manifest],
  };
}
