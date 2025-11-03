/**
 * JavaScript Rewriter
 * Rewrites JavaScript files to use on-chain inscription URLs
 */

import { readFile } from 'fs/promises';
import { formatError } from '../../utils/errors.js';
import { resolveReference } from './utils.js';

/**
 * Rewrites JavaScript content to use ordfs URLs
 */
export async function rewriteJs(
  filePath: string,
  baseDir: string,
  originalPath: string,
  urlMap: Map<string, string>
): Promise<string> {
  let content = await readFile(filePath, 'utf-8');

  // Match string literals that look like asset paths
  const assetPattern =
    /["'](\.{0,2}\/[^"']*\.(png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot|otf|json|css|js|mjs))["']/gi;

  content = content.replace(assetPattern, (match, ref) => {
    try {
      const resolvedPath = resolveReference(ref, originalPath, baseDir);
      const contentUrl = urlMap.get(resolvedPath);

      if (contentUrl) {
        // Preserve the quote style from the original
        const quote = match[0];
        return `${quote}${contentUrl}${quote}`;
      }
    } catch (error) {
      console.warn(`Could not resolve reference ${ref} in ${originalPath}:`, formatError(error));
    }

    return match;
  });

  // Also handle import statements (though these are less common in bundled code)
  content = content.replace(/import\s+.*?from\s+["']([^"']+)["']/g, (match, ref) => {
    if (ref.startsWith('./') || ref.startsWith('../') || ref.startsWith('/')) {
      try {
        const resolvedPath = resolveReference(ref, originalPath, baseDir);
        const contentUrl = urlMap.get(resolvedPath);

        if (contentUrl) {
          return match.replace(ref, contentUrl);
        }
      } catch (error) {
        console.warn(`Could not resolve import ${ref} in ${originalPath}:`, formatError(error));
      }
    }
    return match;
  });

  return content;
}
