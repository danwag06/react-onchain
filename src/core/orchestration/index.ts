/**
 * Orchestration Module
 * Wave-based parallel deployment orchestration
 */

export {
  deployToChain,
  generateManifest,
  saveManifest,
  saveManifestWithHistory,
} from './orchestrator.js';
export { calculateDependencyWaves, prepareWaveJobs, processWaveResults } from './jobBuilder.js';
export { processWaves } from './waveProcessor.js';

export type {
  DeploymentConfig,
  DeploymentResult,
  DeploymentManifest,
  DeploymentManifestHistory,
  DependencyWaves,
  WaveJobContext,
  ProcessedWaveResults,
  ChunkedFileInfo,
  OrchestratorCallbacks,
} from './orchestration.types.js';

export type { WaveProcessingResult } from './waveProcessor.js';
