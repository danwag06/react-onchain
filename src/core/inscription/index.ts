/**
 * Inscription Module
 * Blockchain inscription operations
 */

export { parallelInscribe } from './parallelInscriber.js';
export type { InscriptionJob, InscriptionResult, InscriptionType } from './parallelInscriber.js';
export { splitUtxoForParallelInscription } from './utxoSplitter.js';
export type { InscribedFile } from './inscription.types.js';

// Inscription utilities
export {
  extractOutpointFromFile,
  calculateDependencyHash,
  suggestNextVersion,
  isIndexHtmlFile,
} from './utils.js';
