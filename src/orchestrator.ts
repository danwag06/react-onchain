/**
 * New Wave-Based Orchestrator
 *
 * This orchestrator uses the parallel inscription system with wave-based processing
 * that respects topological dependencies while maximizing parallelism.
 */

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { createHash } from 'crypto';
import { PrivateKey } from '@bsv/sdk';
import { analyzeBuildDirectory } from './analyzer.js';
import { createIndexer, config as envConfig } from './config.js';
import {
  calculateDependencyWaves,
  prepareWaveJobs,
  processWaveResults,
  type WaveJobContext,
} from './orchestratorJobBuilder.js';
import { shouldChunkFile } from './chunker.js';
import { parallelInscribe } from './parallelInscriber.js';
import { generateChunkReassemblyServiceWorker } from './serviceWorkerGenerator.js';
import {
  deployVersioningInscription,
  updateVersioningInscription,
  checkVersionExists,
  VERSIONING_ENABLED,
} from './versioningInscriptionHandler.js';
import type {
  DeploymentConfig,
  DeploymentResult,
  DeploymentManifest,
  DeploymentManifestHistory,
  InscribedFile,
  ChunkManifest,
} from './types.js';
import { formatError } from './utils/errors.js';
import {
  MANIFEST_FILENAME,
  VERSIONING_ORIGIN_TYPE,
  VERSIONING_METADATA_TYPE,
  CONTENT_PATH_PREFIX,
  OUTPOINT_SEPARATOR,
  DEFAULT_SATS_PER_KB,
  DEFAULT_INSCRIPTION_VOUT,
  MANIFEST_VERSION,
  MOCK_VERSIONING_TXID,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_CHUNK_THRESHOLD,
  DEFAULT_CHUNK_BATCH_SIZE,
} from './utils/constants.js';
import {
  extractOutpointFromFile,
  calculateDependencyHash,
  suggestNextVersion,
  isIndexHtmlFile,
} from './utils/inscription.js';

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

      if (history.deployments.length > 0) {
        const recentDeployment = history.deployments[history.deployments.length - 1];
        for (const file of recentDeployment.files) {
          // Load all files from manifest (not just those with contentHash)
          // For chunked files, the chunks array is enough to verify reusability
          result.previousInscriptions.set(file.originalPath, file);
        }
      }
    } else if ('timestamp' in manifestData && 'entryPoint' in manifestData) {
      const manifest = manifestData as DeploymentManifest;
      if (manifest.version) {
        result.existingVersions = [manifest.version];
      }
      for (const file of manifest.files) {
        // Load all files from manifest (not just those with contentHash)
        // For chunked files, the chunks array is enough to verify reusability
        result.previousInscriptions.set(file.originalPath, file);
      }
    }

    return result;
  } catch (error) {
    return null;
  }
}

function canReuseInscription(
  filePath: string,
  fileRef: any,
  previousInscription: InscribedFile | undefined,
  urlMap: Map<string, string>
): boolean {
  if (!previousInscription) return false;
  if (isIndexHtmlFile(filePath)) return false;

  // Content hash comparison
  if (previousInscription.contentHash) {
    // Previous inscription has content hash - compare directly
    if (previousInscription.contentHash !== fileRef.contentHash) return false;
  } else if (previousInscription.isChunked && previousInscription.chunks) {
    // For chunked files from old deployments without contentHash,
    // we can still reuse if we calculate the hash from stored chunk hashes
    // The fileRef.contentHash is the hash of the entire file content
    // We need to verify this matches the concatenation of previous chunks
    // For now, we'll trust that if chunks exist and file size matches, we can reuse
    // This is safe because chunks contain full file data
    if (previousInscription.size !== fileRef.fileSize) return false;
    // Size matches - assume content is the same (chunks are immutable on chain)
  } else {
    // No contentHash and not chunked (or chunks missing) - can't verify, must re-inscribe
    return false;
  }

  if (fileRef.dependencies.length === 0) return true;

  const currentDepHash = calculateDependencyHash(fileRef.dependencies, urlMap);
  return previousInscription.dependencyHash === currentDepHash;
}

export interface ChunkedFileInfo {
  filename: string;
  chunkCount: number;
  isServiceWorker: boolean;
  urlPath: string;
}

export interface OrchestratorCallbacks {
  onAnalysisStart?: () => void;
  onAnalysisComplete?: (fileCount: number) => void;
  onCacheAnalysis?: (
    cachedCount: number,
    newCount: number,
    cachedFiles: string[],
    chunkedFilesInfo: ChunkedFileInfo[]
  ) => void;
  onInscriptionStart?: (file: string, current: number, total: number) => void;
  onInscriptionComplete?: (file: string, url: string) => void;
  onInscriptionSkipped?: (file: string, url: string, chunkCount?: number) => void;
  onDeploymentComplete?: (entryPointUrl: string) => void;
  onProgress?: (message: string) => void; // Dynamic progress updates
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
    chunkBatchSize,
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

  // Step 2.5: Analyze which files can be cached
  let cachedCount = 0;
  const cachedFiles: string[] = [];
  const chunkedFilesInfo: ChunkedFileInfo[] = [];
  const tempUrlMap = new Map<string, string>(); // Temporary map for cache analysis

  for (const filePath of order) {
    const node = graph.get(filePath);
    if (!node) continue;

    const fileRef = node.file;
    const previousInscription = previousInscriptions.get(filePath);

    // Check if we can reuse (same logic as later in wave processing)
    const shouldReuse = canReuseInscription(filePath, fileRef, previousInscription, tempUrlMap);

    if (shouldReuse && previousInscription) {
      cachedCount++;
      cachedFiles.push(filePath);
      tempUrlMap.set(filePath, previousInscription.urlPath);

      // Track chunked files with chunk counts
      if (previousInscription.isChunked && previousInscription.chunks) {
        chunkedFilesInfo.push({
          filename: filePath,
          chunkCount: previousInscription.chunks.length,
          isServiceWorker: false,
          urlPath: previousInscription.urlPath,
        });
      }
    }
  }

  // Check if service worker can be cached (we need to peek ahead)
  // Collect all chunk manifests from cached chunked files
  const cachedChunkManifests: ChunkManifest[] = [];
  const hasChunkedFiles = order.some((filePath) => {
    const node = graph.get(filePath);
    if (!node) return false;
    const isChunked = shouldChunkFile(node.file.fileSize, filePath, DEFAULT_CHUNK_THRESHOLD);

    // If this file is chunked and cached, build its manifest now
    if (isChunked && cachedFiles.includes(filePath)) {
      const prevInscription = previousInscriptions.get(filePath);
      if (prevInscription?.isChunked && prevInscription.chunks) {
        const fileRef = node.file;
        const manifest: ChunkManifest = {
          version: '1.0',
          originalPath: filePath,
          mimeType: fileRef.contentType,
          totalSize: prevInscription.size,
          chunkSize: prevInscription.chunks[0]?.size || 0,
          chunks: prevInscription.chunks.map((c) => ({
            index: c.index,
            txid: c.txid,
            vout: c.vout,
            urlPath: `/content/${c.txid}_${c.vout}`,
            size: c.size,
          })),
        };
        cachedChunkManifests.push(manifest);
      }
    }

    return isChunked;
  });

  if (hasChunkedFiles) {
    // We'll have a service worker - check if it can be cached
    // Generate SW now with cached chunk manifests to calculate hash
    const previousSW = previousInscriptions.get('chunk-reassembly-sw.js');

    if (cachedChunkManifests.length > 0 && previousSW) {
      // Generate SW with cached manifests to check if hash matches
      const swCode = generateChunkReassemblyServiceWorker(cachedChunkManifests, primaryContentUrl);
      const swBuffer = Buffer.from(swCode, 'utf-8');
      const swContentHash = createHash('sha256').update(swBuffer).digest('hex');

      // Check if we can reuse the cached SW
      if (previousSW.contentHash === swContentHash) {
        cachedCount++;
        cachedFiles.push('chunk-reassembly-sw.js');
        chunkedFilesInfo.push({
          filename: 'chunk-reassembly-sw.js',
          chunkCount: 0,
          isServiceWorker: true,
          urlPath: previousSW.urlPath,
        });
      }
    }
  }

  const newCount = files.length + (hasChunkedFiles ? 1 : 0) - cachedCount;
  callbacks?.onCacheAnalysis?.(cachedCount, newCount, cachedFiles, chunkedFilesInfo);

  // Step 3: Deploy empty versioning inscription (FIRST DEPLOYMENT ONLY)
  let finalVersioningOriginInscription = versioningOriginInscription;
  let seedUtxo: any = undefined; // Change UTXO from versioning inscription to use for first wave
  const txids = new Set<string>();
  const isFirstDeployment = !versioningOriginInscription;

  if (!versioningOriginInscription && !dryRun && VERSIONING_ENABLED) {
    callbacks?.onInscriptionStart?.(VERSIONING_ORIGIN_TYPE, 1, order.length + 2);
    try {
      const versioningResult = await deployVersioningInscription(
        paymentPk,
        appName || 'ReactApp',
        destinationAddress,
        satsPerKb
      );
      finalVersioningOriginInscription = versioningResult.outpoint;
      seedUtxo = versioningResult.changeUtxo; // Capture change UTXO to avoid indexer timing issues

      const originTxid = finalVersioningOriginInscription.split(OUTPOINT_SEPARATOR)[0];
      txids.add(originTxid);
      callbacks?.onInscriptionComplete?.(
        VERSIONING_ORIGIN_TYPE,
        `${CONTENT_PATH_PREFIX}${finalVersioningOriginInscription}`
      );

      if (seedUtxo) {
        callbacks?.onProgress?.(
          `  ✓ Change UTXO captured: ${seedUtxo.txid}:${seedUtxo.vout} (${seedUtxo.satoshis} sats)`
        );
      }
    } catch (error) {
      throw new Error(`Failed to deploy versioning inscription: ${formatError(error)}`);
    }
  } else if (dryRun && !versioningOriginInscription) {
    finalVersioningOriginInscription = `${MOCK_VERSIONING_TXID}${OUTPOINT_SEPARATOR}${DEFAULT_INSCRIPTION_VOUT}`;
  }

  // Step 4: Calculate dependency waves
  const { waves } = calculateDependencyWaves(graph);

  // Step 4.5: Reorganize waves to ensure HTML is processed last
  // This allows us to inscribe the Service Worker before HTML
  const htmlWave: string[] = [];
  const nonHtmlWaves: string[][] = [];

  for (const wave of waves) {
    const htmlFiles = wave.filter((f) => isIndexHtmlFile(f));
    const nonHtmlFiles = wave.filter((f) => !isIndexHtmlFile(f));

    if (htmlFiles.length > 0) {
      htmlWave.push(...htmlFiles);
    }
    if (nonHtmlFiles.length > 0) {
      nonHtmlWaves.push(nonHtmlFiles);
    }
  }

  // Reconstruct waves: all non-HTML waves first, then HTML wave last
  const reorganizedWaves = [...nonHtmlWaves];
  if (htmlWave.length > 0) {
    reorganizedWaves.push(htmlWave);
  }

  callbacks?.onProgress?.(
    `📊 Wave structure: ${reorganizedWaves.length} wave(s), HTML in final wave`
  );

  // Step 5: Process files wave by wave
  const urlMap = new Map<string, string>();
  const inscriptions: InscribedFile[] = [];
  const allChunkManifests: ChunkManifest[] = [];
  // Initialize with cached chunk manifests
  allChunkManifests.push(...cachedChunkManifests);
  let totalCost = 0;
  let totalSize = 0;
  const spentUtxos = new Set<string>(); // Track spent UTXOs across waves (format: txid:vout)
  let serviceWorkerInscription: InscribedFile | undefined;

  const jobContext: WaveJobContext = {
    buildDir,
    destinationAddress,
    versioningOriginInscription: finalVersioningOriginInscription,
    chunkThreshold: DEFAULT_CHUNK_THRESHOLD,
    chunkSize: DEFAULT_CHUNK_SIZE,
    disableChunking: false, // Progressive chunking is always enabled
    serviceWorkerUrl: undefined, // Will be set before HTML wave
  };

  for (let waveIndex = 0; waveIndex < reorganizedWaves.length; waveIndex++) {
    const filesInWave = reorganizedWaves[waveIndex];
    const isHtmlWave = filesInWave.some((f) => isIndexHtmlFile(f));

    // If this is the HTML wave AND we have chunked files, inscribe Service Worker first
    if (isHtmlWave && allChunkManifests.length > 0 && !serviceWorkerInscription) {
      // Calculate total files including SW: regular files + versioning files + SW
      const totalFilesIncludingSW = order.length + (VERSIONING_ENABLED ? 2 : 0) + 1;
      const currentFileNumber = inscriptions.length + 1; // Current position

      // Generate service worker code
      const swCode = generateChunkReassemblyServiceWorker(allChunkManifests, primaryContentUrl);
      const swBuffer = Buffer.from(swCode, 'utf-8');

      // Calculate contentHash for caching
      const swContentHash = createHash('sha256').update(swBuffer).digest('hex');

      // Check if we can reuse a previous SW inscription
      const previousSW = previousInscriptions.get('chunk-reassembly-sw.js');
      const canReuseSW = previousSW && previousSW.contentHash === swContentHash;

      if (canReuseSW && previousSW) {
        // Reuse cached service worker
        callbacks?.onInscriptionSkipped?.('chunk-reassembly-sw.js', previousSW.urlPath);

        serviceWorkerInscription = { ...previousSW, cached: true };
        inscriptions.push(serviceWorkerInscription);
        txids.add(previousSW.txid);
        totalSize += previousSW.size;
        jobContext.serviceWorkerUrl = previousSW.urlPath;

        callbacks?.onProgress?.(
          `  ✓ Service worker cached (hash: ${swContentHash.slice(0, 16)}...)`
        );
      } else {
        // Inscribe new service worker
        callbacks?.onInscriptionStart?.(
          'chunk-reassembly-sw.js',
          currentFileNumber,
          totalFilesIncludingSW
        );

        const swJobs = [
          {
            id: 'service-worker',
            type: 'bfile' as const,
            filePath: '',
            originalPath: 'chunk-reassembly-sw.js',
            contentType: 'application/javascript',
            content: swBuffer,
            destinationAddress,
          },
        ];

        const swInscriptionResult = await parallelInscribe(
          swJobs,
          paymentPk,
          indexer,
          satsPerKb || DEFAULT_SATS_PER_KB,
          dryRun || false,
          1,
          undefined, // No seed UTXO for SW
          spentUtxos,
          callbacks?.onProgress
        );

        serviceWorkerInscription = {
          ...swInscriptionResult.results[0].inscription,
          contentHash: swContentHash, // Store hash for future caching
        };
        txids.add(serviceWorkerInscription.txid);
        totalCost += swInscriptionResult.totalCost;

        // Add Service Worker to inscriptions immediately (before HTML)
        inscriptions.push(serviceWorkerInscription);
        totalSize += serviceWorkerInscription.size;

        // Update context with SW URL so HTML can reference it
        jobContext.serviceWorkerUrl = serviceWorkerInscription.urlPath;

        callbacks?.onInscriptionComplete?.(
          'chunk-reassembly-sw.js',
          serviceWorkerInscription.urlPath
        );
      }
    }

    callbacks?.onProgress?.(
      `\n🌊 Wave ${waveIndex + 1}/${reorganizedWaves.length}: Processing ${filesInWave.length} file(s)...`
    );

    // Filter out cached files
    const filesToInscribe = filesInWave.filter((filePath) => {
      const node = graph.get(filePath);
      if (!node) return true;

      const fileRef = node.file;
      const previousInscription = previousInscriptions.get(filePath);
      const shouldReuse = canReuseInscription(filePath, fileRef, previousInscription, urlMap);

      if (shouldReuse && previousInscription) {
        inscriptions.push({ ...previousInscription, cached: true });
        urlMap.set(filePath, previousInscription.urlPath);
        txids.add(previousInscription.txid);
        totalSize += previousInscription.size;

        // If this is a chunked file, also track its chunks
        let chunkCount: number | undefined;
        if (previousInscription.isChunked && previousInscription.chunks) {
          for (const chunk of previousInscription.chunks) {
            txids.add(chunk.txid);
          }
          chunkCount = previousInscription.chunks.length;
          // Note: Manifest already added to allChunkManifests during cache analysis
        }

        callbacks?.onInscriptionSkipped?.(filePath, previousInscription.urlPath, chunkCount);
        return false;
      }

      return true;
    });

    if (filesToInscribe.length === 0) {
      callbacks?.onProgress?.(`  ✓ All files in this wave are cached, skipping...`);
      continue;
    }

    // Prepare jobs for this wave (pass previousInscriptions to skip cached chunked files)
    const jobs = await prepareWaveJobs(
      filesToInscribe,
      graph,
      urlMap,
      jobContext,
      previousInscriptions
    );

    if (jobs.length === 0) {
      continue;
    }

    // Inscribe all jobs in parallel
    const inscriptionResult = await parallelInscribe(
      jobs,
      paymentPk,
      indexer,
      satsPerKb || DEFAULT_SATS_PER_KB,
      dryRun || false,
      chunkBatchSize || DEFAULT_CHUNK_BATCH_SIZE,
      seedUtxo, // Pass seed UTXO for first wave to avoid indexer timing issues
      spentUtxos, // Pass spent UTXOs from previous waves
      callbacks?.onProgress
    );

    // Add cost from this wave
    totalCost += inscriptionResult.totalCost;

    // Clear seed UTXO after first wave (it's been used)
    seedUtxo = undefined;

    // Process results
    // Note: chunkSize passed here is only for metadata - actual chunk sizes are stored in each chunk
    const processed = processWaveResults(inscriptionResult.results, urlMap, jobContext.chunkSize);

    // Add regular files to inscriptions
    for (const inscribedFile of processed.regularFiles) {
      const node = graph.get(inscribedFile.originalPath);
      const fileRef = node?.file;

      const hasDependencies = fileRef?.dependencies && fileRef.dependencies.length > 0;
      const dependencyHash =
        hasDependencies && fileRef
          ? calculateDependencyHash(fileRef.dependencies, urlMap)
          : undefined;

      inscriptions.push({
        ...inscribedFile,
        dependencyHash,
      });

      txids.add(inscribedFile.txid);
      totalSize += inscribedFile.size;
      callbacks?.onInscriptionComplete?.(inscribedFile.originalPath, inscribedFile.urlPath);
    }

    // Handle chunked files
    for (const [filePath, chunkedFileData] of processed.chunkedFiles.entries()) {
      allChunkManifests.push(chunkedFileData.manifest);

      // Get the original file's contentHash from the graph (calculated before chunking)
      const node = graph.get(filePath);
      const fileContentHash = node?.file?.contentHash || '';

      // Build chunks array with full metadata
      const chunksMetadata = chunkedFileData.chunks.map((chunkResult, index) => ({
        index,
        txid: chunkResult.inscription.txid,
        vout: chunkResult.inscription.vout,
        size: chunkResult.inscription.size,
      }));

      // Add the chunked file entry to inscriptions with full metadata
      const chunkedFileInscription: InscribedFile = {
        originalPath: filePath,
        txid: chunkedFileData.manifest.chunks[0]?.txid || '', // Use first chunk's txid as primary
        vout: 0,
        urlPath: `/content/${chunkedFileData.manifest.chunks[0]?.txid}_0`, // Placeholder URL
        size: chunkedFileData.totalSize,
        contentHash: fileContentHash, // Use original file hash, not recalculated from chunks
        isChunked: true,
        chunkCount: chunkedFileData.chunks.length,
        chunks: chunksMetadata,
      };

      inscriptions.push(chunkedFileInscription);

      // Add individual chunk txids
      for (const chunkResult of chunkedFileData.chunks) {
        txids.add(chunkResult.inscription.txid);
      }

      totalSize += chunkedFileData.totalSize;
      callbacks?.onInscriptionComplete?.(filePath, chunkedFileInscription.urlPath);
    }
  }

  // Step 6: Service Worker already added to inscriptions array (if it was created)
  // No need to add again - it was added immediately after inscription

  // TODO: Inscribe chunk manifests
  // For each chunked file, create a manifest inscription that contains the chunk metadata
  // This will allow subsequent deployments to detect cached chunks

  // Step 7: Find entry point
  const entryPoint = inscriptions.find((i) => isIndexHtmlFile(i.originalPath));
  if (!entryPoint) {
    throw new Error('No index.html found in build directory');
  }

  // Step 8: Update versioning inscription
  let latestVersioningInscription: string | undefined;

  if (finalVersioningOriginInscription && VERSIONING_ENABLED && !dryRun) {
    try {
      const entryPointOutpoint = extractOutpointFromFile(entryPoint);
      latestVersioningInscription = await updateVersioningInscription(
        versioningOriginInscription || finalVersioningOriginInscription,
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
      console.error('❌ Failed to update versioning inscription');
      throw error;
    }
  }

  callbacks?.onDeploymentComplete?.(entryPoint.urlPath);

  if (!finalVersioningOriginInscription) {
    throw new Error('Versioning inscription origin was not set');
  }

  return {
    entryPointUrl: entryPoint.urlPath,
    inscriptions,
    totalCost,
    totalSize,
    txids: Array.from(txids),
    versioningOriginInscription: finalVersioningOriginInscription,
    versioningLatestInscription: latestVersioningInscription,
    version,
    versionDescription,
    buildDir,
    destinationAddress,
    ordinalContentUrl: primaryContentUrl,
  };
}

// Keep existing manifest generation functions
export function generateManifest(result: DeploymentResult): DeploymentManifest {
  const newFiles = result.inscriptions.filter((f) => !f.cached);
  const cachedFiles = result.inscriptions.filter((f) => f.cached);
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
    transactions: result.txids,
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
  originVersioningInscription: string
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
      } else if ('timestamp' in parsed && 'entryPoint' in parsed) {
        const oldManifest = parsed as DeploymentManifest;
        const { originVersioningInscription: _, ...cleanedOldManifest } = oldManifest as any;
        history = {
          manifestVersion: MANIFEST_VERSION,
          originVersioningInscription: originVersioningInscription,
          totalDeployments: 2,
          deployments: [cleanedOldManifest, manifest],
        };
      } else {
        history = createNewHistory(manifest, originVersioningInscription);
      }
    } catch (error) {
      history = createNewHistory(manifest, originVersioningInscription);
    }
  } else {
    history = createNewHistory(manifest, originVersioningInscription);
  }

  const json = JSON.stringify(history, null, 2);
  await writeFile(outputPath, json, 'utf-8');

  return history;
}

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
