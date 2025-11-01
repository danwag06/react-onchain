/**
 * Inscription-specific utility functions
 */

import { createHash } from 'crypto';
import type { InscribedFile } from '../types.js';
import { OUTPOINT_SEPARATOR } from './constants.js';

/**
 * Extracts outpoint (txid_vout) from inscribed file
 */
export function extractOutpointFromFile(file: InscribedFile): string {
  return file.urlPath.split('/').pop() || `${file.txid}${OUTPOINT_SEPARATOR}${file.vout}`;
}

/**
 * Calculates SHA256 hash of sorted dependency URLs
 */
export function calculateDependencyHash(
  dependencies: string[],
  urlMap: Map<string, string>
): string {
  const dependencyUrls = dependencies
    .map((dep) => urlMap.get(dep))
    .filter((url): url is string => url !== undefined)
    .sort();

  return createHash('sha256').update(dependencyUrls.join('|')).digest('hex');
}

/**
 * Suggests next version by incrementing the last number
 */
export function suggestNextVersion(version: string): string {
  const lastNumber = version.split('.').pop();
  const newLastNumber = Number(lastNumber) + 1;
  return `${version.split('.').slice(0, -1).join('.')}.${newLastNumber}`;
}

/**
 * Checks if a file path represents index.html
 */
export function isIndexHtmlFile(filePath: string): boolean {
  return filePath === 'index.html' || filePath.endsWith('/index.html');
}
