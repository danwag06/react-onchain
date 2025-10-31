import { readFile } from 'fs/promises';
import { dirname, relative, resolve, join } from 'path';
import type { InscribedFile } from './types.js';
import type { BrowserIndexerConfig } from './services/IndexerService.js';

// Script template paths
const VERSION_REDIRECT_SCRIPT_PATH = join(
  import.meta.dirname || __dirname,
  'versionRedirect.template.js'
);

const BASE_PATH_FIX_SCRIPT_PATH = join(import.meta.dirname || __dirname, 'basePathFix.template.js');

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
function resolveReference(ref: string, sourceFile: string, baseDir: string): string {
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
      if (url.startsWith('http') || url.startsWith('//') || url.startsWith('data:')) {
        return match;
      }

      try {
        const resolvedPath = resolveReference(url, originalPath, baseDir);
        const contentUrl = urlMap.get(resolvedPath);

        if (contentUrl) {
          return `${before}${contentUrl}${after}`;
        }
      } catch (error) {
        console.warn(`Could not resolve reference ${url} in ${originalPath}`);
      }

      return match;
    });
  }

  return content;
}

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
    if (url.startsWith('http') || url.startsWith('//') || url.startsWith('data:')) {
      return match;
    }

    try {
      const resolvedPath = resolveReference(url, originalPath, baseDir);
      const contentUrl = urlMap.get(resolvedPath);

      if (contentUrl) {
        return `url("${contentUrl}")`;
      }
    } catch (error) {
      console.warn(`Could not resolve reference ${url} in ${originalPath}`);
    }

    return match;
  });

  return content;
}

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
      console.warn(`Could not resolve reference ${ref} in ${originalPath}`);
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
        console.warn(`Could not resolve import ${ref} in ${originalPath}`);
      }
    }
    return match;
  });

  return content;
}

/**
 * Rewrites file content based on file type
 */
export async function rewriteFile(
  filePath: string,
  baseDir: string,
  originalPath: string,
  contentType: string,
  urlMap: Map<string, string>
): Promise<string> {
  if (contentType === 'text/html') {
    return await rewriteHtml(filePath, baseDir, originalPath, urlMap);
  } else if (contentType === 'text/css') {
    return await rewriteCss(filePath, baseDir, originalPath, urlMap);
  } else if (contentType === 'application/javascript') {
    return await rewriteJs(filePath, baseDir, originalPath, urlMap);
  } else {
    // For other file types, return as-is (binary files, etc.)
    const buffer = await readFile(filePath);
    return buffer.toString('utf-8');
  }
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
  // Read the version redirect script template
  let scriptContent: string;
  try {
    scriptContent = await readFile(VERSION_REDIRECT_SCRIPT_PATH, 'utf-8');
  } catch (error) {
    console.warn('Could not load version redirect script template:', error);
    return htmlContent;
  }

  // Replace placeholder
  scriptContent = scriptContent.replace('__VERSION_INSCRIPTION_ORIGIN__', versionInscriptionOrigin);

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
  } else {
    // No <head> tag found, inject at the beginning
    const injectedScript = `<script>\n${scriptContent}\n</script>\n`;
    return injectedScript + htmlContent;
  }
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
  // Read the base path fix script template
  let scriptContent: string;
  try {
    scriptContent = await readFile(BASE_PATH_FIX_SCRIPT_PATH, 'utf-8');
  } catch (error) {
    console.warn('Could not load base path fix script template:', error);
    return htmlContent;
  }

  // Inject the script into the <head> section (before any other scripts)
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
  } else {
    // No <head> tag found, inject at the beginning
    const injectedScript = `<script>\n${scriptContent}\n</script>\n`;
    return injectedScript + htmlContent;
  }
}
