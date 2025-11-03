/**
 * JavaScript Rewriter
 * Rewrites JavaScript files to use on-chain inscription URLs
 */

import { readFile } from 'fs/promises';
import { formatError } from '../../utils/errors.js';
import { createAssetPathPattern, resolveAssetPath } from '../utils.js';

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
  // Uses shared pattern that handles both explicit paths and webpack-style paths
  const assetPattern = createAssetPathPattern();

  content = content.replace(assetPattern, (match, ref) => {
    try {
      const resolvedPath = resolveAssetPath(ref, originalPath, baseDir);
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

  // CRITICAL: Remove webpack public path concatenation
  // Webpack bundles contain patterns like: n.p+"/content/..." or __webpack_public_path__+"/content/..."
  // We need to remove the concatenation to get just: "/content/..."
  // This must run AFTER the asset pattern replacement above
  const webpackConcatPattern =
    /(\w+\.p|\w+\.__webpack_public_path__|\b__webpack_public_path__)\s*\+\s*(["']\/content\/[a-f0-9]{64}_\d+["'])/gi;
  content = content.replace(webpackConcatPattern, (match, publicPath, url) => {
    // Just return the URL without the webpack public path concatenation
    return url;
  });

  // Also handle import statements (though these are less common in bundled code)
  content = content.replace(/import\s+.*?from\s+["']([^"']+)["']/g, (match, ref) => {
    if (ref.startsWith('./') || ref.startsWith('../') || ref.startsWith('/')) {
      try {
        const resolvedPath = resolveAssetPath(ref, originalPath, baseDir);
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
