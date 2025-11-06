/**
 * Wave Processing Module
 *
 * Handles parallel wave-based file inscription with dependency management.
 * Extracted from orchestrator.ts for better maintainability.
 */

import { PrivateKey } from '@bsv/sdk';
import type { Utxo } from 'js-1sat-ord';
import type { DependencyNode } from '../analysis/index.js';
import type { InscribedFile } from '../inscription/inscription.types.js';
import type { ChunkManifest } from '../chunking/index.js';
import type { IndexerService } from '../../lib/service-providers/IndexerService.js';
import type { OrchestratorCallbacks, WaveJobContext } from './orchestration.types.js';
import { prepareWaveJobs, processWaveResults } from './jobBuilder.js';
import { parallelInscribe } from '../inscription/parallelInscriber.js';
import { calculateDependencyHash } from '../inscription/utils.js';
import { canReuseInscription } from '../caching/analyzer.js';
import { DEFAULT_SATS_PER_KB, DEFAULT_CHUNK_BATCH_SIZE } from '../../utils/constants.js';

/**
 * Result of wave processing
 */
export interface WaveProcessingResult {
  inscriptions: InscribedFile[];
  allChunkManifests: ChunkManifest[];
  totalCost: number;
  totalSize: number;
  txids: Set<string>;
}

/**
 * Processes file inscription waves
 *
 * Processes files wave by wave, respecting dependency order while maximizing parallelism.
 * Each wave contains files that can be inscribed in parallel (all dependencies satisfied).
 *
 * @param reorganizedWaves - Waves of files to process
 * @param graph - Dependency graph
 * @param urlMap - URL mapping for dependencies (will be mutated)
 * @param cachedFiles - List of cached file paths
 * @param cachedChunkManifests - Chunk manifests from cached files
 * @param previousInscriptions - Map of previous inscriptions
 * @param jobContext - Job context for wave processing
 * @param paymentPk - Private key for payment
 * @param indexer - Indexer service for broadcasting transactions
 * @param satsPerKb - Satoshis per KB for fees
 * @param dryRun - Whether this is a dry run
 * @param seedUtxo - Seed UTXO for first wave (to avoid indexer timing issues)
 * @param spentUtxos - Set of spent UTXOs to avoid double-spending
 * @param callbacks - Optional progress callbacks
 * @returns Wave processing result
 */
export async function processWaves(
  reorganizedWaves: string[][],
  graph: Map<string, DependencyNode>,
  urlMap: Map<string, string>,
  cachedFiles: string[],
  cachedChunkManifests: ChunkManifest[],
  previousInscriptions: Map<string, InscribedFile>,
  jobContext: WaveJobContext,
  paymentPk: PrivateKey,
  indexer: IndexerService,
  satsPerKb: number | undefined,
  dryRun: boolean,
  seedUtxo: Utxo | undefined,
  spentUtxos: Set<string>,
  callbacks?: OrchestratorCallbacks
): Promise<WaveProcessingResult> {
  // Pre-populate URL map with ALL cached files before any wave processing
  // This ensures that files being rewritten can reference cached files from any wave
  for (const [filePath, previousInscription] of previousInscriptions) {
    if (cachedFiles.includes(filePath)) {
      urlMap.set(filePath, previousInscription.urlPath);
    }
  }

  const inscriptions: InscribedFile[] = [];
  const allChunkManifests: ChunkManifest[] = [...cachedChunkManifests];
  let totalCost = 0;
  let totalSize = 0;
  const txids = new Set<string>();
  let currentSeedUtxo = seedUtxo;

  for (let waveIndex = 0; waveIndex < reorganizedWaves.length; waveIndex++) {
    const filesInWave = reorganizedWaves[waveIndex];

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
        // Note: Do NOT add cached file txids or sizes to totals - these are from previous deployments

        // If this is a chunked file, note its chunk count
        let chunkCount: number | undefined;
        if (previousInscription.isChunked && previousInscription.chunks) {
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
    const jobs = await prepareWaveJobs(filesToInscribe, graph, urlMap, jobContext);

    if (jobs.length === 0) {
      continue;
    }

    // Inscribe all jobs in parallel
    const inscriptionResult = await parallelInscribe(
      jobs,
      paymentPk,
      indexer,
      satsPerKb || DEFAULT_SATS_PER_KB,
      dryRun,
      DEFAULT_CHUNK_BATCH_SIZE,
      currentSeedUtxo, // Pass seed UTXO for first wave to avoid indexer timing issues
      spentUtxos, // Pass spent UTXOs from previous waves
      callbacks?.onProgress
    );

    // Track split UTXO transaction (in chronological order before inscriptions)
    if (inscriptionResult.splitTxid) {
      txids.add(inscriptionResult.splitTxid);
    }

    // Add cost from this wave
    totalCost += inscriptionResult.totalCost;

    // Clear seed UTXO after first wave (it's been used)
    currentSeedUtxo = undefined;

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

  return {
    inscriptions,
    allChunkManifests,
    totalCost,
    totalSize,
    txids,
  };
}
