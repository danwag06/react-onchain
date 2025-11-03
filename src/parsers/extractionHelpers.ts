/**
 * Shared extraction helpers for parser functions
 * Reduces code duplication across HTML, CSS, JS, JSON, and SVG parsers
 */

import { dirname, join, resolve } from 'path';

/**
 * Options for pattern-based extraction
 */
export interface ExtractionOptions {
  /** The file content to search */
  content: string;
  /** Base directory for resolving absolute paths */
  baseDir: string;
  /** Path to the file being parsed (for resolving relative paths) */
  filePath: string;
  /** Regex patterns to match (can be array of RegExp) */
  patterns: RegExp | RegExp[];
  /** Optional filter function to skip certain URLs (defaults to allowing all) */
  shouldSkip?: (url: string) => boolean;
  /** Optional custom path resolver (defaults to standard resolution logic) */
  resolvePath?: (ref: string, fileDir: string, baseDir: string) => string;
}

/**
 * Default path resolution logic used across all parsers
 * Handles both absolute paths (starting with /) and relative paths
 */
export function defaultPathResolver(ref: string, fileDir: string, baseDir: string): string {
  return ref.startsWith('/') ? join(baseDir, ref.substring(1)) : resolve(fileDir, ref);
}

/**
 * Extracts file references from content using regex patterns
 * This is the core extraction logic shared by all parser functions
 *
 * @param options - Extraction configuration options
 * @returns Array of resolved file paths
 */
export function extractReferencesFromPatterns(options: ExtractionOptions): string[] {
  const {
    content,
    baseDir,
    filePath,
    patterns,
    shouldSkip = () => false,
    resolvePath = defaultPathResolver,
  } = options;

  const references: string[] = [];
  const fileDir = dirname(filePath);
  const patternsArray = Array.isArray(patterns) ? patterns : [patterns];

  for (const pattern of patternsArray) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const ref = match[1];
      if (!shouldSkip(ref)) {
        const resolvedPath = resolvePath(ref, fileDir, baseDir);
        references.push(resolvedPath);
      }
    }
  }

  return references;
}

/**
 * Common URL skip predicates
 */
export const UrlSkipPredicates = {
  /**
   * Skips external URLs and data URIs
   * Used by HTML parser and others
   */
  skipExternalAndData: (url: string): boolean => {
    return url.startsWith('http') || url.startsWith('//') || url.startsWith('data:');
  },

  /**
   * Skips only external HTTP(S) URLs and protocol-relative URLs
   * Used by CSS parser
   */
  skipExternal: (url: string): boolean => {
    return url.startsWith('http') || url.startsWith('//') || url.startsWith('data:');
  },

  /**
   * Allows only relative paths (starting with ./ ../ or /)
   * Used by JavaScript parser for import statements
   */
  allowOnlyRelative: (url: string): boolean => {
    return !(url.startsWith('./') || url.startsWith('../') || url.startsWith('/'));
  },
};
