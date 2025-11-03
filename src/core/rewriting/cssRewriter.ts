/**
 * CSS Rewriter
 * Rewrites CSS files to use on-chain inscription URLs
 */

import { readFile } from 'fs/promises';
import { formatError } from '../../utils/errors.js';
import { shouldSkipUrl } from '../utils.js';
import { resolveReference } from './utils.js';

/**
 * Rewrites CSS content to use ordfs URLs
 */
export async function rewriteCss(
  filePath: string,
  baseDir: string,
  originalPath: string,
  urlMap: Map<string, string>
): Promise<string> {
  let content = await readFile(filePath, 'utf-8');

  // Match url() references
  content = content.replace(/url\(["']?([^"')]+)["']?\)/gi, (match, url) => {
    // Skip external URLs and data URIs
    if (shouldSkipUrl(url)) {
      return match;
    }

    try {
      const resolvedPath = resolveReference(url, originalPath, baseDir);
      const contentUrl = urlMap.get(resolvedPath);

      if (contentUrl) {
        return `url("${contentUrl}")`;
      }
    } catch (error) {
      console.warn(`Could not resolve reference ${url} in ${originalPath}:`, formatError(error));
    }

    return match;
  });

  return content;
}
