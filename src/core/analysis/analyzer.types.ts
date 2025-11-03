/**
 * Analysis Types
 * Types for build directory analysis and dependency management
 */

/**
 * File reference found in build output
 */
export interface FileReference {
  /** Original path in build output */
  originalPath: string;
  /** Absolute path on filesystem */
  absolutePath: string;
  /** Content type for inscription */
  contentType: string;
  /** Files that this file references */
  dependencies: string[];
  /** SHA256 hash of original file content (before rewriting) */
  contentHash: string;
  /** File size in bytes */
  fileSize: number;
}

/**
 * Dependency graph node
 */
export interface DependencyNode {
  file: FileReference;
  /** Files that depend on this file */
  dependents: Set<string>;
  /** Whether this file has been inscribed */
  inscribed: boolean;
}

/**
 * Content type mapping
 */
export const CONTENT_TYPES: Record<string, string> = {
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
