import type { PrivateKey } from '@bsv/sdk';

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
}

/**
 * Inscribed file with its on-chain reference
 */
export interface InscribedFile {
  /** Original file path */
  originalPath: string;
  /** Transaction ID */
  txid: string;
  /** Output index */
  vout: number;
  /** Full ordfs.network URL */
  url: string;
  /** File size in bytes */
  size: number;
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
 * Deployment configuration
 */
export interface DeploymentConfig {
  /** Build directory to deploy */
  buildDir: string;
  /** Payment private key (WIF format) */
  paymentKey: string;
  /** Destination address for inscriptions */
  destinationAddress: string;
  /** Optional change address */
  changeAddress?: string;
  /** Satoshis per KB for fees */
  satsPerKb?: number;
  /** Dry run mode - simulate without broadcasting */
  dryRun?: boolean;
}

/**
 * Deployment result
 */
export interface DeploymentResult {
  /** Entry point URL (index.html) */
  entryPointUrl: string;
  /** All inscribed files */
  inscriptions: InscribedFile[];
  /** Total cost in satoshis */
  totalCost: number;
  /** Transaction IDs */
  txids: string[];
  /** Total size in bytes */
  totalSize: number;
}

/**
 * Manifest file structure
 */
export interface DeploymentManifest {
  timestamp: string;
  entryPoint: string;
  files: InscribedFile[];
  totalFiles: number;
  totalCost: number;
  totalSize: number;
  transactions: string[];
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
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
};
