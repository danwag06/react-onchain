import dotenv from "dotenv";

// Load environment variables from .env file (if it exists)
dotenv.config();

export const ORD_FS_SERVICE_PROVIDER_URL = "https://ordfs.network";
export const ORDINALS_GORILLA_POOL_URL = "https://ordinals.gorillapool.io";

/**
 * Known BSV ordinal content delivery services
 * These services provide access to inscribed content via outpoints
 */
export const KNOWN_ORDINAL_CONTENT_SERVICES = [
  `${ORD_FS_SERVICE_PROVIDER_URL}/content`,
  `${ORDINALS_GORILLA_POOL_URL}/content`,
  // Add more known services as they become available
] as const;

/**
 * Known ordinal indexer APIs for version queries
 * These services provide APIs to query smart contract state
 */
export const KNOWN_ORDINAL_INDEXERS = [
  `${ORDINALS_GORILLA_POOL_URL}/api`,
  // Add more known services as they become available
] as const;

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG = {
  // Ordinals service configuration
  ordinalContentUrl: `${ORD_FS_SERVICE_PROVIDER_URL}/content`,
  ordinalIndexerUrl: `${ORDINALS_GORILLA_POOL_URL}/api`,
  enableServiceResolver: true,

  // Transaction settings
  satsPerKb: 1,

  // Build settings
  buildDir: "./dist",
  manifestFile: "deployment-manifest.json",
  dryRun: false,
} as const;

/**
 * Get configuration value from environment variable or default
 */
function getEnvOrDefault<T>(envKey: string, defaultValue: T): T {
  const envValue = process.env[envKey];

  if (envValue === undefined || envValue === "") {
    return defaultValue;
  }

  // Handle boolean values
  if (typeof defaultValue === "boolean") {
    return (envValue.toLowerCase() === "true") as unknown as T;
  }

  // Handle numeric values
  if (typeof defaultValue === "number") {
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
  paymentKey: process.env.PAYMENT_KEY,
  destinationAddress: process.env.DESTINATION_ADDRESS,
  changeAddress: process.env.CHANGE_ADDRESS,

  // Ordinals service configuration
  ordinalContentUrl: getEnvOrDefault(
    "ORDINAL_CONTENT_URL",
    DEFAULT_CONFIG.ordinalContentUrl
  ),
  ordinalIndexerUrl: getEnvOrDefault(
    "ORDINAL_INDEXER_URL",
    DEFAULT_CONFIG.ordinalIndexerUrl
  ),
  enableServiceResolver: getEnvOrDefault(
    "ENABLE_SERVICE_RESOLVER",
    DEFAULT_CONFIG.enableServiceResolver
  ),

  // Transaction settings
  satsPerKb: getEnvOrDefault("SATS_PER_KB", DEFAULT_CONFIG.satsPerKb),

  // Versioning options
  appName: process.env.APP_NAME,
  versionTag: process.env.VERSION_TAG,
  versionDescription: process.env.VERSION_DESCRIPTION,
  versioningContract: process.env.VERSIONING_CONTRACT,

  // Advanced options
  buildDir: getEnvOrDefault("BUILD_DIR", DEFAULT_CONFIG.buildDir),
  manifestFile: getEnvOrDefault("MANIFEST_FILE", DEFAULT_CONFIG.manifestFile),
  dryRun: getEnvOrDefault("DRY_RUN", DEFAULT_CONFIG.dryRun),
} as const;

/**
 * Get all known ordinal content services as an array
 * Includes the configured primary service plus all known fallbacks
 */
export function getAllOrdinalContentServices(
  primaryService?: string
): string[] {
  const services = new Set<string>();

  // Add primary service first (if provided and not default)
  if (
    primaryService &&
    !KNOWN_ORDINAL_CONTENT_SERVICES.includes(primaryService as any)
  ) {
    services.add(primaryService);
  }

  // Add configured service
  services.add(config.ordinalContentUrl);

  // Add all known services
  KNOWN_ORDINAL_CONTENT_SERVICES.forEach((service) => services.add(service));

  return Array.from(services);
}

/**
 * Get all known ordinal indexer APIs as an array
 * Includes the configured primary service plus all known fallbacks
 */
export function getAllOrdinalIndexers(primaryService?: string): string[] {
  const services = new Set<string>();

  // Add primary service first (if provided and not default)
  if (
    primaryService &&
    !KNOWN_ORDINAL_INDEXERS.includes(primaryService as any)
  ) {
    services.add(primaryService);
  }

  // Add configured service
  services.add(config.ordinalIndexerUrl);

  // Add all known services
  KNOWN_ORDINAL_INDEXERS.forEach((service) => services.add(service));

  return Array.from(services);
}
