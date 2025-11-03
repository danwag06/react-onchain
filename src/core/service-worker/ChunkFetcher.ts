/**
 * Chunk Fetcher Module
 * Handles fetching and caching of individual chunks
 *
 * Note: This module provides reference implementations.
 * The actual code is inlined into the generated Service Worker by serviceWorkerGenerator.ts
 */

import type { StreamConfig } from './types.js';

// Minimal Service Worker type declarations for compilation
// These are provided by the Service Worker runtime environment
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const caches: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare function fetch(input: any, init?: any): Promise<any>;

/**
 * Fetches a chunk with cache-first strategy
 * @param chunkUrlPath - URL path to the chunk (e.g., /content/txid_vout)
 * @param config - Stream configuration with baseUrl and cacheName
 * @returns ArrayBuffer containing the chunk data
 */
export async function fetchChunk(chunkUrlPath: string, config: StreamConfig): Promise<ArrayBuffer> {
  const chunkUrl = config.baseUrl + chunkUrlPath;
  const cache = await caches.open(config.cacheName);

  // Try cache first
  const cachedResponse = await cache.match(chunkUrl);
  if (cachedResponse) {
    return cachedResponse.arrayBuffer();
  }

  // Cache miss - fetch from network
  const response = await fetch(chunkUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch chunk: ${chunkUrl} (${response.status})`);
  }

  // Cache the response for future use
  cache.put(chunkUrl, response.clone());

  return response.arrayBuffer();
}

/**
 * Prefetches chunks in the background to improve seeking performance
 * @param chunkUrlPaths - Array of chunk URL paths to prefetch
 * @param config - Stream configuration
 */
export async function prefetchChunks(chunkUrlPaths: string[], config: StreamConfig): Promise<void> {
  const cache = await caches.open(config.cacheName);

  const prefetchPromises = chunkUrlPaths.map(async (chunkUrlPath) => {
    const chunkUrl = config.baseUrl + chunkUrlPath;

    // Skip if already cached
    const cached = await cache.match(chunkUrl);
    if (cached) {
      return;
    }

    // Fetch and cache in the background
    try {
      const response = await fetch(chunkUrl);
      if (response.ok) {
        await cache.put(chunkUrl, response);
      }
    } catch {
      // Silently fail prefetch (not critical)
      console.warn('[SW] Prefetch failed for:', chunkUrlPath);
    }
  });

  await Promise.all(prefetchPromises);
}
