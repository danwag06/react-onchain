import { readdir, readFile } from 'fs/promises';
import { join, extname, relative, dirname, resolve } from 'path';
import { createHash } from 'crypto';
import type { FileReference, DependencyNode, CONTENT_TYPES } from './types.js';
import { formatError } from './utils/errors.js';
import { shouldSkipUrl } from './utils/url.js';

const CONTENT_TYPE_MAP: typeof CONTENT_TYPES = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
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
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
};

/**
 * Recursively scans a directory for all files
 */
async function scanDirectory(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
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

  // Also look for string literals that might be asset paths
  // Match patterns like "/assets/logo.png" or "./image.jpg"
  const assetPattern =
    /["'](\.{0,2}\/[^"']*\.(png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot|otf|json))["']/gi;
  let match;

  while ((match = assetPattern.exec(content)) !== null) {
    const ref = match[1];
    const resolvedPath = ref.startsWith('/')
      ? join(baseDir, ref.substring(1))
      : resolve(fileDir, ref);
    references.push(resolvedPath);
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

  return {
    originalPath: relativePath,
    absolutePath: filePath,
    contentType: CONTENT_TYPE_MAP[ext] || 'application/octet-stream',
    dependencies,
    contentHash,
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
