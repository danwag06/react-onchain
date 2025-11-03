/**
 * Rewriting Utilities
 * Shared utilities for URL rewriting
 */

import { dirname, relative, resolve, join } from 'path';
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

/**
 * Resolves a reference path relative to a source file
 */
export function resolveReference(ref: string, sourceFile: string, baseDir: string): string {
  const sourceDir = dirname(join(baseDir, sourceFile));

  if (ref.startsWith('/')) {
    // Absolute path from build root
    return ref.substring(1);
  } else {
    // Relative path
    const resolved = resolve(sourceDir, ref);
    return relative(baseDir, resolved);
  }
}
