/**
 * JSON Rewriter
 * Rewrites JSON files (especially PWA manifests) to use on-chain inscription URLs
 */

import { readFile } from 'fs/promises';
import { formatError } from '../../utils/errors.js';
import { shouldSkipUrl, resolveAssetPath } from '../utils.js';

/**
 * Recursively rewrites asset paths in JSON objects
 * Handles properties commonly used for asset references: src, href, icon, icons, screenshots, etc.
 */
function rewriteJsonObject(
  obj: unknown,
  originalPath: string,
  baseDir: string,
  urlMap: Map<string, string>
): unknown {
  if (Array.isArray(obj)) {
    return obj.map((item) => rewriteJsonObject(item, originalPath, baseDir, urlMap));
  }

  if (obj !== null && typeof obj === 'object') {
    const rewritten: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      // Check if this property typically contains asset paths
      const assetKeys = ['src', 'href', 'icon', 'url', 'image', 'logo', 'background'];
      const isAssetKey = assetKeys.includes(key.toLowerCase());

      if (isAssetKey && typeof value === 'string' && value.trim()) {
        const url = value.trim();

        // Skip external URLs and data URIs
        if (shouldSkipUrl(url)) {
          rewritten[key] = value;
          continue;
        }

        try {
          const resolvedPath = resolveAssetPath(url, originalPath, baseDir);
          const contentUrl = urlMap.get(resolvedPath);

          if (contentUrl) {
            rewritten[key] = contentUrl;
          } else {
            rewritten[key] = value;
          }
        } catch (error) {
          console.warn(
            `Could not resolve JSON reference ${url} in ${originalPath}:`,
            formatError(error)
          );
          rewritten[key] = value;
        }
      } else {
        // Recursively process nested objects/arrays
        rewritten[key] = rewriteJsonObject(value, originalPath, baseDir, urlMap);
      }
    }
    return rewritten;
  }

  return obj;
}

/**
 * Rewrites JSON content to use ordfs URLs
 * Primarily for PWA manifest.json files with icons and screenshots
 */
export async function rewriteJson(
  filePath: string,
  baseDir: string,
  originalPath: string,
  urlMap: Map<string, string>
): Promise<string> {
  const content = await readFile(filePath, 'utf-8');

  try {
    const data = JSON.parse(content);
    const rewritten = rewriteJsonObject(data, originalPath, baseDir, urlMap);

    // Preserve formatting with 2-space indentation
    return JSON.stringify(rewritten, null, 2);
  } catch (error) {
    console.warn(`Could not parse JSON file ${originalPath}:`, formatError(error));
    return content;
  }
}
