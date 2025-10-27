/**
 * react-onchain
 * Deploy React applications to BSV blockchain using 1Sat Ordinals
 */

export { analyzeBuildDirectory, buildDependencyGraph, getTopologicalOrder } from './analyzer.js';
export { createUrlMap, rewriteFile, rewriteHtml, rewriteCss, rewriteJs } from './rewriter.js';
export { inscribeFile, inscribeFiles, estimateInscriptionCost } from './inscriber.js';
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
