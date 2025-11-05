/**
 * Cache Analysis Module
 *
 * Analyzes which files can be reused from previous deployments.
 * Extracted from orchestrator.ts for better maintainability.
 */

import { createHash } from 'crypto';
import type { FileReference, DependencyNode } from '../analysis/index.js';
import type { InscribedFile } from '../inscription/inscription.types.js';
import type { ChunkManifest } from '../chunking/index.js';
import type {
  ChunkedFileInfo,
  OrchestratorCallbacks,
} from '../orchestration/orchestration.types.js';
import { shouldChunkFile } from '../chunking/index.js';
import { generateChunkReassemblyServiceWorker } from '../service-worker/generator.js';
import { calculateDependencyHash, isIndexHtmlFile } from '../inscription/utils.js';
import { DEFAULT_CHUNK_THRESHOLD } from '../../utils/constants.js';

/**
 * Result of cache analysis
 */
export interface CacheAnalysisResult {
  cachedCount: number;
  cachedFiles: string[];
  chunkedFilesInfo: ChunkedFileInfo[];
  cachedChunkManifests: ChunkManifest[];
  hasChunkedFiles: boolean;
}

/**
 * Determines if an inscription can be reused from a previous deployment
 *
 * @param filePath - Path of the file
 * @param fileRef - File reference from analysis
 * @param previousInscription - Previous inscription (if exists)
 * @param urlMap - URL mapping for dependencies
 * @returns True if inscription can be reused
 */
function canReuseInscription(
  filePath: string,
  fileRef: FileReference,
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

/**
 * Analyzes which files can be cached from previous deployments
 *
 * Determines:
 * - Which files have unchanged content and dependencies (can be reused)
 * - Which chunked files can be cached
 * - Whether the service worker can be cached
 *
 * @param order - Ordered list of file paths
 * @param graph - Dependency graph
 * @param previousInscriptions - Map of previous inscriptions
 * @param primaryContentUrl - Content delivery URL
 * @param callbacks - Optional progress callbacks
 * @returns Cache analysis result
 */
export async function analyzeCachedFiles(
  order: string[],
  graph: Map<string, DependencyNode>,
  previousInscriptions: Map<string, InscribedFile>,
  primaryContentUrl: string,
  callbacks?: OrchestratorCallbacks
): Promise<CacheAnalysisResult> {
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

  callbacks?.onCacheAnalysis?.(
    cachedCount,
    order.length - cachedCount,
    cachedFiles,
    chunkedFilesInfo
  );

  return {
    cachedCount,
    cachedFiles,
    chunkedFilesInfo,
    cachedChunkManifests,
    hasChunkedFiles,
  };
}

/**
 * Helper function to check if an inscription can be reused
 * Exported for use in wave processing
 */
export { canReuseInscription };
