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

export { handleVersioningOriginInscription, handleVersioningMetadataUpdate } from './inscriber.js';

export type {
  VersioningInscriptionInfo,
  VersionEntry,
  VersionMetadata,
} from './versioning.types.js';

export type { VersioningOriginResult } from './inscriber.js';
