/**
 * Wave-Based Deployment Orchestrator
 *
 * High-level orchestration of deployment workflow using modular inscription handlers.
 * This orchestrator coordinates between various specialized modules for a clean deployment flow.
 */

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { PrivateKey } from '@bsv/sdk';
import { analyzeBuildDirectory } from '../analysis/index.js';
import { createIndexer, config as envConfig } from '../../lib/config.js';
import { calculateDependencyWaves } from './jobBuilder.js';
import { processWaves } from './waveProcessor.js';
import {
  handleVersioningOriginInscription,
  handleVersioningMetadataUpdate,
} from '../versioning/inscriber.js';
import { handleServiceWorkerInscription } from '../service-worker/inscriber.js';
import { handleHtmlInscription } from '../html/inscriber.js';
import { analyzeCachedFiles } from '../caching/analyzer.js';
import { checkVersionExists, VERSIONING_ENABLED } from '../versioning/versioningHandler.js';
import type {
  DeploymentConfig,
  DeploymentResult,
  DeploymentManifest,
  DeploymentManifestHistory,
  OrchestratorCallbacks,
  WaveJobContext,
} from './orchestration.types.js';
import type { InscribedFile } from '../inscription/inscription.types.js';
import { formatError } from '../../utils/errors.js';
import {
  isIndexHtmlFile,
  suggestNextVersion,
  extractOutpointFromFile,
} from '../inscription/utils.js';
import {
  MANIFEST_FILENAME,
  MANIFEST_VERSION,
  CACHED_FILE_DELIMITER,
  DEFAULT_SATS_PER_KB,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_CHUNK_THRESHOLD,
} from '../../utils/constants.js';

// ============================================================================
// Helper Functions
// ============================================================================

function initializePaymentKey(paymentKey: string, dryRun: boolean): PrivateKey {
  if (dryRun) {
    return PrivateKey.fromRandom();
  }
  return PrivateKey.fromWif(paymentKey);
}

interface ManifestData {
  existingVersions: string[];
  previousInscriptions: Map<string, InscribedFile>;
  versioningOrigin?: string;
  htmlOrigin?: string;
}

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

    if ('manifestVersion' in manifestData && 'deployments' in manifestData) {
      const history = manifestData as DeploymentManifestHistory;
      result.existingVersions = history.deployments
        .map((d) => d.version)
        .filter((v): v is string => v !== undefined);
      result.versioningOrigin = history.originVersioningInscription;
      result.htmlOrigin = history.originHtmlInscription;

      if (history.deployments.length > 0) {
        const recentDeployment = history.deployments[history.deployments.length - 1];

        // Load all files from manifest (new files with full details)
        for (const file of recentDeployment.files) {
          result.previousInscriptions.set(file.originalPath, file);
        }

        // Load cached files (minimal string references from previous deployments)
        // Format: "path::*::txid_vout"
        // Search backwards through deployment history to find full file details
        if (Array.isArray(recentDeployment.cachedFiles)) {
          for (const cachedStr of recentDeployment.cachedFiles) {
            // Parse the cached file string
            const [originalPath, outpoint] = cachedStr.split(CACHED_FILE_DELIMITER);
            const [txid, voutStr] = outpoint.split('_');
            const vout = parseInt(voutStr, 10);

            // Search previous deployments for this file
            let foundFile: InscribedFile | undefined;
            for (let i = history.deployments.length - 1; i >= 0 && !foundFile; i--) {
              const deployment = history.deployments[i];
              foundFile = deployment.files.find(
                (f) => f.originalPath === originalPath && f.txid === txid && f.vout === vout
              );
            }

            if (foundFile) {
              result.previousInscriptions.set(originalPath, foundFile);
            }
          }
        }
      }
    } else if ('timestamp' in manifestData && 'entryPoint' in manifestData) {
      const manifest = manifestData as DeploymentManifest;
      if (manifest.version) {
        result.existingVersions = [manifest.version];
      }

      // Load all new files from manifest
      for (const file of manifest.files) {
        result.previousInscriptions.set(file.originalPath, file);
      }

      // For backward compatibility: old manifests may have cached files in the files array
      // (identified by the cached flag). These are already loaded above.
    }

    return result;
  } catch {
    return null;
  }
}

// ============================================================================
// Main Deployment Function
// ============================================================================

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

  const primaryContentUrl = ordinalContentUrl || envConfig.ordinalContentUrl;
  const paymentPk = initializePaymentKey(paymentKey, dryRun || false);
  const destinationAddress = paymentPk.toAddress().toString();
  const indexer = createIndexer(ordinalIndexerUrl);

  // Step 1: Analyze build directory
  callbacks?.onAnalysisStart?.();
  const { files, graph, order } = await analyzeBuildDirectory(buildDir);
  callbacks?.onAnalysisComplete?.(files.length);

  if (files.length === 0) {
    throw new Error(`No files found in build directory: ${buildDir}`);
  }

  // Step 2: Load manifest and check for version conflicts
  const manifestData = await loadManifestData(MANIFEST_FILENAME);

  if (manifestData && manifestData.existingVersions.includes(version)) {
    const newVersion = suggestNextVersion(version);
    throw new Error(
      `Version "${version}" already exists in local manifest.\n` +
        `  Please use a different version tag (e.g., "${newVersion}" or increment the version number).\n` +
        `  Existing versions: ${manifestData.existingVersions.join(', ')}`
    );
  }

  if (versioningOriginInscription && !dryRun && VERSIONING_ENABLED) {
    try {
      await checkVersionExists(versioningOriginInscription, version);
    } catch (error) {
      throw new Error(`Cannot proceed with deployment: ${formatError(error)}`);
    }
  }

  const previousInscriptions =
    manifestData?.previousInscriptions || new Map<string, InscribedFile>();
  const htmlOriginInscription = manifestData?.htmlOrigin;

  // Step 3: Analyze cache
  const cacheAnalysis = await analyzeCachedFiles(
    order,
    graph,
    previousInscriptions,
    primaryContentUrl,
    callbacks
  );

  // Step 4: Deploy versioning origin inscription (first deployment only)
  const versioningOriginResult = await handleVersioningOriginInscription(
    versioningOriginInscription,
    dryRun || false,
    paymentPk,
    appName || 'ReactApp',
    destinationAddress,
    satsPerKb,
    callbacks,
    order.length + 2
  );

  const txids = new Set<string>();
  if (versioningOriginResult.txid) {
    txids.add(versioningOriginResult.txid);
  }

  // Step 5: Calculate dependency waves and separate HTML files
  const { waves } = calculateDependencyWaves(graph);
  const htmlFiles: string[] = [];
  const nonHtmlWaves: string[][] = [];

  for (const wave of waves) {
    const waveHtmlFiles = wave.filter((f) => isIndexHtmlFile(f));
    const waveNonHtmlFiles = wave.filter((f) => !isIndexHtmlFile(f));

    if (waveHtmlFiles.length > 0) {
      htmlFiles.push(...waveHtmlFiles);
    }
    if (waveNonHtmlFiles.length > 0) {
      nonHtmlWaves.push(waveNonHtmlFiles);
    }
  }

  callbacks?.onProgress?.(
    `📊 Wave structure: ${nonHtmlWaves.length} wave(s), HTML inscribed separately`
  );

  // Step 6: Process waves
  const jobContext: WaveJobContext = {
    buildDir,
    destinationAddress,
    versioningOriginInscription: versioningOriginResult.finalVersioningOriginInscription,
    chunkThreshold: DEFAULT_CHUNK_THRESHOLD,
    chunkSize: DEFAULT_CHUNK_SIZE,
    disableChunking: false,
    serviceWorkerUrl: undefined,
  };

  const urlMap = new Map<string, string>();
  const spentUtxos = new Set<string>();

  const waveResults = await processWaves(
    nonHtmlWaves,
    graph,
    urlMap,
    cacheAnalysis.cachedFiles,
    cacheAnalysis.cachedChunkManifests,
    previousInscriptions,
    jobContext,
    paymentPk,
    indexer,
    satsPerKb || DEFAULT_SATS_PER_KB,
    dryRun || false,
    versioningOriginResult.seedUtxo,
    spentUtxos,
    callbacks
  );

  let totalCost = waveResults.totalCost;
  let totalSize = waveResults.totalSize;

  // Add wave txids
  for (const txid of waveResults.txids) {
    txids.add(txid);
  }

  // Step 7: Inscribe Service Worker (if needed)
  if (waveResults.allChunkManifests.length > 0) {
    const swResult = await handleServiceWorkerInscription(
      waveResults.allChunkManifests,
      previousInscriptions,
      primaryContentUrl,
      paymentPk,
      indexer,
      destinationAddress,
      satsPerKb || DEFAULT_SATS_PER_KB,
      dryRun || false,
      waveResults.inscriptions.length,
      order.length + 2,
      spentUtxos,
      callbacks
    );

    waveResults.inscriptions.push(swResult.serviceWorkerInscription);
    totalCost += swResult.totalCost;
    if (!swResult.serviceWorkerInscription.cached) {
      totalSize += swResult.serviceWorkerInscription.size;
    }
    if (swResult.splitTxid) {
      txids.add(swResult.splitTxid);
    }
    if (swResult.serviceWorkerInscription.txid) {
      txids.add(swResult.serviceWorkerInscription.txid);
    }

    jobContext.serviceWorkerUrl = swResult.serviceWorkerInscription.urlPath;
  }

  // Step 8: Inscribe HTML as 1-sat ordinal chain
  const htmlResult = await handleHtmlInscription(
    htmlFiles,
    graph,
    buildDir,
    urlMap,
    versioningOriginResult.finalVersioningOriginInscription,
    jobContext.serviceWorkerUrl,
    htmlOriginInscription,
    paymentPk,
    indexer,
    destinationAddress,
    satsPerKb,
    dryRun || false,
    version,
    callbacks
  );

  waveResults.inscriptions.push(htmlResult.entryPoint);
  totalSize += htmlResult.entryPoint.size;
  if (htmlResult.txid) {
    txids.add(htmlResult.txid);
  }

  // Step 9: Update versioning inscription
  const versioningMetadataResult = await handleVersioningMetadataUpdate(
    versioningOriginResult.finalVersioningOriginInscription,
    versioningOriginInscription,
    htmlResult.entryPoint,
    paymentPk,
    version,
    versionDescription,
    destinationAddress,
    satsPerKb,
    dryRun || false,
    callbacks
  );

  if (versioningMetadataResult.txid) {
    txids.add(versioningMetadataResult.txid);
  }

  callbacks?.onDeploymentComplete?.(htmlResult.entryPoint.urlPath);

  return {
    entryPointUrl: htmlResult.entryPoint.urlPath,
    inscriptions: waveResults.inscriptions,
    totalCost,
    totalSize,
    txids: Array.from(txids),
    versioningOriginInscription: versioningOriginResult.finalVersioningOriginInscription,
    versioningLatestInscription: versioningMetadataResult.latestVersioningInscription,
    htmlOriginInscription: htmlResult.finalHtmlOriginInscription,
    htmlLatestInscription: extractOutpointFromFile(htmlResult.entryPoint),
    version,
    versionDescription,
    buildDir,
    destinationAddress,
    ordinalContentUrl: primaryContentUrl,
  };
}

// ============================================================================
// Manifest Functions
// ============================================================================

export function generateManifest(result: DeploymentResult): DeploymentManifest {
  const newFiles = result.inscriptions.filter((f) => !f.cached);
  const cachedFilesFull = result.inscriptions.filter((f) => f.cached);

  // Create minimal cached file string array (format: "path::*::txid_vout")
  const cachedFiles = cachedFilesFull.map(
    (f) => `${f.originalPath}${CACHED_FILE_DELIMITER}${f.txid}_${f.vout}`
  );

  return {
    timestamp: new Date().toISOString(),
    entryPoint: result.entryPointUrl,
    files: newFiles,
    cachedFiles,
    totalFiles: newFiles.length,
    totalCost: result.totalCost,
    totalSize: result.totalSize,
    transactions: result.txids,
    latestVersioningInscription: result.versioningLatestInscription,
    latestHtmlInscription: result.htmlLatestInscription,
    version: result.version,
    versionDescription: result.versionDescription,
    buildDir: result.buildDir,
    destinationAddress: result.destinationAddress,
    ordinalContentUrl: result.ordinalContentUrl,
    newFiles: newFiles.length,
    cachedCount: cachedFiles.length,
    newTransactions: result.txids.length,
  };
}

export async function saveManifest(
  manifest: DeploymentManifest,
  outputPath: string
): Promise<void> {
  const json = JSON.stringify(manifest, null, 2);
  await writeFile(outputPath, json, 'utf-8');
}

export async function saveManifestWithHistory(
  manifest: DeploymentManifest,
  outputPath: string,
  originVersioningInscription: string,
  originHtmlInscription?: string
): Promise<DeploymentManifestHistory> {
  let history: DeploymentManifestHistory;

  if (existsSync(outputPath)) {
    try {
      const existing = await readFile(outputPath, 'utf-8');
      const parsed = JSON.parse(existing);

      if ('manifestVersion' in parsed && 'deployments' in parsed) {
        history = parsed as DeploymentManifestHistory;

        history.deployments.push(manifest);
        history.totalDeployments = history.deployments.length;
        if (!history.originVersioningInscription) {
          history.originVersioningInscription = originVersioningInscription;
        }
        if (!history.originHtmlInscription && originHtmlInscription) {
          history.originHtmlInscription = originHtmlInscription;
        }
      } else if ('timestamp' in parsed && 'entryPoint' in parsed) {
        const oldManifest = parsed as DeploymentManifest;

        const {
          originVersioningInscription,
          originHtmlInscription: oldHtmlOrigin,
          ...cleanedOldManifest
        } = oldManifest as DeploymentManifest & {
          originVersioningInscription?: string;
          originHtmlInscription?: string;
        };
        history = {
          manifestVersion: MANIFEST_VERSION,
          originVersioningInscription: originVersioningInscription,
          originHtmlInscription: originHtmlInscription || oldHtmlOrigin,
          totalDeployments: 2,
          deployments: [cleanedOldManifest, manifest],
        };
      } else {
        history = createNewHistory(manifest, originVersioningInscription, originHtmlInscription);
      }
    } catch {
      history = createNewHistory(manifest, originVersioningInscription, originHtmlInscription);
    }
  } else {
    history = createNewHistory(manifest, originVersioningInscription, originHtmlInscription);
  }

  const json = JSON.stringify(history, null, 2);
  await writeFile(outputPath, json, 'utf-8');

  return history;
}

function createNewHistory(
  manifest: DeploymentManifest,
  originVersioningInscription: string,
  originHtmlInscription?: string
): DeploymentManifestHistory {
  return {
    manifestVersion: MANIFEST_VERSION,
    originVersioningInscription: originVersioningInscription,
    originHtmlInscription,
    totalDeployments: 1,
    deployments: [manifest],
  };
}
