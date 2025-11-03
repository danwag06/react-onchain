/**
 * Shared utilities for asset path detection and resolution
 */

import { dirname, relative, resolve, join } from 'path';

/**
 * File extensions that are considered assets
 */
export const ASSET_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp',
  'ico',
  'woff',
  'woff2',
  'ttf',
  'eot',
  'otf',
  'json',
  'css',
  'js',
  'mjs',
  'wasm',
  'webm',
  'mp4',
  'm4v',
  'mov',
  'avi',
  'mkv',
  'flv',
  'wmv',
  'ogg',
  'ogv',
  'mp3',
  'm4a',
  'aac',
  'oga',
  'flac',
  'wav',
] as const;

/**
 * Creates a regex pattern for matching asset paths in string literals
 * Matches:
 * 1. Explicit paths: "/path", "./path", "../path"
 * 2. Webpack-style paths: "static/path", "assets/path", etc.
 *
 * @param extensions - Array of file extensions to match (without dots)
 * @param flags - Regex flags (default: 'gi')
 * @returns RegExp for matching quoted asset paths
 */
export function createAssetPathPattern(
  extensions: readonly string[] = ASSET_EXTENSIONS,
  flags = 'gi'
): RegExp {
  const extPattern = extensions.join('|');
  return new RegExp(`["']((?:\\.{0,2}\\/|\\w+\\/)[^"']*\\.(${extPattern}))["']`, flags);
}

/**
 * Resolves an asset path reference to its location in the build directory
 * Handles three types of paths:
 * 1. Absolute paths from build root: "/static/logo.svg" -> "static/logo.svg"
 * 2. Explicit relative paths: "./logo.svg", "../logo.svg"
 * 3. Webpack-style paths (no leading slash/dots): "static/logo.svg" -> "static/logo.svg"
 *
 * @param ref - The referenced path from the source file
 * @param sourceFile - The file containing the reference (relative to baseDir)
 * @param baseDir - The build directory root
 * @returns Path relative to baseDir
 */
export function resolveAssetPath(ref: string, sourceFile: string, baseDir: string): string {
  const sourceDir = dirname(join(baseDir, sourceFile));

  if (ref.startsWith('/')) {
    // Absolute path from build root
    return ref.substring(1);
  } else if (ref.startsWith('./') || ref.startsWith('../')) {
    // Explicit relative path
    const resolved = resolve(sourceDir, ref);
    return relative(baseDir, resolved);
  } else {
    // Webpack-style path (no leading slash/dots)
    // Treat as relative to build root
    return ref;
  }
}

/**
 * Checks if a URL should be skipped during analysis/rewriting
 * Skips:
 * - External URLs (http://, https://, //)
 * - Data URIs (data:)
 * - Blob URLs (blob:)
 * - Special webpack placeholders (__webpack_*, __NEXT_*)
 */
export function shouldSkipUrl(url: string): boolean {
  if (!url) return true;

  return (
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('//') ||
    url.startsWith('data:') ||
    url.startsWith('blob:') ||
    url.includes('__webpack_') ||
    url.includes('__NEXT_')
  );
}
