/**
 * Rewriting Utilities
 * Shared utilities for URL rewriting
 */

import type { InscribedFile } from '../inscription/index.js';
import { resolveAssetPath as resolveAssetPathCore } from '../utils.js';

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

/**
 * Resolves a reference path relative to a source file
 * @deprecated Use resolveAssetPath from core/utils.js instead
 * This is kept for backward compatibility but delegates to the shared implementation
 */
export function resolveReference(ref: string, sourceFile: string, baseDir: string): string {
  return resolveAssetPathCore(ref, sourceFile, baseDir);
}
