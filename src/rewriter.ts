import { readFile } from 'fs/promises';
import { dirname, relative, resolve, join } from 'path';
import type { InscribedFile } from './types.js';
import type { BrowserIndexerConfig } from './services/IndexerService.js';

// Script template paths
const VERSION_REDIRECT_SCRIPT_PATH = join(
  import.meta.dirname || __dirname,
  'versionRedirect.template.js'
);
const SERVICE_RESOLVER_SCRIPT_PATH = join(
  import.meta.dirname || __dirname,
  'serviceResolver.template.js'
);
const CONTRACT_ARTIFACT_PATH = join(
  import.meta.dirname || __dirname,
  '../artifacts/contracts/reactOnchainVersioning.json'
);

/**
 * Creates a mapping of original paths to ordfs URLs
 */
export function createUrlMap(inscriptions: InscribedFile[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const inscription of inscriptions) {
    map.set(inscription.originalPath, inscription.url);
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
        const ordfsUrl = urlMap.get(resolvedPath);

        if (ordfsUrl) {
          return `${before}${ordfsUrl}${after}`;
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
      const ordfsUrl = urlMap.get(resolvedPath);

      if (ordfsUrl) {
        return `url("${ordfsUrl}")`;
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
      const ordfsUrl = urlMap.get(resolvedPath);

      if (ordfsUrl) {
        // Preserve the quote style from the original
        const quote = match[0];
        return `${quote}${ordfsUrl}${quote}`;
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
        const ordfsUrl = urlMap.get(resolvedPath);

        if (ordfsUrl) {
          return match.replace(ref, ordfsUrl);
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
 * Injects service resolver script into HTML content
 *
 * @param htmlContent - Original HTML content
 * @param ordinalsServices - Array of ordinals service URLs
 * @param primaryService - Primary service URL
 * @returns Modified HTML with injected script
 */
export async function injectServiceResolverScript(
  htmlContent: string,
  ordinalsServices: string[],
  primaryService: string
): Promise<string> {
  // Read the service resolver script template
  let scriptContent: string;
  try {
    scriptContent = await readFile(SERVICE_RESOLVER_SCRIPT_PATH, 'utf-8');
  } catch (error) {
    console.warn('Could not load service resolver script template:', error);
    return htmlContent;
  }

  // Replace placeholders
  scriptContent = scriptContent
    .replace(/__ORDINALS_SERVICES__/g, JSON.stringify(ordinalsServices))
    .replace(/__PRIMARY_SERVICE__/g, primaryService);

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
 * Injects version redirect script into HTML content
 *
 * @param htmlContent - Original HTML content
 * @param versioningContractOutpoint - Outpoint of the versioning contract
 * @param indexerConfigs - Array of browser-compatible indexer configurations
 * @param ordinalsServices - Array of ordinals content service URLs
 * @returns Modified HTML with injected script
 */
export async function injectVersionScript(
  htmlContent: string,
  versioningContractOutpoint: string,
  indexerConfigs: BrowserIndexerConfig[],
  ordinalsServices: string[]
): Promise<string> {
  // Read the version redirect script template
  let scriptContent: string;
  try {
    scriptContent = await readFile(VERSION_REDIRECT_SCRIPT_PATH, 'utf-8');
  } catch (error) {
    console.warn('Could not load version redirect script template:', error);
    return htmlContent;
  }

  // Read the contract artifact JSON
  let artifactJson: string;
  try {
    artifactJson = await readFile(CONTRACT_ARTIFACT_PATH, 'utf-8');
  } catch (error) {
    console.warn('Could not load contract artifact:', error);
    return htmlContent;
  }

  // Serialize browser indexer configs
  // Functions need to be converted to strings and reconstructed in browser
  const serializedConfigs = indexerConfigs.map((config) => ({
    name: config.name,
    baseUrl: config.baseUrl,
    endpoints: {
      fetchLatestByOrigin: config.endpoints.fetchLatestByOrigin.toString(),
      getTransaction: config.endpoints.getTransaction.toString(),
    },
    parseLatestByOrigin: config.parseLatestByOrigin
      ? config.parseLatestByOrigin.toString()
      : undefined,
  }));

  // Replace placeholders (note: use single replace to avoid issues with global replace)
  scriptContent = scriptContent
    .replace('VERSIONING_CONTRACT_OUTPOINT_PLACEHOLDER', versioningContractOutpoint)
    .replace('CONTRACT_ARTIFACT_PLACEHOLDER', artifactJson)
    .replace('INDEXER_CONFIGS_PLACEHOLDER', JSON.stringify(serializedConfigs))
    .replace('ORDINALS_SERVICES_PLACEHOLDER', JSON.stringify(ordinalsServices));

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
