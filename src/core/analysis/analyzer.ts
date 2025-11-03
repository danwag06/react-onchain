import { readdir, readFile } from 'fs/promises';
import { join, extname, relative, dirname, resolve } from 'path';
import { createHash } from 'crypto';
import type { FileReference, DependencyNode, CONTENT_TYPES } from './analyzer.types.js';
import { formatError } from '../../utils/errors.js';
import { shouldSkipUrl, createAssetPathPattern, resolveAssetPath } from '../utils.js';

const CONTENT_TYPE_MAP: typeof CONTENT_TYPES = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.flv': 'video/x-flv',
  '.wmv': 'video/x-ms-wmv',
  '.ogg': 'video/ogg',
  '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.oga': 'audio/ogg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
};

/**
 * Recursively scans a directory for all files
 */
/**
 * Files and directories that should NEVER be deployed
 * SECURITY: .env files contain secrets and must be excluded!
 */
const EXCLUDED_PATTERNS = [
  /^\.env/, // .env, .env.local, .env.production, etc.
  /^deployment-manifest.*\.json$/, // deployment-manifest.json, deployment-manifest-backup.json, etc.
  /^\.git/, // .git, .gitignore, .github, etc.
  /^\.DS_Store$/, // macOS metadata
  /^Thumbs\.db$/, // Windows metadata
  /^node_modules$/, // Dependencies (shouldn't be in build dir, but just in case)
  /^\.vscode$/, // VS Code settings
  /^\.idea$/, // IntelliJ settings
];

/**
 * Check if a filename should be excluded from deployment
 */
function shouldExcludeFile(filename: string): boolean {
  return EXCLUDED_PATTERNS.some((pattern) => pattern.test(filename));
}

async function scanDirectory(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    // Skip excluded files and directories
    if (shouldExcludeFile(entry.name)) {
      continue;
    }

    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await scanDirectory(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Extracts file references from HTML content
 */
function extractHtmlReferences(content: string, baseDir: string, filePath: string): string[] {
  const references: string[] = [];
  const fileDir = dirname(filePath);

  // Match script src, link href, img src, etc.
  const patterns = [
    /<script[^>]+src=["']([^"']+)["']/gi,
    /<link[^>]+href=["']([^"']+)["']/gi,
    /<img[^>]+src=["']([^"']+)["']/gi,
    /<source[^>]+src=["']([^"']+)["']/gi,
    /<video[^>]+src=["']([^"']+)["']/gi,
    /<audio[^>]+src=["']([^"']+)["']/gi,
    /<video[^>]+poster=["']([^"']+)["']/gi, // Video poster thumbnails
    /<object[^>]+data=["']([^"']+)["']/gi, // Object data
    /<embed[^>]+src=["']([^"']+)["']/gi, // Embed src
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const ref = match[1];
      // Skip external URLs and data URIs
      if (!shouldSkipUrl(ref)) {
        // Resolve relative to the HTML file
        const resolvedPath = ref.startsWith('/')
          ? join(baseDir, ref.substring(1))
          : resolve(fileDir, ref);
        references.push(resolvedPath);
      }
    }
  }

  // Handle srcset attributes (responsive images)
  // srcset format: "image1.jpg 100w, image2.jpg 200w" or "image1.jpg 1x, image2.jpg 2x"
  const srcsetPattern = /<(?:img|source)[^>]+srcset=["']([^"']+)["']/gi;
  let srcsetMatch;
  while ((srcsetMatch = srcsetPattern.exec(content)) !== null) {
    const srcsetValue = srcsetMatch[1];
    // Split by comma and extract just the URL part (before the descriptor)
    const srcsetUrls = srcsetValue.split(',').map((item) => item.trim().split(/\s+/)[0]);
    for (const url of srcsetUrls) {
      if (url && !shouldSkipUrl(url)) {
        const resolvedPath = url.startsWith('/')
          ? join(baseDir, url.substring(1))
          : resolve(fileDir, url);
        references.push(resolvedPath);
      }
    }
  }

  // Handle manifest links (PWA)
  // Match both orders: rel then href, or href then rel
  const manifestPatterns = [
    /<link[^>]*rel=["']manifest["'][^>]*href=["']([^"']+)["']/gi,
    /<link[^>]*href=["']([^"']+)["'][^>]*rel=["']manifest["']/gi,
  ];
  for (const pattern of manifestPatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const ref = match[1];
      if (!shouldSkipUrl(ref)) {
        const resolvedPath = ref.startsWith('/')
          ? join(baseDir, ref.substring(1))
          : resolve(fileDir, ref);
        references.push(resolvedPath);
      }
    }
  }

  // Handle favicons and app icons
  // Match patterns like: rel="icon", rel="apple-touch-icon", rel="shortcut icon"
  const iconPatterns = [
    /<link[^>]*rel=["'][^"']*icon[^"']*["'][^>]*href=["']([^"']+)["']/gi,
    /<link[^>]*href=["']([^"']+)["'][^>]*rel=["'][^"']*icon[^"']*["']/gi,
  ];
  for (const pattern of iconPatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const ref = match[1];
      if (!shouldSkipUrl(ref)) {
        const resolvedPath = ref.startsWith('/')
          ? join(baseDir, ref.substring(1))
          : resolve(fileDir, ref);
        references.push(resolvedPath);
      }
    }
  }

  // Separately handle meta tags with og:image or twitter:image properties
  // These can have property/content in either order
  const metaImagePatterns = [
    /<meta[^>]*property=["'](?:og:image|twitter:image)["'][^>]*content=["']([^"']+)["']/gi,
    /<meta[^>]*content=["']([^"']+)["'][^>]*property=["'](?:og:image|twitter:image)["']/gi,
  ];

  for (const pattern of metaImagePatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const ref = match[1];
      // Skip external URLs and data URIs
      if (!shouldSkipUrl(ref)) {
        // Resolve relative to the HTML file
        const resolvedPath = ref.startsWith('/')
          ? join(baseDir, ref.substring(1))
          : resolve(fileDir, ref);
        references.push(resolvedPath);
      }
    }
  }

  // Handle data-* attributes with common asset patterns
  // This catches patterns like data-src, data-background, data-poster, etc.
  const dataAttrPattern =
    /data-[a-z-]+\s*=\s*["']([^"']*\.(png|jpg|jpeg|gif|svg|webp|mp4|m4v|mov|webm|avi|mkv|flv|wmv|ogg|ogv|mp3|m4a|aac|oga|flac|wav|ico))["']/gi;
  let dataMatch;
  while ((dataMatch = dataAttrPattern.exec(content)) !== null) {
    const ref = dataMatch[1];
    if (!shouldSkipUrl(ref)) {
      const resolvedPath = ref.startsWith('/')
        ? join(baseDir, ref.substring(1))
        : resolve(fileDir, ref);
      references.push(resolvedPath);
    }
  }

  return references;
}

/**
 * Extracts file references from CSS content
 */
function extractCssReferences(content: string, baseDir: string, filePath: string): string[] {
  const references: string[] = [];
  const fileDir = dirname(filePath);

  // Match url() references
  const urlPattern = /url\(["']?([^"')]+)["']?\)/gi;
  let match;

  while ((match = urlPattern.exec(content)) !== null) {
    const ref = match[1];
    // Skip external URLs and data URIs
    if (!ref.startsWith('http') && !ref.startsWith('//') && !ref.startsWith('data:')) {
      // Resolve relative to the CSS file
      const resolvedPath = ref.startsWith('/')
        ? join(baseDir, ref.substring(1))
        : resolve(fileDir, ref);
      references.push(resolvedPath);
    }
  }

  // Match @import statements
  // Supports both: @import url("file.css") and @import "file.css"
  const importPattern = /@import\s+(?:url\()?["']?([^"';)]+)["']?\)?/gi;
  let importMatch;

  while ((importMatch = importPattern.exec(content)) !== null) {
    const ref = importMatch[1];
    // Skip external URLs and data URIs
    if (!ref.startsWith('http') && !ref.startsWith('//') && !ref.startsWith('data:')) {
      // Resolve relative to the CSS file
      const resolvedPath = ref.startsWith('/')
        ? join(baseDir, ref.substring(1))
        : resolve(fileDir, ref);
      references.push(resolvedPath);
    }
  }

  // Match image-set() function (modern CSS for responsive images)
  // Example: image-set(url("image.jpg") 1x, url("image-2x.jpg") 2x)
  const imageSetPattern = /image-set\s*\([^)]*url\s*\(["']?([^"')]+)["']?\)/gi;
  let imageSetMatch;

  while ((imageSetMatch = imageSetPattern.exec(content)) !== null) {
    const ref = imageSetMatch[1];
    // Skip external URLs and data URIs
    if (!ref.startsWith('http') && !ref.startsWith('//') && !ref.startsWith('data:')) {
      // Resolve relative to the CSS file
      const resolvedPath = ref.startsWith('/')
        ? join(baseDir, ref.substring(1))
        : resolve(fileDir, ref);
      references.push(resolvedPath);
    }
  }

  return references;
}

/**
 * Extracts file references from JavaScript content
 * This is tricky because we need to find dynamic imports and string literals
 */
function extractJsReferences(content: string, baseDir: string, filePath: string): string[] {
  const references: string[] = [];
  const fileDir = dirname(filePath);

  // Match import statements and dynamic imports
  const patterns = [
    /import\s+.*?from\s+["']([^"']+)["']/g,
    /import\(["']([^"']+)["']\)/g,
    /require\(["']([^"']+)["']\)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const ref = match[1];
      // Only process relative paths that look like assets
      if (ref.startsWith('./') || ref.startsWith('../') || ref.startsWith('/')) {
        const resolvedPath = ref.startsWith('/')
          ? join(baseDir, ref.substring(1))
          : resolve(fileDir, ref);
        references.push(resolvedPath);
      }
    }
  }

  // Match new URL() constructor (modern ES module pattern)
  // Example: new URL('./asset.png', import.meta.url)
  const urlConstructorPattern = /new\s+URL\s*\(\s*["']([^"']+)["']/gi;
  let urlMatch;
  while ((urlMatch = urlConstructorPattern.exec(content)) !== null) {
    const ref = urlMatch[1];
    if (ref.startsWith('./') || ref.startsWith('../') || ref.startsWith('/')) {
      const resolvedPath = ref.startsWith('/')
        ? join(baseDir, ref.substring(1))
        : resolve(fileDir, ref);
      references.push(resolvedPath);
    }
  }

  // Match Worker and SharedWorker constructors
  // Example: new Worker('/worker.js') or new Worker(new URL('./worker.js', import.meta.url))
  const workerPattern = /new\s+(?:Worker|SharedWorker)\s*\(\s*["']([^"']+)["']/gi;
  let workerMatch;
  while ((workerMatch = workerPattern.exec(content)) !== null) {
    const ref = workerMatch[1];
    if (ref.startsWith('./') || ref.startsWith('../') || ref.startsWith('/')) {
      const resolvedPath = ref.startsWith('/')
        ? join(baseDir, ref.substring(1))
        : resolve(fileDir, ref);
      references.push(resolvedPath);
    }
  }

  // Match Service Worker registration
  // Example: navigator.serviceWorker.register('/sw.js')
  const serviceWorkerPattern = /\.register\s*\(\s*["']([^"']+)["']/gi;
  let swMatch;
  while ((swMatch = serviceWorkerPattern.exec(content)) !== null) {
    const ref = swMatch[1];
    if (ref.startsWith('./') || ref.startsWith('../') || ref.startsWith('/')) {
      const resolvedPath = ref.startsWith('/')
        ? join(baseDir, ref.substring(1))
        : resolve(fileDir, ref);
      references.push(resolvedPath);
    }
  }

  // Match fetch() calls to local resources
  // Example: fetch('/api/data.json') or fetch('./config.json')
  const fetchPattern = /fetch\s*\(\s*["']([^"']+)["']/gi;
  let fetchMatch;
  while ((fetchMatch = fetchPattern.exec(content)) !== null) {
    const ref = fetchMatch[1];
    // Only include if it looks like a file (has extension or looks like asset path)
    if (
      (ref.startsWith('./') || ref.startsWith('../') || ref.startsWith('/')) &&
      /\.(json|txt|xml|csv|[a-z]{2,4})$/i.test(ref)
    ) {
      const resolvedPath = ref.startsWith('/')
        ? join(baseDir, ref.substring(1))
        : resolve(fileDir, ref);
      references.push(resolvedPath);
    }
  }

  // Match template literals with simple asset paths (no variables)
  // Example: `./image.png` or `/assets/logo.svg`
  const templateLiteralPattern =
    /`(\.{0,2}\/[^`]*\.(png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot|otf|json|wasm|webm|mp4|m4v|mov|avi|mkv|flv|wmv|ogg|ogv|mp3|m4a|aac|oga|flac|wav))`/gi;
  let templateMatch;
  while ((templateMatch = templateLiteralPattern.exec(content)) !== null) {
    const ref = templateMatch[1];
    // Make sure it doesn't contain variable interpolation
    if (!ref.includes('${')) {
      const resolvedPath = ref.startsWith('/')
        ? join(baseDir, ref.substring(1))
        : resolve(fileDir, ref);
      references.push(resolvedPath);
    }
  }

  // Also look for string literals that might be asset paths
  // Uses shared pattern that handles both explicit paths and webpack-style paths
  const assetPattern = createAssetPathPattern();
  let match;

  while ((match = assetPattern.exec(content)) !== null) {
    const ref = match[1];
    // Use shared resolution logic
    const relativePath = resolveAssetPath(ref, filePath, baseDir);
    const resolvedPath = join(baseDir, relativePath);
    references.push(resolvedPath);
  }

  return references;
}

/**
 * Extracts file references from JSON content (e.g., manifest.json)
 */
function extractJsonReferences(content: string, baseDir: string, filePath: string): string[] {
  const references: string[] = [];
  const fileDir = dirname(filePath);

  try {
    const data = JSON.parse(content);

    // Recursively search for properties that might contain file paths
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function searchForPaths(obj: any): void {
      if (typeof obj === 'string') {
        // Check if string looks like a file path
        if (
          (obj.startsWith('./') || obj.startsWith('../') || obj.startsWith('/')) &&
          /\.(png|jpg|jpeg|gif|svg|webp|ico|json|woff|woff2|ttf|eot|otf)$/i.test(obj)
        ) {
          const resolvedPath = obj.startsWith('/')
            ? join(baseDir, obj.substring(1))
            : resolve(fileDir, obj);
          references.push(resolvedPath);
        }
      } else if (Array.isArray(obj)) {
        obj.forEach(searchForPaths);
      } else if (obj && typeof obj === 'object') {
        // Check common property names that contain file paths
        const pathProps = ['src', 'href', 'url', 'icon', 'image', 'file', 'path'];
        for (const key of Object.keys(obj)) {
          if (pathProps.some((prop) => key.toLowerCase().includes(prop))) {
            searchForPaths(obj[key]);
          }
        }
        // Also search nested objects
        Object.values(obj).forEach(searchForPaths);
      }
    }

    searchForPaths(data);
  } catch {
    console.warn('Invalid JSON, skipping file:', filePath);
    // Invalid JSON, skip
  }

  return references;
}

/**
 * Extracts file references from SVG content
 */
function extractSvgReferences(content: string, baseDir: string, filePath: string): string[] {
  const references: string[] = [];
  const fileDir = dirname(filePath);

  // Match href and xlink:href attributes (for <use>, <image>, etc.)
  // This pattern captures the full value including fragments, then we'll strip them
  const hrefPatterns = [/href=["']([^"']+)["']/gi, /xlink:href=["']([^"']+)["']/gi];

  for (const pattern of hrefPatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const ref = match[1];
      // Skip if it starts with # (internal reference only)
      if (!ref.startsWith('#') && !shouldSkipUrl(ref)) {
        // Strip fragment identifier to get the file path
        const pathWithoutFragment = ref.split('#')[0];
        if (pathWithoutFragment) {
          const resolvedPath = pathWithoutFragment.startsWith('/')
            ? join(baseDir, pathWithoutFragment.substring(1))
            : resolve(fileDir, pathWithoutFragment);
          references.push(resolvedPath);
        }
      }
    }
  }

  // Match url() in SVG style attributes and <style> blocks
  const urlPattern = /url\(["']?([^"')]+)["']?\)/gi;
  let match;
  while ((match = urlPattern.exec(content)) !== null) {
    const ref = match[1];
    if (!ref.startsWith('#') && !shouldSkipUrl(ref)) {
      // Strip fragment identifier to get the file path
      const pathWithoutFragment = ref.split('#')[0];
      if (pathWithoutFragment) {
        const resolvedPath = pathWithoutFragment.startsWith('/')
          ? join(baseDir, pathWithoutFragment.substring(1))
          : resolve(fileDir, pathWithoutFragment);
        references.push(resolvedPath);
      }
    }
  }

  return references;
}

/**
 * Analyzes a file and extracts its dependencies
 */
async function analyzeFile(filePath: string, baseDir: string): Promise<FileReference> {
  // Read file as Buffer (works for both text and binary files)
  const contentBuffer = await readFile(filePath);
  const ext = extname(filePath).toLowerCase();
  const relativePath = relative(baseDir, filePath);

  let dependencies: string[] = [];

  // Only extract dependencies from text files that could have them
  if (ext === '.html' || ext === '.htm') {
    const content = contentBuffer.toString('utf-8');
    dependencies = extractHtmlReferences(content, baseDir, filePath);
  } else if (ext === '.css') {
    const content = contentBuffer.toString('utf-8');
    dependencies = extractCssReferences(content, baseDir, filePath);
  } else if (ext === '.js' || ext === '.mjs') {
    const content = contentBuffer.toString('utf-8');
    dependencies = extractJsReferences(content, baseDir, filePath);
  } else if (ext === '.json' || ext === '.webmanifest') {
    const content = contentBuffer.toString('utf-8');
    dependencies = extractJsonReferences(content, baseDir, filePath);
  } else if (ext === '.svg') {
    const content = contentBuffer.toString('utf-8');
    dependencies = extractSvgReferences(content, baseDir, filePath);
  }

  // Remove duplicates and normalize paths
  dependencies = [...new Set(dependencies)].map((dep) => {
    try {
      return relative(baseDir, dep);
    } catch {
      return dep;
    }
  });

  // Compute SHA256 hash of original content buffer (before any rewriting)
  const contentHash = createHash('sha256').update(contentBuffer).digest('hex');

  // Get file size from buffer length
  const fileSize = contentBuffer.length;

  return {
    originalPath: relativePath,
    absolutePath: filePath,
    contentType: CONTENT_TYPE_MAP[ext] || 'application/octet-stream',
    dependencies,
    contentHash,
    fileSize,
  };
}

/**
 * Builds a dependency graph from file references
 */
export function buildDependencyGraph(files: FileReference[]): Map<string, DependencyNode> {
  const graph = new Map<string, DependencyNode>();

  // Create nodes
  for (const file of files) {
    graph.set(file.originalPath, {
      file,
      dependents: new Set(),
      inscribed: false,
    });
  }

  // Build dependent relationships
  for (const file of files) {
    for (const dep of file.dependencies) {
      const depNode = graph.get(dep);
      if (depNode) {
        depNode.dependents.add(file.originalPath);
      }
    }
  }

  return graph;
}

/**
 * Gets files in dependency order (leaves first)
 */
export function getTopologicalOrder(graph: Map<string, DependencyNode>): string[] {
  const order: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(path: string) {
    if (visited.has(path)) return;
    if (visiting.has(path)) {
      // Circular dependency - skip
      return;
    }

    visiting.add(path);
    const node = graph.get(path);

    if (node) {
      // Visit dependencies first
      for (const dep of node.file.dependencies) {
        if (graph.has(dep)) {
          visit(dep);
        }
      }
    }

    visiting.delete(path);
    visited.add(path);
    order.push(path);
  }

  // Visit all nodes
  for (const path of graph.keys()) {
    visit(path);
  }

  return order;
}

/**
 * Analyzes a build directory and returns file references with dependency graph
 */
export async function analyzeBuildDirectory(buildDir: string): Promise<{
  files: FileReference[];
  graph: Map<string, DependencyNode>;
  order: string[];
}> {
  const allFiles = await scanDirectory(buildDir);
  const fileReferences: FileReference[] = [];

  for (const file of allFiles) {
    try {
      const ref = await analyzeFile(file, buildDir);
      fileReferences.push(ref);
    } catch (error) {
      console.warn(`Warning: Could not analyze ${file}:`, formatError(error));
    }
  }

  const graph = buildDependencyGraph(fileReferences);
  const order = getTopologicalOrder(graph);

  return { files: fileReferences, graph, order };
}
