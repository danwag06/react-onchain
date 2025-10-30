import dotenv from 'dotenv';
import { GorillaPoolIndexer } from './services/gorilla-pool/indexer.js';
import { GorillaPoolBrowserConfig } from './services/gorilla-pool/browserConfig.js';
import type { IndexerService, BrowserIndexerConfig } from './services/IndexerService.js';

// Load environment variables from .env file (if it exists)
dotenv.config();

/**
 * Browser-compatible indexer configurations
 * Contributors can add new indexers by creating a new IndexerService class
 * with a corresponding BrowserIndexerConfig export, then adding it here.
 */
export const BROWSER_INDEXER_CONFIGS: ReadonlyArray<BrowserIndexerConfig> = [
  GorillaPoolBrowserConfig,
  // Add more browser configs as new indexers are contributed
  // Example: WhatsOnChainBrowserConfig, BlockchairBrowserConfig, etc.
] as const;

/**
 * Default configuration values
 * Uses the first (primary) browser indexer config as the default
 */
export const DEFAULT_CONFIG = {
  // Ordinals service configuration (from primary indexer)
  ordinalContentUrl: BROWSER_INDEXER_CONFIGS[0].contentUrl,
  ordinalIndexerUrl: BROWSER_INDEXER_CONFIGS[0].baseUrl,

  // Transaction settings
  satsPerKb: 1,

  // Build settings
  buildDir: './dist',
  manifestFile: 'deployment-manifest.json',
  dryRun: false,
} as const;

/**
 * Get configuration value from environment variable or default
 */
function getEnvOrDefault<T>(envKey: string, defaultValue: T): T {
  const envValue = process.env[envKey];

  if (envValue === undefined || envValue === '') {
    return defaultValue;
  }

  // Handle boolean values
  if (typeof defaultValue === 'boolean') {
    return (envValue.toLowerCase() === 'true') as unknown as T;
  }

  // Handle numeric values
  if (typeof defaultValue === 'number') {
    const parsed = Number(envValue);
    return (isNaN(parsed) ? defaultValue : parsed) as unknown as T;
  }

  // Handle string values
  return envValue as unknown as T;
}

/**
 * Application configuration loaded from environment variables
 */
export const config = {
  // Deployment credentials
  paymentKey: process.env.REACT_ONCHAIN_PAYMENT_KEY || process.env.REACT_ONCHAIN_PAYMENT_WIF,
  destinationAddress: process.env.DESTINATION_ADDRESS,
  changeAddress: process.env.CHANGE_ADDRESS,

  // Ordinals service configuration
  ordinalContentUrl: getEnvOrDefault('ORDINAL_CONTENT_URL', DEFAULT_CONFIG.ordinalContentUrl),
  ordinalIndexerUrl: getEnvOrDefault('ORDINAL_INDEXER_URL', DEFAULT_CONFIG.ordinalIndexerUrl),

  // Transaction settings
  satsPerKb: getEnvOrDefault('SATS_PER_KB', DEFAULT_CONFIG.satsPerKb),

  // Versioning options
  appName: process.env.APP_NAME,
  versionTag: process.env.VERSION_TAG,
  versionDescription: process.env.VERSION_DESCRIPTION,
  versioningContract: process.env.VERSIONING_CONTRACT,

  // Advanced options
  buildDir: getEnvOrDefault('BUILD_DIR', DEFAULT_CONFIG.buildDir),
  manifestFile: getEnvOrDefault('MANIFEST_FILE', DEFAULT_CONFIG.manifestFile),
  dryRun: getEnvOrDefault('DRY_RUN', DEFAULT_CONFIG.dryRun),
} as const;

/**
 * Get all known ordinal content services as an array
 * Extracts content URLs from all available indexer configurations
 */
export function getAllOrdinalContentServices(primaryService?: string): string[] {
  const services = new Set<string>();

  // Add configured service first
  services.add(config.ordinalContentUrl);

  // Extract content URLs from all indexer configs
  BROWSER_INDEXER_CONFIGS.forEach((config) => services.add(config.contentUrl));

  // Add custom primary service if provided
  if (primaryService && !services.has(primaryService)) {
    services.add(primaryService);
  }

  return Array.from(services);
}

/**
 * Get all available indexer configurations for browser use
 * Returns browser-compatible indexer configs that include endpoint construction logic
 *
 * @returns Array of BrowserIndexerConfig objects
 */
export function getAllIndexerConfigs(): BrowserIndexerConfig[] {
  return [...BROWSER_INDEXER_CONFIGS];
}

/**
 * Create an IndexerService instance
 *
 * @param url - Optional custom indexer URL (defaults to GorillaPool)
 * @returns IndexerService instance
 */
export function createIndexer(url?: string): IndexerService {
  const indexerUrl = url || config.ordinalIndexerUrl;

  // For now, we only have GorillaPoolIndexer
  // In the future, we could detect the service type from URL or add more implementations
  return new GorillaPoolIndexer(indexerUrl);
}
