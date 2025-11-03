/**
 * react-onchain
 * Deploy React applications to BSV blockchain using 1Sat Ordinals
 */

export { analyzeBuildDirectory, buildDependencyGraph, getTopologicalOrder } from './analyzer.js';
export { createUrlMap, rewriteFile, rewriteHtml, rewriteCss, rewriteJs } from './rewriter.js';
export { parallelInscribe } from './parallelInscriber.js';
export type { InscriptionJob, InscriptionResult, InscriptionType } from './parallelInscriber.js';
export {
  calculateDependencyWaves,
  prepareWaveJobs,
  processWaveResults,
} from './orchestratorJobBuilder.js';
export type {
  DependencyWaves,
  WaveJobContext,
  ProcessedWaveResults,
} from './orchestratorJobBuilder.js';
export { deployToChain, generateManifest, saveManifest } from './orchestrator.js';
export type { OrchestratorCallbacks } from './orchestrator.js';
export type {
  FileReference,
  InscribedFile,
  DependencyNode,
  DeploymentConfig,
  DeploymentResult,
  DeploymentManifest,
} from './types.js';
