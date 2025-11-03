/**
 * Versioning Module
 * Handles ordinal-based versioning inscriptions
 */

export {
  VERSIONING_ENABLED,
  createVersionEntry,
  parseVersionEntry,
  deployVersioningInscription,
  updateVersioningInscription,
  checkVersionExists,
  getVersionDetails,
  getInscriptionInfo,
  getVersionInfoAndHistory,
} from './versioningHandler.js';

export type {
  VersioningInscriptionInfo,
  VersionEntry,
  VersionMetadata,
} from './versioning.types.js';
