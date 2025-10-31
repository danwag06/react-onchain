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
  /** SHA256 hash of original file content (before rewriting) */
  contentHash: string;
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
  /** URL path for the inscription (e.g., "/content/txid_vout") */
  urlPath: string;
  /** File size in bytes */
  size: number;
  /** SHA256 hash of original file content (before rewriting) - optional for backward compatibility */
  contentHash?: string;
  /** Hash of dependency URLs (for cache invalidation when dependencies change) */
  dependencyHash?: string;
  /** Whether this file was reused from cache (not newly inscribed) */
  cached?: boolean;
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
  /** Payment private key (WIF format) - destination address is automatically derived from this key */
  paymentKey: string;
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

  // Versioning options (always enabled)
  /** Version string (e.g., "1.0.0") - required */
  version: string;
  /** Version description/changelog - required */
  versionDescription: string;
  /** Existing versioning inscription origin outpoint (txid_vout) - only exists after first deployment */
  versioningOriginInscription?: string;
  /** App name for versioning inscription - required */
  appName: string;
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
  /** Versioning inscription origin outpoint */
  versioningOriginInscription: string;
  /** Latest versioning inscription outpoint after this deployment */
  versioningLatestInscription?: string;
  /** Version deployed */
  version: string;
  /** Version description/changelog */
  versionDescription: string;
  /** Build directory used */
  buildDir?: string;
  /** Destination address used (derived from payment key) */
  destinationAddress?: string;
  /** Content service URL used */
  ordinalContentUrl?: string;
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
  /** Latest versioning inscription outpoint after this deployment */
  latestVersioningInscription?: string;
  /** Version deployed */
  version: string;
  /** Version description/changelog */
  versionDescription: string;
  /** Build directory used for this deployment */
  buildDir?: string;
  /** Destination address used for inscriptions */
  destinationAddress?: string;
  /** Content service URL used for this deployment */
  ordinalContentUrl?: string;
  /** Number of newly inscribed files */
  newFiles: number;
  /** Number of cached/reused files */
  cachedFiles: number;
  /** Number of new transactions created */
  newTransactions: number;
}

/**
 * Enhanced manifest with full deployment history
 */
export interface DeploymentManifestHistory {
  /** Manifest schema version for future compatibility */
  manifestVersion: string;
  /** Optional project name/identifier */
  projectName?: string;
  /** Origin outpoint of the versioning inscription chain (never changes, if versioning enabled) */
  originVersioningInscription?: string;
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
