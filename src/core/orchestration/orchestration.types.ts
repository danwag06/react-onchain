/**
 * Orchestration Domain Types
 */

import type { InscribedFile } from '../inscription/index.js';
import type { InscriptionResult } from '../inscription/index.js';
import type { ChunkManifest } from '../chunking/index.js';

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
  /** Newly inscribed files (full details) */
  files: InscribedFile[];
  /** Cached/reused files from previous deployments (format: "path::*::txid_vout") */
  cachedFiles: string[];
  totalFiles: number;
  totalCost: number;
  totalSize: number;
  /** All transactions in chronological order (versioning, UTXO split, inscriptions, metadata update) */
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
  cachedCount: number;
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
 * Files grouped by dependency wave
 */
export interface DependencyWaves {
  /** Array of waves, each wave contains files that can be processed in parallel */
  waves: string[][]; // Array of file paths for each wave
  /** Map of file path to its wave number */
  fileToWave: Map<string, number>;
}

/**
 * Context for preparing jobs
 */
export interface WaveJobContext {
  buildDir: string;
  destinationAddress: string;
  versioningOriginInscription?: string;
  chunkThreshold: number;
  chunkSize: number;
  disableChunking: boolean;
  serviceWorkerUrl?: string; // Set if service worker has been inscribed
}

/**
 * Processed results from a wave inscription
 */
export interface ProcessedWaveResults {
  /** Regular (non-chunked) file inscriptions */
  regularFiles: InscribedFile[];
  /** Chunked files with their sorted chunk results */
  chunkedFiles: Map<
    string,
    {
      chunks: InscriptionResult[];
      manifest: ChunkManifest;
      originalContentType: string;
      totalSize: number;
    }
  >;
}

/**
 * Information about a chunked file
 */
export interface ChunkedFileInfo {
  filename: string;
  chunkCount: number;
  isServiceWorker: boolean;
  urlPath: string;
}

/**
 * Callbacks for orchestrator progress updates
 */
export interface OrchestratorCallbacks {
  onAnalysisStart?: () => void;
  onAnalysisComplete?: (fileCount: number) => void;
  onCacheAnalysis?: (
    cachedCount: number,
    newCount: number,
    cachedFiles: string[],
    chunkedFilesInfo: ChunkedFileInfo[]
  ) => void;
  onInscriptionStart?: (file: string, current: number, total: number) => void;
  onInscriptionComplete?: (file: string, url: string) => void;
  onInscriptionSkipped?: (file: string, url: string, chunkCount?: number) => void;
  onDeploymentComplete?: (entryPointUrl: string) => void;
  onProgress?: (message: string) => void; // Dynamic progress updates
}
