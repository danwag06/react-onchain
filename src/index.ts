/**
 * react-onchain
 * Deploy React applications to BSV blockchain using 1Sat Ordinals
 */

export {
  analyzeBuildDirectory,
  buildDependencyGraph,
  getTopologicalOrder,
} from './core/analysis/index.js';
export {
  createUrlMap,
  rewriteFile,
  rewriteHtml,
  rewriteCss,
  rewriteJs,
} from './core/rewriting/index.js';
export { parallelInscribe } from './core/inscription/index.js';
export type {
  InscriptionJob,
  InscriptionResult,
  InscriptionType,
  InscribedFile,
} from './core/inscription/index.js';
export {
  calculateDependencyWaves,
  prepareWaveJobs,
  processWaveResults,
  deployToChain,
  generateManifest,
  saveManifest,
} from './core/orchestration/index.js';
export type {
  DependencyWaves,
  WaveJobContext,
  ProcessedWaveResults,
  OrchestratorCallbacks,
  ChunkedFileInfo,
  DeploymentConfig,
  DeploymentResult,
  DeploymentManifest,
} from './core/orchestration/index.js';
export type { FileReference, DependencyNode } from './core/analysis/index.js';
