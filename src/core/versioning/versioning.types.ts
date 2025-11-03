/**
 * Versioning Domain Types
 */

import type { Utxo } from 'js-1sat-ord';

/**
 * Versioning inscription information
 */
export interface VersioningInscriptionInfo {
  outpoint: string;
  originOutpoint: string;
  appName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: Record<string, any>;
  utxo?: Utxo | null;
}

/**
 * Structure of individual version entry (before stringification)
 */
export interface VersionEntry {
  outpoint: string;
  description: string;
  utcTimeStamp: number;
}

/**
 * Version metadata structure in inscription
 * Version keys must be prefixed with "version." and values are stringified VersionEntry objects
 * Use createVersionEntry() helper to ensure type safety when adding version entries
 */
export interface VersionMetadata {
  app: string;
  type: string;
  [key: string]: string; // Allows js-1sat-ord compatibility and dynamic indexing
}
