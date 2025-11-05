/**
 * Service Worker Inscription Orchestration
 *
 * Handles the inscription of chunk reassembly service workers.
 * Extracted from orchestrator.ts for better maintainability.
 */

import { createHash } from 'crypto';
import { PrivateKey } from '@bsv/sdk';
import type { ChunkManifest } from '../chunking/index.js';
import type { InscribedFile } from '../inscription/inscription.types.js';
import type { OrchestratorCallbacks } from '../orchestration/orchestration.types.js';
import type { IndexerService } from '../../lib/service-providers/IndexerService.js';
import { generateChunkReassemblyServiceWorker } from './generator.js';
import { parallelInscribe } from '../inscription/parallelInscriber.js';
import { DEFAULT_SATS_PER_KB } from '../../utils/constants.js';

/**
 * Result of service worker inscription
 */
export interface ServiceWorkerInscriptionResult {
  serviceWorkerInscription: InscribedFile;
  totalCost: number;
  splitTxid?: string;
}

/**
 * Handles service worker inscription for chunked files
 *
 * Inscribes a new service worker or reuses a cached one if the content hash matches.
 *
 * @param allChunkManifests - All chunk manifests that need reassembly
 * @param previousInscriptions - Map of previously inscribed files
 * @param primaryContentUrl - Base URL for content delivery
 * @param paymentPk - Private key for payment
 * @param indexer - Indexer service for broadcasting transactions
 * @param destinationAddress - Destination address for the inscription
 * @param satsPerKb - Satoshis per KB for fees
 * @param dryRun - Whether this is a dry run
 * @param inscriptionsCount - Current number of inscriptions (for progress tracking)
 * @param totalFiles - Total number of files (for progress tracking)
 * @param spentUtxos - Set of spent UTXOs to avoid double-spending
 * @param callbacks - Optional progress callbacks
 * @returns Service worker inscription result
 */
export async function handleServiceWorkerInscription(
  allChunkManifests: ChunkManifest[],
  previousInscriptions: Map<string, InscribedFile>,
  primaryContentUrl: string,
  paymentPk: PrivateKey,
  indexer: IndexerService,
  destinationAddress: string,
  satsPerKb: number,
  dryRun: boolean,
  inscriptionsCount: number,
  totalFiles: number,
  spentUtxos: Set<string>,
  callbacks?: OrchestratorCallbacks
): Promise<ServiceWorkerInscriptionResult> {
  callbacks?.onProgress?.(`\n⚙️  Inscribing Service Worker...`);

  const currentFileNumber = inscriptionsCount + 1;

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
    callbacks?.onProgress?.(`  ✓ Service worker cached (hash: ${swContentHash.slice(0, 16)}...)`);

    return {
      serviceWorkerInscription: { ...previousSW, cached: true },
      totalCost: 0, // No cost for cached SW
      splitTxid: undefined,
    };
  }

  // Inscribe new service worker
  callbacks?.onInscriptionStart?.('chunk-reassembly-sw.js', currentFileNumber, totalFiles);

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
    dryRun,
    1,
    undefined, // No seed UTXO for SW
    spentUtxos,
    callbacks?.onProgress
  );

  const serviceWorkerInscription = {
    ...swInscriptionResult.results[0].inscription,
    contentHash: swContentHash, // Store hash for future caching
  };

  callbacks?.onInscriptionComplete?.('chunk-reassembly-sw.js', serviceWorkerInscription.urlPath);

  return {
    serviceWorkerInscription,
    totalCost: swInscriptionResult.totalCost,
    splitTxid: swInscriptionResult.splitTxid,
  };
}
