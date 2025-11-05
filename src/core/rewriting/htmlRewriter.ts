/**
 * HTML Rewriter
 * Rewrites HTML files to use on-chain inscription URLs
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { formatError } from '../../utils/errors.js';
import { shouldSkipUrl } from '../utils.js';
import { resolveAssetPath } from '../utils.js';
import {
  STATIC_WEBPACK_FIX_OUTPOINT,
  STATIC_BASE_PATH_FIX_OUTPOINT,
  CONTENT_PATH_PREFIX,
} from '../../utils/constants.js';

// Script template paths (for inline scripts only)
const VERSION_REDIRECT_SCRIPT_PATH = join(
  import.meta.dirname || __dirname,
  './templates/versionRedirect.template.js'
);

/**
 * Minifies JavaScript code for inline scripts
 * Removes comments, excessive whitespace, and newlines
 *
 * @param script - JavaScript code to minify
 * @returns Minified JavaScript code
 */
export function minifyScript(script: string): string {
  return (
    script
      // Remove single-line comments (but preserve URLs with //)
      .replace(/(?:^|\s)\/\/(?![^\n]*:\/\/).*$/gm, '')
      // Remove multi-line comments
      .replace(/\/\*[\s\S]*?\*\//g, '')
      // Remove leading/trailing whitespace from lines
      .replace(/^\s+|\s+$/gm, '')
      // Remove empty lines
      .replace(/\n+/g, '\n')
      // Condense multiple spaces into one
      .replace(/  +/g, ' ')
      // Remove newlines (but keep semicolons)
      .replace(/\n/g, '')
      // Clean up spacing around operators and braces
      .replace(/\s*([{}();,=<>!+\-*/%&|])\s*/g, '$1')
      // But keep space after keywords
      .replace(/\b(if|for|while|function|return|var|let|const|try|catch)\(/g, '$1 (')
      .trim()
  );
}

/**
 * Injects an external script reference into HTML <head>
 */
function injectExternalScriptReference(htmlContent: string, scriptUrl: string): string {
  const scriptTag = `\n<script src="${scriptUrl}"></script>\n`;

  const headMatch = htmlContent.match(/<head[^>]*>/i);
  if (headMatch) {
    const headTag = headMatch[0];
    const insertPosition = headMatch.index! + headTag.length;
    return (
      htmlContent.substring(0, insertPosition) + scriptTag + htmlContent.substring(insertPosition)
    );
  }

  // No <head> tag found, inject at the beginning
  return scriptTag + htmlContent;
}

/**
 * Injects an inline minified script into HTML <head>
 */
async function injectInlineScript(
  htmlContent: string,
  scriptPath: string,
  errorMessage: string,
  placeholder?: { key: string; value: string }
): Promise<string> {
  // Read the script template
  let scriptContent: string;
  try {
    scriptContent = await readFile(scriptPath, 'utf-8');
  } catch (error) {
    console.warn(`${errorMessage}:`, formatError(error));
    return htmlContent;
  }

  // Replace placeholder if provided
  if (placeholder) {
    scriptContent = scriptContent.replace(placeholder.key, placeholder.value);
  }

  // Minify the script
  const minified = minifyScript(scriptContent);

  // Inject the minified script into the <head> section
  const headMatch = htmlContent.match(/<head[^>]*>/i);
  if (headMatch) {
    const headTag = headMatch[0];
    const insertPosition = headMatch.index! + headTag.length;
    const injectedScript = `\n<script>${minified}</script>\n`;

    return (
      htmlContent.substring(0, insertPosition) +
      injectedScript +
      htmlContent.substring(insertPosition)
    );
  }

  // No <head> tag found, inject at the beginning
  const injectedScript = `<script>${minified}</script>\n`;
  return injectedScript + htmlContent;
}

/**
 * Rewrites HTML content to use ordfs URLs
 */
export async function rewriteHtml(
  filePath: string,
  baseDir: string,
  originalPath: string,
  urlMap: Map<string, string>
): Promise<string> {
  let content = await readFile(filePath, 'utf-8');

  // Patterns to match and their attribute names
  const patterns = [
    { regex: /(<script[^>]+src=["'])([^"']+)(["'][^>]*>)/gi, attr: 'src' },
    { regex: /(<link[^>]+href=["'])([^"']+)(["'][^>]*>)/gi, attr: 'href' },
    { regex: /(<img[^>]+src=["'])([^"']+)(["'][^>]*>)/gi, attr: 'src' },
    { regex: /(<source[^>]+src=["'])([^"']+)(["'][^>]*>)/gi, attr: 'src' },
    { regex: /(<video[^>]+src=["'])([^"']+)(["'][^>]*>)/gi, attr: 'src' },
    { regex: /(<audio[^>]+src=["'])([^"']+)(["'][^>]*>)/gi, attr: 'src' },
    { regex: /(<video[^>]+poster=["'])([^"']+)(["'][^>]*>)/gi, attr: 'poster' },
    { regex: /(<object[^>]+data=["'])([^"']+)(["'][^>]*>)/gi, attr: 'data' },
    { regex: /(<embed[^>]+src=["'])([^"']+)(["'][^>]*>)/gi, attr: 'src' },
    { regex: /(<track[^>]+src=["'])([^"']+)(["'][^>]*>)/gi, attr: 'src' },
    { regex: /(<iframe[^>]+src=["'])([^"']+)(["'][^>]*>)/gi, attr: 'src' },
    { regex: /(<meta[^>]+content=["'])([^"']+)(["'][^>]*>)/gi, attr: 'content' },
    // Handle data-* attributes with asset references (matches analyzer detection)
    {
      regex:
        /(data-[a-z-]+=["'])([^"']*\.(?:png|jpg|jpeg|gif|svg|webp|mp4|m4v|mov|webm|avi|mkv|flv|wmv|ogg|ogv|mp3|m4a|aac|oga|flac|wav|ico))(["'])/gi,
      attr: 'data-*',
    },
  ];

  for (const { regex } of patterns) {
    content = content.replace(regex, (match, before, url, after) => {
      // Skip external URLs and data URIs
      if (shouldSkipUrl(url)) {
        return match;
      }

      try {
        const resolvedPath = resolveAssetPath(url, originalPath, baseDir);
        const contentUrl = urlMap.get(resolvedPath);

        if (contentUrl) {
          return `${before}${contentUrl}${after}`;
        }
      } catch (error) {
        console.warn(`Could not resolve reference ${url} in ${originalPath}:`, formatError(error));
      }

      return match;
    });
  }

  // Handle srcset attributes (responsive images)
  // srcset format: "image1.jpg 100w, image2.jpg 200w" or "image1.jpg 1x, image2.jpg 2x"
  const srcsetPattern = /(<(?:img|source)[^>]+srcset=["'])([^"']+)(["'][^>]*>)/gi;
  content = content.replace(srcsetPattern, (_match, before, srcsetValue, after) => {
    // Split by comma and process each URL+descriptor pair
    const srcsetItems = srcsetValue.split(',').map((item: string) => item.trim());
    const rewrittenItems = srcsetItems.map((item: string) => {
      // Split on whitespace to separate URL from descriptor (1x, 2x, 100w, etc.)
      const parts = item.trim().split(/\s+/);
      const url = parts[0];
      const descriptor = parts.slice(1).join(' '); // Preserve any descriptors

      if (shouldSkipUrl(url)) {
        return item;
      }

      try {
        const resolvedPath = resolveAssetPath(url, originalPath, baseDir);
        const contentUrl = urlMap.get(resolvedPath);

        if (contentUrl) {
          // Return rewritten URL with original descriptor
          return descriptor ? `${contentUrl} ${descriptor}` : contentUrl;
        }
      } catch (error) {
        console.warn(
          `Could not resolve srcset reference ${url} in ${originalPath}:`,
          formatError(error)
        );
      }

      return item;
    });

    return `${before}${rewrittenItems.join(', ')}${after}`;
  });

  return content;
}

/**
 * Injects banner comment into HTML content
 * Adds a professional comment header to the HTML
 *
 * @param htmlContent - Original HTML content
 * @returns Modified HTML with banner comment
 */
export function injectBannerComment(htmlContent: string): string {
  const banner = `<!--
  Deployed with React Onchain
  An open-source tool for deploying React apps permanently to the Bitcoin blockchain
  with automatic versioning and immutable hosting.

  Learn more at: https://reactonchain.com
-->
`;

  // Inject after <!DOCTYPE html> if present, otherwise at the beginning
  const doctypeMatch = htmlContent.match(/<!DOCTYPE[^>]+>\s*/i);
  if (doctypeMatch) {
    const doctypeEnd = doctypeMatch.index! + doctypeMatch[0].length;
    return htmlContent.substring(0, doctypeEnd) + banner + htmlContent.substring(doctypeEnd);
  }

  // No DOCTYPE, inject at the very beginning
  return banner + htmlContent;
}

/**
 * Injects version redirect script into HTML content
 * This is a dynamic script that varies per deployment (needs VERSION_INSCRIPTION_ORIGIN)
 * Injected as minified inline script to reduce HTML size
 *
 * @param htmlContent - Original HTML content
 * @param versionInscriptionOrigin - Origin outpoint of the versioning inscription
 * @returns Modified HTML with injected minified script
 */
export async function injectVersionScript(
  htmlContent: string,
  versionInscriptionOrigin: string
): Promise<string> {
  return injectInlineScript(
    htmlContent,
    VERSION_REDIRECT_SCRIPT_PATH,
    'Could not load version redirect script template',
    {
      key: '__VERSION_INSCRIPTION_ORIGIN__',
      value: versionInscriptionOrigin,
    }
  );
}

/**
 * Injects the base path fix script into HTML content
 * This is a static script (same for all apps), referenced externally from permanent inscription
 * This script automatically detects ordfs deployment paths and sets the correct base href
 * for React Router and other client-side routing libraries
 *
 * @param htmlContent - Original HTML content
 * @returns Modified HTML with injected external script reference
 */
export async function injectBasePathFix(htmlContent: string): Promise<string> {
  const scriptUrl = `${CONTENT_PATH_PREFIX}${STATIC_BASE_PATH_FIX_OUTPOINT}`;
  return injectExternalScriptReference(htmlContent, scriptUrl);
}

/**
 * Injects the webpack public path fix script into HTML content
 * This is a static script (same for all apps), referenced externally from permanent inscription
 * This script sets webpack's __webpack_public_path__ to "" before bundles load
 * This ensures webpack's runtime asset concatenation works correctly with inscription URLs
 *
 * MUST be injected BEFORE any webpack bundle scripts
 *
 * @param htmlContent - Original HTML content
 * @returns Modified HTML with injected external script reference
 */
export async function injectWebpackPublicPathFix(htmlContent: string): Promise<string> {
  const scriptUrl = `${CONTENT_PATH_PREFIX}${STATIC_WEBPACK_FIX_OUTPOINT}`;
  return injectExternalScriptReference(htmlContent, scriptUrl);
}
