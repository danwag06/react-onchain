/**
 * CSS Rewriter
 * Rewrites CSS files to use on-chain inscription URLs
 */

import { readFile } from 'fs/promises';
import { formatError } from '../../utils/errors.js';
import { shouldSkipUrl, resolveAssetPath } from '../utils.js';

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
      const resolvedPath = resolveAssetPath(url, originalPath, baseDir);
      const contentUrl = urlMap.get(resolvedPath);

      if (contentUrl) {
        return `url("${contentUrl}")`;
      }
    } catch (error) {
      console.warn(`Could not resolve reference ${url} in ${originalPath}:`, formatError(error));
    }

    return match;
  });

  // Match @import statements
  // Formats: @import url("file.css") or @import "file.css"
  content = content.replace(/@import\s+(?:url\()?["']([^"']+)["']\)?/gi, (match, url) => {
    // Skip external URLs
    if (shouldSkipUrl(url)) {
      return match;
    }

    try {
      const resolvedPath = resolveAssetPath(url, originalPath, baseDir);
      const contentUrl = urlMap.get(resolvedPath);

      if (contentUrl) {
        return `@import url("${contentUrl}")`;
      }
    } catch (error) {
      console.warn(
        `Could not resolve @import reference ${url} in ${originalPath}:`,
        formatError(error)
      );
    }

    return match;
  });

  // Match image-set() function
  // Format: image-set("image.webp" 1x, "image@2x.webp" 2x)
  content = content.replace(/image-set\(([^)]+)\)/gi, (_match, imageSetValue) => {
    // Split by comma and process each URL+descriptor pair
    const imageSetItems = imageSetValue.split(',').map((item: string) => item.trim());
    const rewrittenItems = imageSetItems.map((item: string) => {
      // Match URL in quotes followed by optional descriptor
      const urlMatch = item.match(/["']([^"']+)["'](\s+[^\s,]+)?/);
      if (!urlMatch) {
        return item;
      }

      const url = urlMatch[1];
      const descriptor = urlMatch[2] || '';

      if (shouldSkipUrl(url)) {
        return item;
      }

      try {
        const resolvedPath = resolveAssetPath(url, originalPath, baseDir);
        const contentUrl = urlMap.get(resolvedPath);

        if (contentUrl) {
          return `"${contentUrl}"${descriptor}`;
        }
      } catch (error) {
        console.warn(
          `Could not resolve image-set() reference ${url} in ${originalPath}:`,
          formatError(error)
        );
      }

      return item;
    });

    return `image-set(${rewrittenItems.join(', ')})`;
  });

  return content;
}
