/**
 * SVG Rewriter
 * Rewrites SVG files to use on-chain inscription URLs
 * Handles href, xlink:href attributes and url() in styles
 */

import { readFile } from 'fs/promises';
import { formatError } from '../../utils/errors.js';
import { shouldSkipUrl, resolveAssetPath } from '../utils.js';

/**
 * Rewrites SVG content to use ordfs URLs
 * Handles href/xlink:href attributes and url() in style attributes and <style> blocks
 */
export async function rewriteSvg(
  filePath: string,
  baseDir: string,
  originalPath: string,
  urlMap: Map<string, string>
): Promise<string> {
  let content = await readFile(filePath, 'utf-8');

  // Patterns for href and xlink:href attributes
  // These are used in <use>, <image>, <a>, <script>, <style> elements
  const hrefPatterns = [
    { regex: /(<[^>]+href=["'])([^"'#]+)(["'][^>]*>)/gi, attr: 'href' },
    { regex: /(<[^>]+xlink:href=["'])([^"'#]+)(["'][^>]*>)/gi, attr: 'xlink:href' },
  ];

  for (const { regex } of hrefPatterns) {
    content = content.replace(regex, (match, before, url, after) => {
      // SVG hrefs can have fragment identifiers (#id) - preserve them
      const [urlPath, fragment] = url.split('#');
      const actualUrl = urlPath.trim();

      // Skip if no actual URL (just fragment) or external URLs
      if (!actualUrl || shouldSkipUrl(actualUrl)) {
        return match;
      }

      try {
        const resolvedPath = resolveAssetPath(actualUrl, originalPath, baseDir);
        const contentUrl = urlMap.get(resolvedPath);

        if (contentUrl) {
          // Reconstruct with fragment if it existed
          const rewrittenUrl = fragment ? `${contentUrl}#${fragment}` : contentUrl;
          return `${before}${rewrittenUrl}${after}`;
        }
      } catch (error) {
        console.warn(
          `Could not resolve SVG reference ${actualUrl} in ${originalPath}:`,
          formatError(error)
        );
      }

      return match;
    });
  }

  // Handle url() in style attributes and <style> blocks
  // Pattern: url('image.png') or url("image.png") or url(image.png)
  const urlPattern = /url\((['"]?)([^'"()]+)\1\)/gi;
  content = content.replace(urlPattern, (match, quote, url) => {
    const trimmedUrl = url.trim();

    // Skip data URIs and external URLs
    if (shouldSkipUrl(trimmedUrl)) {
      return match;
    }

    // Skip fragment-only references (e.g., url(#gradient))
    if (trimmedUrl.startsWith('#')) {
      return match;
    }

    try {
      const resolvedPath = resolveAssetPath(trimmedUrl, originalPath, baseDir);
      const contentUrl = urlMap.get(resolvedPath);

      if (contentUrl) {
        return `url(${quote}${contentUrl}${quote})`;
      }
    } catch (error) {
      console.warn(
        `Could not resolve SVG url() reference ${trimmedUrl} in ${originalPath}:`,
        formatError(error)
      );
    }

    return match;
  });

  return content;
}
