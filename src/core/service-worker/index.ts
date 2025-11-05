/**
 * Service Worker Module
 * Service worker generation and runtime utilities
 */

export {
  generateChunkReassemblyServiceWorker,
  generateServiceWorkerRegistration,
} from './generator.js';

export { handleServiceWorkerInscription } from './inscriber.js';

export type { ServiceWorkerInscriptionResult } from './inscriber.js';

// Note: ChunkFetcher, RangeCalculator, and StreamAssembler are runtime modules
// whose code is inlined into the generated Service Worker. They are not exported
// from this barrel but exist as standalone modules for the generator to use.
