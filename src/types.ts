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

  // Service configuration
  /** Ordinal content delivery URL */
  ordinalContentUrl?: string;
  /** Ordinal indexer API URL for version queries */
  ordinalIndexerUrl?: string;
  /** Enable service resolver script injection */
  enableServiceResolver?: boolean;

  // Versioning options
  /** Enable versioning for this deployment */
  enableVersioning?: boolean;
  /** Version string (e.g., "1.0.0") */
  version?: string;
  /** Version description/changelog */
  versionDescription?: string;
  /** Existing versioning contract outpoint (txid_vout) */
  versioningContract?: string;
  /** App name for new versioning contract */
  appName?: string;
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
  /** Versioning contract outpoint (if versioning enabled) */
  versioningContract?: string;
  /** Version deployed (if versioning enabled) */
  version?: string;
  /** Version description/changelog (if versioning enabled) */
  versionDescription?: string;
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
  /** Versioning contract outpoint (if versioning enabled) */
  versioningContract?: string;
  /** Version deployed (if versioning enabled) */
  version?: string;
  /** Version description/changelog (if versioning enabled) */
  versionDescription?: string;
}

/**
 * Enhanced manifest with full deployment history
 */
export interface DeploymentManifestHistory {
  /** Manifest schema version for future compatibility */
  manifestVersion: string;
  /** Optional project name/identifier */
  projectName?: string;
  /** Shared versioning contract outpoint (if versioning enabled) */
  versioningContract?: string;
  /** Total number of deployments */
  totalDeployments: number;
  /** Array of all deployments (chronological order) */
  deployments: DeploymentManifest[];
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
