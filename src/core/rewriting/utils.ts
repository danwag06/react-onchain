/**
 * Rewriting Utilities
 * Shared utilities for URL rewriting
 */

import type { InscribedFile } from '../inscription/index.js';

/**
 * Creates a mapping of original paths to inscription URL paths
 */
export function createUrlMap(inscriptions: InscribedFile[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const inscription of inscriptions) {
    map.set(inscription.originalPath, inscription.urlPath);
  }
  return map;
}
