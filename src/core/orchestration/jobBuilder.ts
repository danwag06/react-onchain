/**
 * Orchestrator Job Builder - Wave-Based Parallel Processing
 *
 * This module implements wave-based parallel inscription that respects topological order:
 *
 * **Key Concept: Dependency Waves**
 * - Files are grouped into "waves" based on their dependency depth
 * - Wave 0: Files with NO dependencies (all inscribed in parallel)
 * - Wave 1: Files that ONLY depend on Wave 0 files (inscribed in parallel after Wave 0)
 * - Wave N: Files that depend on files from previous waves
 *
 * **Within Each Wave:**
 * - All files can be inscribed in PARALLEL (dependencies satisfied)
 * - Large files are chunked, and chunks inscribed in parallel
 * - URLs are known after each wave completes, enabling dependent files in next wave
 */

import { readFile } from 'fs/promises';
import type { InscriptionJob, InscriptionResult, InscribedFile } from '../inscription/index.js';
import type { FileReference, DependencyNode } from '../analysis/index.js';
import type { ChunkManifest } from '../chunking/index.js';
import {
  rewriteFile,
  injectVersionScript,
  injectBasePathFix,
  injectWebpackPublicPathFix,
  injectBannerComment,
  minifyScript,
} from '../rewriting/index.js';
import { shouldChunkFile, splitFileIntoChunks, createChunkManifest } from '../chunking/index.js';
import { generateServiceWorkerRegistration } from '../service-worker/index.js';
import { isIndexHtmlFile } from '../inscription/index.js';
import type {
  DependencyWaves,
  WaveJobContext,
  ProcessedWaveResults,
} from './orchestration.types.js';

/**
 * Calculates dependency waves for parallel processing
 *
 * Assigns each file to a "wave" based on the maximum depth of its dependencies:
 * - Wave 0: Files with no dependencies
 * - Wave N: Files whose dependencies are all in waves < N
 */
export function calculateDependencyWaves(graph: Map<string, DependencyNode>): DependencyWaves {
  const fileToWave = new Map<string, number>();
  const waves: string[][] = [];

  // Helper to get wave for a file (with memoization)
  function getWave(filePath: string): number {
    if (fileToWave.has(filePath)) {
      return fileToWave.get(filePath)!;
    }

    const node = graph.get(filePath);
    if (!node) return 0;

    const dependencies = node.file.dependencies || [];

    if (dependencies.length === 0) {
      // No dependencies = Wave 0
      fileToWave.set(filePath, 0);
      return 0;
    }

    // Wave = max(dependency waves) + 1
    let maxDepWave = -1;
    for (const dep of dependencies) {
      const depWave = getWave(dep);
      maxDepWave = Math.max(maxDepWave, depWave);
    }

    const wave = maxDepWave + 1;
    fileToWave.set(filePath, wave);
    return wave;
  }

  // Calculate wave for all files
  for (const filePath of graph.keys()) {
    getWave(filePath);
  }

  // Group files by wave
  const maxWave = Math.max(...Array.from(fileToWave.values()));
  for (let i = 0; i <= maxWave; i++) {
    waves[i] = [];
  }

  for (const [filePath, wave] of fileToWave.entries()) {
    waves[wave].push(filePath);
  }

  for (let i = 0; i < waves.length; i++) {}

  return { waves, fileToWave };
}

/**
 * Prepares content for a single file (rewrites, script injection, etc.)
 */
async function prepareFileContent(
  fileRef: FileReference,
  filePath: string,
  buildDir: string,
  urlMap: Map<string, string>,
  versioningOriginInscription?: string,
  serviceWorkerUrl?: string
): Promise<Buffer> {
  let content: Buffer;

  // Check if file has dependencies that need rewriting
  if (fileRef.dependencies.length > 0) {
    content = await rewriteFile(
      fileRef.absolutePath,
      buildDir,
      filePath,
      fileRef.contentType,
      urlMap
    );
  } else {
    content = await readFile(fileRef.absolutePath);
  }

  // Special handling for index.html
  if (isIndexHtmlFile(filePath)) {
    let htmlContent = content.toString('utf-8');

    // Inject banner comment (at the very top)
    htmlContent = injectBannerComment(htmlContent);

    // Inject webpack public path fix (MUST run FIRST, before any webpack bundles load)
    htmlContent = await injectWebpackPublicPathFix(htmlContent);

    // Inject base path fix script (MUST run before React loads)
    htmlContent = await injectBasePathFix(htmlContent);

    // Inject version script if inscription origin is known
    if (versioningOriginInscription) {
      htmlContent = await injectVersionScript(htmlContent, versioningOriginInscription);
    }

    // Inject Service Worker registration if SW URL is provided
    // Must be in <head> so window.swReady is available before body scripts execute
    if (serviceWorkerUrl) {
      const swRegistration = generateServiceWorkerRegistration(serviceWorkerUrl);

      // Extract script content (between <script> tags) and minify it
      const scriptMatch = swRegistration.match(/<script>([\s\S]*)<\/script>/);
      if (scriptMatch) {
        const scriptContent = scriptMatch[1];
        const minified = minifyScript(scriptContent);
        const minifiedScript = `\n<script>${minified}</script>\n`;

        // Inject before closing </head> tag, or before </body> if no head
        if (htmlContent.includes('</head>')) {
          htmlContent = htmlContent.replace('</head>', `${minifiedScript}</head>`);
        } else if (htmlContent.includes('</body>')) {
          htmlContent = htmlContent.replace('</body>', `${minifiedScript}</body>`);
        } else if (htmlContent.includes('</html>')) {
          htmlContent = htmlContent.replace('</html>', `${minifiedScript}</html>`);
        } else {
          // Fallback: append at end
          htmlContent += minifiedScript;
        }
      }
    }

    content = Buffer.from(htmlContent, 'utf-8');
  }

  return content;
}

/**
 * Prepares inscription jobs for a single wave of files
 * All files in a wave can be inscribed in parallel (dependencies satisfied)
 *
 * @returns Array of InscriptionJobs ready for parallel inscription
 */
export async function prepareWaveJobs(
  filesInWave: string[],
  graph: Map<string, DependencyNode>,
  urlMap: Map<string, string>,
  context: WaveJobContext,
  previousInscriptions?: Map<string, InscribedFile>
): Promise<InscriptionJob[]> {
  const jobs: InscriptionJob[] = [];

  for (const filePath of filesInWave) {
    const node = graph.get(filePath);
    if (!node) continue;

    const fileRef: FileReference = node.file;
    const fileSize = fileRef.fileSize;

    // Check if this file is cached (should have been filtered out already, but double-check)
    const previousInscription = previousInscriptions?.get(filePath);
    if (previousInscription && previousInscription.isChunked) {
      // File is cached and chunked - skip job creation entirely
      // The wave processing already added it to inscriptions with cached: true
      continue;
    }

    // Prepare file content (rewrites, script injection, etc.)
    const content = await prepareFileContent(
      fileRef,
      filePath,
      context.buildDir,
      urlMap,
      context.versioningOriginInscription,
      context.serviceWorkerUrl
    );

    // Check if this file needs chunking
    const needsChunking =
      !context.disableChunking && shouldChunkFile(fileSize, filePath, context.chunkThreshold);

    if (needsChunking) {
      // Create jobs for each chunk
      // Pass filePath to enable progressive chunking for video files
      const chunks = splitFileIntoChunks(content, context.chunkSize, filePath);

      for (let i = 0; i < chunks.length; i++) {
        jobs.push({
          id: `chunk-${filePath}-${i}`,
          type: 'bfile', // Chunks are B files
          filePath: fileRef.absolutePath,
          originalPath: `${filePath}.chunk${i}`,
          contentType: 'application/octet-stream',
          content: chunks[i],
          destinationAddress: context.destinationAddress,
          chunkIndex: i,
          totalChunks: chunks.length,
        });
      }
    } else {
      // Regular file job - use B files for most content, ordinals for special cases
      // Most React apps use B files for better compatibility
      const jobType: 'ordinal' | 'bfile' = 'bfile';

      jobs.push({
        id: `file-${filePath}`,
        type: jobType,
        filePath: fileRef.absolutePath,
        originalPath: filePath,
        contentType: fileRef.contentType,
        content,
        destinationAddress: context.destinationAddress,
      });
    }
  }

  return jobs;
}

/**
 * Groups chunk results by original file path
 */
function groupChunkResults(results: InscriptionResult[]): Map<string, InscriptionResult[]> {
  const chunksByFile = new Map<string, InscriptionResult[]>();

  for (const result of results) {
    if (result.job.chunkIndex === undefined) {
      continue; // Not a chunk
    }

    // Extract the original file path (remove .chunkN suffix)
    const originalPath = result.job.originalPath.replace(/\.chunk\d+$/, '');

    if (!chunksByFile.has(originalPath)) {
      chunksByFile.set(originalPath, []);
    }

    chunksByFile.get(originalPath)!.push(result);
  }

  // Sort each file's chunks by index
  for (const chunks of chunksByFile.values()) {
    chunks.sort((a, b) => a.job.chunkIndex! - b.job.chunkIndex!);
  }

  return chunksByFile;
}

/**
 * Processes inscription results after a wave completes
 * - Updates URL map for regular files
 * - Groups and sorts chunk results
 * - Creates chunk manifests
 * - Returns chunked file info for later processing
 */

/**
 * Processes results from a wave inscription
 */
export function processWaveResults(
  results: InscriptionResult[],
  urlMap: Map<string, string>,
  chunkSize: number
): ProcessedWaveResults {
  const regularFiles: InscribedFile[] = [];
  const chunksByFile = groupChunkResults(results);
  const chunkedFiles = new Map<
    string,
    {
      chunks: InscriptionResult[];
      manifest: ChunkManifest;
      originalContentType: string;
      totalSize: number;
    }
  >();

  // Process regular (non-chunk) results
  for (const result of results) {
    if (result.job.chunkIndex === undefined) {
      // Regular file
      regularFiles.push(result.inscription);
      urlMap.set(result.job.originalPath, result.inscription.urlPath);
    }
  }

  // Process chunked files
  for (const [filePath, chunks] of chunksByFile.entries()) {
    // Get content type from first chunk's job
    const originalContentType = chunks[0].job.contentType;

    // Calculate total size from all chunks
    const totalSize = chunks.reduce((sum, chunk) => sum + chunk.inscription.size, 0);

    // Create chunk manifest
    const manifest = createChunkManifest(
      filePath,
      originalContentType,
      totalSize,
      chunkSize,
      chunks.map((c) => c.inscription)
    );

    chunkedFiles.set(filePath, {
      chunks,
      manifest,
      originalContentType,
      totalSize,
    });
  }

  return { regularFiles, chunkedFiles };
}
