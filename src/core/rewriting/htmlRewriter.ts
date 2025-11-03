/**
 * HTML Rewriter
 * Rewrites HTML files to use on-chain inscription URLs
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { formatError } from '../../utils/errors.js';
import { shouldSkipUrl } from '../utils.js';
import { resolveReference } from './utils.js';

// Script template paths
const VERSION_REDIRECT_SCRIPT_PATH = join(
  import.meta.dirname || __dirname,
  './templates/versionRedirect.template.js'
);

const BASE_PATH_FIX_SCRIPT_PATH = join(
  import.meta.dirname || __dirname,
  './templates/basePathFix.template.js'
);

const WEBPACK_PUBLIC_PATH_FIX_SCRIPT_PATH = join(
  import.meta.dirname || __dirname,
  './templates/webpackPublicPathFix.template.js'
);

/**
 * Injects a script into the HTML <head> section
 * If no <head> tag exists, injects at the beginning
 */
async function injectScriptIntoHead(
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

  // Inject the script into the <head> section
  const headMatch = htmlContent.match(/<head[^>]*>/i);
  if (headMatch) {
    const headTag = headMatch[0];
    const insertPosition = headMatch.index! + headTag.length;
    const injectedScript = `\n<script>\n${scriptContent}\n</script>\n`;

    return (
      htmlContent.substring(0, insertPosition) +
      injectedScript +
      htmlContent.substring(insertPosition)
    );
  }

  // No <head> tag found, inject at the beginning
  const injectedScript = `<script>\n${scriptContent}\n</script>\n`;
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
    { regex: /(<meta[^>]+content=["'])([^"']+)(["'][^>]*>)/gi, attr: 'content' },
  ];

  for (const { regex } of patterns) {
    content = content.replace(regex, (match, before, url, after) => {
      // Skip external URLs and data URIs
      if (shouldSkipUrl(url)) {
        return match;
      }

      try {
        const resolvedPath = resolveReference(url, originalPath, baseDir);
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

  return content;
}

/**
 * Injects version redirect script into HTML content
 *
 * @param htmlContent - Original HTML content
 * @param versionInscriptionOrigin - Origin outpoint of the versioning inscription
 * @returns Modified HTML with injected script
 */
export async function injectVersionScript(
  htmlContent: string,
  versionInscriptionOrigin: string
): Promise<string> {
  return injectScriptIntoHead(
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
 * This script automatically detects ordfs deployment paths and sets the correct base href
 * for React Router and other client-side routing libraries
 *
 * @param htmlContent - Original HTML content
 * @returns Modified HTML with injected base path fix script
 */
export async function injectBasePathFix(htmlContent: string): Promise<string> {
  return injectScriptIntoHead(
    htmlContent,
    BASE_PATH_FIX_SCRIPT_PATH,
    'Could not load base path fix script template'
  );
}

/**
 * Injects the webpack public path fix script into HTML content
 * This script sets webpack's __webpack_public_path__ to "/" before bundles load
 * This ensures webpack's runtime asset concatenation works correctly with inscription URLs
 *
 * MUST be injected BEFORE any webpack bundle scripts
 *
 * @param htmlContent - Original HTML content
 * @returns Modified HTML with injected webpack public path fix script
 */
export async function injectWebpackPublicPathFix(htmlContent: string): Promise<string> {
  return injectScriptIntoHead(
    htmlContent,
    WEBPACK_PUBLIC_PATH_FIX_SCRIPT_PATH,
    'Could not load webpack public path fix script template'
  );
}
