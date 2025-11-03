#!/usr/bin/env node

import { Command } from 'commander';
import { existsSync } from 'fs';
import { resolve } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { input, password, confirm, select } from '@inquirer/prompts';
import { deployToChain, generateManifest, saveManifestWithHistory } from './orchestrator.js';
import { getVersionDetails, getVersionInfoAndHistory } from './versioningInscriptionHandler.js';
import { config as envConfig } from './config.js';
import type { DeploymentConfig, InscribedFile, DeploymentManifestHistory } from './types.js';
import { readFile, writeFile } from 'fs/promises';
import { formatError } from './utils/errors.js';
import { MANIFEST_FILENAME } from './utils/constants.js';
import { getManifestLatestVersion } from './utils/helpers.js';

const program = new Command();

// ============================================================================
// Constants
// ============================================================================

const CLI_CONSTANTS = {
  DEFAULT_VERSION: '1.0.0',
  ENV_FILE: '.env',
  GITIGNORE_FILE: '.gitignore',
  COMMON_BUILD_DIRS: ['dist', 'build', 'out', '.next/standalone', 'public'],

  // Display formatting
  FILENAME_MAX_LENGTH: 35,
  FILENAME_TRUNCATE_SUFFIX: 32,
  DIVIDER_LENGTH: 70,
  PROGRESS_BAR_WIDTH: 20,

  // Pagination
  DEFAULT_VERSION_LIMIT: 10,
  VERSION_DESC_MAX_LENGTH: 37,
  VERSION_DESC_TRUNCATE_LENGTH: 34,
} as const;

// ============================================================================
// Type Definitions
// ============================================================================

interface ManifestData {
  versioningOriginInscription?: string;
  buildDir?: string;
  ordinalContentUrl?: string;
  deployments?: Array<{ version: string }>;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Parse size input - accepts plain numbers (interpreted as MB) or byte counts
 * Examples: "3" = 3MB, "5242880" = 5MB in bytes
 */
function parseSizeInput(input: string): number {
  const num = parseFloat(input);
  if (isNaN(num)) {
    throw new Error(`Invalid size: ${input}`);
  }
  // If the number is small (< 100), treat as MB
  // Otherwise treat as bytes
  if (num < 100) {
    return Math.floor(num * 1024 * 1024);
  }
  return Math.floor(num);
}

/**
 * Helper to read and parse manifest data
 * Returns empty object if manifest doesn't exist or can't be read
 */
async function readManifestData(manifestPath: string = MANIFEST_FILENAME): Promise<ManifestData> {
  const resolvedPath = resolve(manifestPath);

  if (!existsSync(resolvedPath)) {
    return {};
  }

  try {
    const manifestJson = await readFile(resolvedPath, 'utf-8');
    const parsed = JSON.parse(manifestJson) as DeploymentManifestHistory;

    // Get last deployment info
    const lastDeployment =
      parsed.deployments && parsed.deployments.length > 0
        ? parsed.deployments[parsed.deployments.length - 1]
        : undefined;

    return {
      versioningOriginInscription: parsed.originVersioningInscription,
      buildDir: lastDeployment?.buildDir,
      ordinalContentUrl: lastDeployment?.ordinalContentUrl,
      deployments: parsed.deployments,
    };
  } catch (error) {
    console.warn(chalk.yellow('⚠️  Warning: Failed to read manifest:'), formatError(error));
    return {};
  }
}

/**
 * Increment the patch version (e.g., "1.0.0" → "1.0.1")
 */
function incrementPatchVersion(version: string): string {
  const parts = version.split('.');
  if (parts.length === 3) {
    const lastPart = parseInt(parts[2] || '0');
    parts[2] = String(lastPart + 1);
    return parts.join('.');
  }
  return version;
}

/**
 * Load content service URL from manifest (if exists) or fallback to config
 * Prioritizes manifest value since it represents what was used during deployment
 */
async function loadContentUrl(manifestPath: string = MANIFEST_FILENAME): Promise<string> {
  const manifestData = await readManifestData(manifestPath);

  if (manifestData.ordinalContentUrl) {
    return manifestData.ordinalContentUrl;
  }

  // Fallback to environment config
  return envConfig.ordinalContentUrl;
}

/**
 * Display file size summary table
 */
function displaySummary(inscriptions: InscribedFile[], totalSize: number): void {
  // Categorize files
  const newFiles = inscriptions.filter((f) => !f.cached);
  const cachedFiles = inscriptions.filter((f) => f.cached);

  // Further categorize new files
  const regularFiles = newFiles.filter(
    (f) => !f.isChunked && f.originalPath !== 'chunk-reassembly-sw.js'
  );
  const chunkedFiles = newFiles.filter((f) => f.isChunked);
  const serviceWorker = newFiles.find((f) => f.originalPath === 'chunk-reassembly-sw.js');

  const { FILENAME_MAX_LENGTH, FILENAME_TRUNCATE_SUFFIX, DIVIDER_LENGTH } = CLI_CONSTANTS;

  // Display regular new files
  if (regularFiles.length > 0) {
    console.log(chalk.bold.white('📄 New Inscriptions'));
    console.log(chalk.gray('─'.repeat(DIVIDER_LENGTH)));

    regularFiles.forEach((file, index) => {
      const fileName =
        file.originalPath.length > FILENAME_MAX_LENGTH
          ? '...' + file.originalPath.slice(-FILENAME_TRUNCATE_SUFFIX)
          : file.originalPath;

      const number = chalk.gray(`${String(index + 1).padStart(2)}. `);
      const name = chalk.white(fileName.padEnd(FILENAME_MAX_LENGTH));
      const size = chalk.yellow(formatBytes(file.size).padEnd(10));
      const txid = chalk.gray(file.txid.slice(0, 8) + '...');

      console.log(`  ${number}${name} ${size} ${txid}`);
    });

    const regularFilesSize = regularFiles.reduce((sum, f) => sum + f.size, 0);
    console.log(chalk.gray('─'.repeat(DIVIDER_LENGTH)));
    console.log(
      chalk.gray('  SUBTOTAL'.padEnd(39)) +
        chalk.bold.green(formatBytes(regularFilesSize).padEnd(11)) +
        chalk.gray(`${regularFiles.length} file${regularFiles.length !== 1 ? 's' : ''}`)
    );
    console.log(chalk.gray('─'.repeat(DIVIDER_LENGTH)));
    console.log();
  }

  // Display chunked files
  if (chunkedFiles.length > 0) {
    console.log(chalk.bold.magenta('📦 Chunked Files'));
    console.log(chalk.gray('─'.repeat(DIVIDER_LENGTH)));

    chunkedFiles.forEach((file, index) => {
      const fileName =
        file.originalPath.length > FILENAME_MAX_LENGTH
          ? '...' + file.originalPath.slice(-FILENAME_TRUNCATE_SUFFIX)
          : file.originalPath;

      const number = chalk.gray(`${String(index + 1).padStart(2)}. `);
      const name = chalk.magenta(fileName.padEnd(FILENAME_MAX_LENGTH - 10));
      const chunkInfo = chalk.gray(`(${file.chunkCount} chunks)`);
      const size = chalk.yellow(formatBytes(file.size).padEnd(10));
      const txid = chalk.gray(file.txid.slice(0, 8) + '...');

      console.log(`  ${number}${name} ${chunkInfo} ${size} ${txid}`);
    });

    const chunkedFilesSize = chunkedFiles.reduce((sum, f) => sum + f.size, 0);
    const totalChunks = chunkedFiles.reduce((sum, f) => sum + (f.chunkCount || 0), 0);
    console.log(chalk.gray('─'.repeat(DIVIDER_LENGTH)));
    console.log(
      chalk.gray('  SUBTOTAL'.padEnd(39)) +
        chalk.bold.magenta(formatBytes(chunkedFilesSize).padEnd(11)) +
        chalk.gray(
          `${chunkedFiles.length} file${chunkedFiles.length !== 1 ? 's' : ''} (${totalChunks} chunks)`
        )
    );
    console.log(chalk.gray('─'.repeat(DIVIDER_LENGTH)));
    console.log();
  }

  // Display service worker
  if (serviceWorker) {
    console.log(chalk.bold.blue('⚙️  Service Worker'));
    console.log(chalk.gray('─'.repeat(DIVIDER_LENGTH)));

    const number = chalk.gray('  1. ');
    const name = chalk.blue(serviceWorker.originalPath.padEnd(FILENAME_MAX_LENGTH));
    const size = chalk.yellow(formatBytes(serviceWorker.size).padEnd(10));
    const txid = chalk.gray(serviceWorker.txid.slice(0, 8) + '...');

    console.log(`${number}${name} ${size} ${txid}`);

    console.log(chalk.gray('─'.repeat(DIVIDER_LENGTH)));
    console.log();
  }

  // Display cached files
  if (cachedFiles.length > 0) {
    console.log(chalk.bold.cyan('📦 Cached Files (Reused)'));
    console.log(chalk.gray('─'.repeat(DIVIDER_LENGTH)));

    cachedFiles.forEach((file, index) => {
      const fileName =
        file.originalPath.length > FILENAME_MAX_LENGTH
          ? '...' + file.originalPath.slice(-FILENAME_TRUNCATE_SUFFIX)
          : file.originalPath;

      const number = chalk.gray(`${String(index + 1).padStart(2)}. `);
      const name = chalk.cyan(fileName.padEnd(FILENAME_MAX_LENGTH));
      const size = chalk.gray(formatBytes(file.size).padEnd(10));
      const txid = chalk.gray(file.txid.slice(0, 8) + '...');

      console.log(`  ${number}${name} ${size} ${txid}`);
    });

    const cachedFilesSize = cachedFiles.reduce((sum, f) => sum + f.size, 0);
    console.log(chalk.gray('─'.repeat(DIVIDER_LENGTH)));
    console.log(
      chalk.gray('  SUBTOTAL'.padEnd(39)) +
        chalk.cyan(formatBytes(cachedFilesSize).padEnd(11)) +
        chalk.gray(`${cachedFiles.length} file${cachedFiles.length !== 1 ? 's' : ''}`)
    );
    console.log(chalk.gray('─'.repeat(DIVIDER_LENGTH)));
    console.log();
  }

  // Display total
  console.log(chalk.bold.white('📊 Total'));
  console.log(chalk.gray('─'.repeat(DIVIDER_LENGTH)));
  console.log(
    chalk.gray('  TOTAL'.padEnd(39)) +
      chalk.bold.green(formatBytes(totalSize).padEnd(11)) +
      chalk.gray(`${inscriptions.length} file${inscriptions.length !== 1 ? 's' : ''}`)
  );
  console.log(chalk.gray('─'.repeat(DIVIDER_LENGTH)));
  console.log();
}

/**
 * Detect available build directories and prompt user to select one
 */
async function promptForBuildDir(previousBuildDir?: string): Promise<string> {
  const detectedDirs: string[] = [];

  // Check each common directory
  for (const dir of CLI_CONSTANTS.COMMON_BUILD_DIRS) {
    const fullPath = resolve(dir);
    if (existsSync(fullPath) && existsSync(resolve(fullPath, 'index.html'))) {
      detectedDirs.push(dir);
    }
  }

  // If previous build dir exists and is valid, offer it first
  if (previousBuildDir && existsSync(previousBuildDir)) {
    const useExisting = await confirm({
      message: `Use build directory from previous deployment? ${chalk.cyan(previousBuildDir)}`,
      default: true,
    });

    if (useExisting) {
      return previousBuildDir;
    }
  }

  // If we found directories, let user select or enter custom
  if (detectedDirs.length > 0) {
    const choices = [
      ...detectedDirs.map((dir) => ({ name: `${dir}  ${chalk.gray('(detected)')}`, value: dir })),
      { name: 'Enter custom path', value: 'custom' },
    ];

    const selected = await select({
      message: 'Select build directory:',
      choices,
    });

    if (selected !== 'custom') {
      return selected;
    }
  }

  // Prompt for custom path
  const customPath = await input({
    message: 'Enter build directory path:',
    validate: (value: string) => {
      const fullPath = resolve(value);
      if (!existsSync(fullPath)) {
        return `Directory not found: ${fullPath}`;
      }
      if (!existsSync(resolve(fullPath, 'index.html'))) {
        return 'index.html not found in directory';
      }
      return true;
    },
  });

  return customPath;
}

/**
 * Validate version doesn't already exist in manifest
 */
async function checkVersionInManifest(
  version: string,
  manifestPath: string = MANIFEST_FILENAME
): Promise<{ exists: boolean; availableVersions: string[]; suggestion: string }> {
  const manifestData = await readManifestData(manifestPath);

  // Extract all available versions
  const availableVersions =
    manifestData.deployments?.map((d) => d.version).filter((v): v is string => !!v) || [];

  // Check if version exists
  const exists = availableVersions.includes(version);

  // Generate suggestion (increment patch version if exists)
  const suggestion = exists ? incrementPatchVersion(version) : version;

  return { exists, availableVersions, suggestion };
}

/**
 * Get the last version from manifest and increment patch version
 */
async function getLastVersionAndSuggestNext(manifestPath: string): Promise<string | undefined> {
  const manifestData = await readManifestData(manifestPath);

  if (!manifestData.deployments || manifestData.deployments.length === 0) {
    return undefined;
  }

  const lastVersion = manifestData.deployments[manifestData.deployments.length - 1].version;

  return lastVersion ? incrementPatchVersion(lastVersion) : undefined;
}

/**
 * Prompt for version tag with validation
 */
async function promptForVersion(
  isFirstDeployment: boolean,
  manifestPath: string = MANIFEST_FILENAME
): Promise<string> {
  let version: string;

  // Get suggested version
  const suggestedVersion = isFirstDeployment
    ? CLI_CONSTANTS.DEFAULT_VERSION
    : (await getLastVersionAndSuggestNext(manifestPath)) || CLI_CONSTANTS.DEFAULT_VERSION;

  while (true) {
    version = await input({
      message: 'Version tag:',
      default: suggestedVersion,
      validate: (value: string) => {
        if (!value || value.trim() === '') {
          return 'Version is required';
        }
        return true;
      },
    });

    const check = await checkVersionInManifest(version.trim(), manifestPath);

    if (check.exists) {
      console.log(chalk.red(`\n✗ Version ${version} already exists`));
      if (check.availableVersions.length > 0) {
        console.log(chalk.gray(`  Existing versions: ${check.availableVersions.join(', ')}`));
      }
      console.log(chalk.gray(`  Suggestion: ${check.suggestion}\n`));
      continue;
    }

    break;
  }

  return version.trim();
}

/**
 * Save deployment configuration to .env file
 * Allows subsequent deployments to use stored config
 */
async function saveDeploymentEnv(config: {
  paymentKey: string;
  buildDir: string;
  appName: string;
  versioningOriginInscription: string;
  ordinalContentUrl: string;
  satsPerKb: number;
}): Promise<void> {
  const { ENV_FILE, GITIGNORE_FILE } = CLI_CONSTANTS;
  const envPath = resolve(ENV_FILE);
  const gitignorePath = resolve(GITIGNORE_FILE);
  const timestamp = new Date().toISOString().split('T')[0];

  // Ensure .gitignore exists and contains .env
  if (existsSync(gitignorePath)) {
    // Read existing .gitignore
    const gitignoreContent = await readFile(gitignorePath, 'utf-8');
    const lines = gitignoreContent.split('\n');

    // Check if .env is already in .gitignore
    const hasEnv = lines.some((line) => line.trim() === ENV_FILE);

    if (!hasEnv) {
      // Add .env to .gitignore
      const updatedContent = gitignoreContent.endsWith('\n')
        ? gitignoreContent + `${ENV_FILE}\n`
        : gitignoreContent + `\n${ENV_FILE}\n`;
      await writeFile(gitignorePath, updatedContent, 'utf-8');
    }
  } else {
    // Create .gitignore with .env
    await writeFile(gitignorePath, `${ENV_FILE}\n`, 'utf-8');
  }

  const envContent = `# React OnChain Deployment Configuration
# Auto-generated by react-onchain on ${timestamp}
#
# ⚠️  SECURITY WARNING ⚠️
# This file contains your PRIVATE KEY!
# - NEVER commit this file to version control
# - NEVER share this file with anyone
#
# The .env file is in .gitignore to protect your keys.

# Payment private key (WIF format)
# Destination address is automatically derived from this key
REACT_ONCHAIN_PAYMENT_KEY=${config.paymentKey}

# Build directory
BUILD_DIR=${config.buildDir}

# Application name
APP_NAME=${config.appName}

# Versioning origin inscription (permanent reference)
VERSIONING_ORIGIN_INSCRIPTION=${config.versioningOriginInscription}

# Content delivery service
ORDINAL_CONTENT_URL=${config.ordinalContentUrl}

# Transaction fee rate (satoshis per KB)
SATS_PER_KB=${config.satsPerKb}

# ==============================================================
# For subsequent deployments, simply run:
#   npx react-onchain deploy
#
# The CLI will auto-load all config and prompt only for:
#   - New version tag (with smart increment suggestion)
#   - Version description
# ==============================================================
`;

  await writeFile(envPath, envContent, 'utf-8');
}

program
  .name('react-onchain')
  .description('Deploy React applications to BSV blockchain using 1Sat Ordinals')
  .version('1.0.0');

program
  .command('deploy')
  .description('Deploy a React build directory to the blockchain')
  .option('-b, --build-dir <directory>', 'Build directory to deploy', envConfig.buildDir)
  .option('-p, --payment-key <wif>', 'Payment private key (WIF format)', envConfig.paymentKey)
  .option('-c, --change <address>', 'Change address (optional)', envConfig.changeAddress)
  .option('-s, --sats-per-kb <number>', 'Satoshis per KB for fees', String(envConfig.satsPerKb))
  .option('-m, --manifest <file>', 'Output manifest file', envConfig.manifestFile)
  .option('--dry-run', 'Simulate deployment without broadcasting transactions', envConfig.dryRun)
  .option(
    '--ordinal-content-url <url>',
    'Ordinal content delivery URL',
    envConfig.ordinalContentUrl
  )
  .option('--ordinal-indexer-url <url>', 'Ordinal indexer API URL', envConfig.ordinalIndexerUrl)
  .option(
    '--version-tag <string>',
    'Version tag for this deployment (e.g., "1.0.0")',
    envConfig.versionTag
  )
  .option(
    '--version-description <string>',
    'Description/changelog for this version',
    envConfig.versionDescription
  )
  .option(
    '--versioning-origin-description <description>',
    'Existing versioning origin description',
    envConfig.versioningOriginDescription
  )
  .option(
    '--app-name <string>',
    'Application name for new versioning origin inscription',
    envConfig.appName
  )
  .option(
    '--chunk-batch-size <number>',
    'Number of chunks to inscribe in parallel per batch (default: 10)',
    '10'
  )
  .action(async (options) => {
    try {
      // Step 0: Capture which flags were explicitly provided via CLI (before interactive prompts)
      // Check process.argv directly since commander sets defaults from envConfig
      const cliArgs = process.argv.join(' ');
      const wasPaymentKeyProvided = cliArgs.includes('--payment-key') || cliArgs.includes('-p');
      const wasVersionTagProvided = cliArgs.includes('--version-tag');

      // Step 0.5: Build reminder prompt (only in interactive mode)
      if (!options.dryRun && !wasPaymentKeyProvided && !wasVersionTagProvided) {
        console.log();
        console.log(chalk.yellow('⚠️  Before deploying, make sure you have built your project!'));
        console.log(
          chalk.gray('   Run your build command (e.g., ') +
            chalk.cyan('npm run build') +
            chalk.gray(') before proceeding.')
        );
        console.log();

        try {
          const hasBuilt = await confirm({
            message: 'Have you built your project and are ready to deploy?',
            default: false,
          });

          if (!hasBuilt) {
            console.log(
              chalk.yellow('\n✋ Please build your project first, then run deploy again.\n')
            );
            process.exit(0);
          }

          console.log();
        } catch (error) {
          console.log(chalk.yellow('\n✋ Deployment cancelled.\n'));
          process.exit(0);
        }
      }

      // Step 1: Load previous manifest to get stored configuration
      const manifestPath = resolve(MANIFEST_FILENAME);
      const manifestData = await readManifestData(manifestPath);

      const previousConfig = {
        buildDir: manifestData.buildDir,
        versioningOriginInscription: manifestData.versioningOriginInscription,
      };

      // Step 2: Build directory - interactive prompt or auto-detect
      const buildDirExplicitlySet = cliArgs.includes('--build-dir') || cliArgs.includes('-b');
      const isSubsequentDeployment = !!previousConfig.versioningOriginInscription;

      if (!buildDirExplicitlySet) {
        // Interactive mode - prompt for build directory
        try {
          options.buildDir = await promptForBuildDir(previousConfig.buildDir);
        } catch (error) {
          console.error(chalk.red('\nBuild directory selection cancelled.'));
          process.exit(1);
        }
      }

      // Step 3: Apply configuration precedence for other options
      // Order: CLI flag > Previous manifest > Environment variable > Default

      // Versioning origin inscription (use origin from first deployment)
      if (!options.versioningOriginInscription && previousConfig.versioningOriginInscription) {
        options.versioningOriginInscription = previousConfig.versioningOriginInscription;
      }

      // Step 4: Interactive prompts for missing values

      // Payment key
      if (!options.dryRun && !options.paymentKey) {
        try {
          options.paymentKey = await password({
            message: 'Payment key (WIF format):',
            mask: '•',
            validate: (value: string) => {
              if (!value || value.trim() === '') {
                return 'Payment key is required';
              }
              // Basic WIF format validation (starts with K, L, or 5 for mainnet)
              if (!/^[KL5]/.test(value.trim())) {
                return 'Invalid WIF format (should start with K, L, or 5)';
              }
              return true;
            },
          });
        } catch (error) {
          console.error(chalk.red('\nPayment key input cancelled.'));
          process.exit(1);
        }
      } else if (options.dryRun && !options.paymentKey) {
        // In dry-run mode, use dummy value if not provided
        options.paymentKey = 'L1aB2cD3eF4gH5iJ6kL7mN8oP9qR0sT1uV2wX3yZ4a5b6c7d8e9f0';
      }

      // App name (always required for first deployment)
      if (!isSubsequentDeployment && !options.appName) {
        if (options.dryRun) {
          // Dry-run mode: use dummy value
          options.appName = 'DryRunApp';
        } else {
          try {
            options.appName = await input({
              message: 'App name (for versioning):',
              default: 'ReactApp',
            });
          } catch (error) {
            console.error(chalk.red('\nApp name input cancelled.'));
            process.exit(1);
          }
        }
      } else if (isSubsequentDeployment && !options.appName) {
        // Load app name from manifest for subsequent deployments
        // This will be loaded automatically from manifest later, but set a default just in case
        options.appName = 'ReactApp';
      }

      // Version tag (always required)
      if (!options.versionTag) {
        if (options.dryRun) {
          // Dry-run mode: use dummy version
          options.versionTag = '1.0.0-dryrun';
        } else {
          try {
            options.versionTag = await promptForVersion(
              !isSubsequentDeployment,
              options.manifest || MANIFEST_FILENAME
            );
          } catch (error) {
            console.error(chalk.red('\nVersion input cancelled.'));
            process.exit(1);
          }
        }
      }

      // Version description (always required)
      if (!options.versionDescription) {
        if (options.dryRun) {
          // Dry-run mode: use dummy description
          options.versionDescription = 'Dry run deployment';
        } else {
          try {
            options.versionDescription = await input({
              message: 'Version description:',
              default: isSubsequentDeployment ? undefined : 'Initial release',
            });
          } catch (error) {
            console.error(chalk.red('\nVersion description input cancelled.'));
            process.exit(1);
          }
        }
      }

      // Resolve build directory
      const buildDir = resolve(options.buildDir);

      if (!existsSync(buildDir)) {
        console.error(chalk.red(`Error: Build directory not found: ${buildDir}`));
        process.exit(1);
      }

      // Check for index.html
      const indexPath = resolve(buildDir, 'index.html');
      if (!existsSync(indexPath)) {
        console.error(chalk.red(`Error: index.html not found in build directory: ${buildDir}`));
        process.exit(1);
      }

      // Beautiful header
      console.log();
      console.log(
        chalk.cyan('╔═══════════════════════════════════════════════════════════════════╗')
      );
      console.log(
        chalk.cyan('║') +
          chalk.bold.white('                  React OnChain Deployment                     ') +
          chalk.cyan('║')
      );
      console.log(
        chalk.cyan('║') +
          chalk.gray('          Deploy your React app to the BSV blockchain          ') +
          chalk.cyan('║')
      );
      console.log(
        chalk.cyan('╚═══════════════════════════════════════════════════════════════════╝')
      );
      console.log();

      if (options.dryRun) {
        console.log(
          chalk.yellow.bold('⚠️  DRY RUN MODE') +
            chalk.yellow(' - No transactions will be broadcast\n')
        );
      }

      // Configuration section
      console.log(chalk.bold.white('📋 Configuration'));
      console.log(chalk.gray('─'.repeat(CLI_CONSTANTS.DIVIDER_LENGTH)));
      console.log(chalk.gray('  Build directory: ') + chalk.cyan(buildDir));
      console.log(chalk.gray('  Fee rate:        ') + chalk.cyan(`${options.satsPerKb} sats/KB`));

      // Display versioning info (always shown)
      console.log(chalk.gray('  Version:         ') + chalk.magenta(options.versionTag!));
      console.log(chalk.gray('  Description:     ') + chalk.white(options.versionDescription!));
      console.log(chalk.gray('─'.repeat(CLI_CONSTANTS.DIVIDER_LENGTH)));
      console.log();

      const config: DeploymentConfig = {
        buildDir,
        paymentKey: options.paymentKey,
        changeAddress: options.change,
        satsPerKb: parseInt(options.satsPerKb, 10),
        dryRun: options.dryRun,
        ordinalContentUrl: options.ordinalContentUrl,
        ordinalIndexerUrl: options.ordinalIndexerUrl,
        version: options.versionTag!,
        versionDescription: options.versionDescription!,
        versioningOriginInscription: options.versioningOriginInscription,
        appName: options.appName!,
        chunkBatchSize: options.chunkBatchSize ? parseInt(options.chunkBatchSize, 10) : undefined,
      };

      // Confirmation prompt before deployment (skip if flags were explicitly provided via CLI)
      // Note: We use the captured boolean flags from before interactive prompts ran
      const hasProvidedFlags =
        buildDirExplicitlySet || wasPaymentKeyProvided || wasVersionTagProvided;

      if (!options.dryRun && !hasProvidedFlags) {
        console.log(
          chalk.yellow('⚠️  This will inscribe files to the blockchain and spend satoshis.')
        );
        try {
          const proceed = await confirm({
            message: 'Proceed with deployment?',
            default: true,
          });

          if (!proceed) {
            console.log(chalk.yellow('\n✋ Deployment cancelled by user.\n'));
            process.exit(0);
          }

          console.log();
        } catch (error) {
          console.log(chalk.yellow('\n✋ Deployment cancelled.\n'));
          process.exit(0);
        }
      }

      // Capture content URL for displaying absolute URLs in logs
      const contentUrlForDisplay = config.ordinalContentUrl || envConfig.ordinalContentUrl;

      let spinner = ora({ text: 'Analyzing build directory...', color: 'cyan' }).start();
      let totalFiles = 0;
      let completedFiles = 0;

      const result = await deployToChain(config, {
        onAnalysisStart: () => {
          spinner.text = '🔍 Analyzing build directory...';
        },
        onAnalysisComplete: (count) => {
          totalFiles = count;
          spinner.succeed(chalk.bold.green(`Found ${chalk.white(count)} source files`));
        },
        onCacheAnalysis: (cachedCount, newCount, cachedFiles, chunkedFilesInfo) => {
          // Show cache analysis with detailed chunk information
          if (cachedCount > 0) {
            // Show chunked files separately
            const chunkedFiles = chunkedFilesInfo.filter((f) => !f.isServiceWorker);
            const cachedSW = chunkedFilesInfo.find((f) => f.isServiceWorker);
            const regularCachedCount = cachedCount - chunkedFiles.length - (cachedSW ? 1 : 0);

            if (chunkedFiles.length > 0) {
              for (const chunkedFile of chunkedFiles) {
                console.log(
                  chalk.gray('  ├─ ') +
                    chalk.green(`${chunkedFile.chunkCount} cached chunks`) +
                    chalk.gray(` (${chunkedFile.filename})`)
                );
              }
            }

            if (cachedSW) {
              console.log(
                chalk.gray('  ├─ ') +
                  chalk.green(`1 cached`) +
                  chalk.gray(' (chunk-reassembly-sw.js)')
              );
            }

            if (regularCachedCount > 0) {
              console.log(
                chalk.gray('  ├─ ') +
                  chalk.green(`${regularCachedCount} cached`) +
                  chalk.gray(' (will reuse from previous deployment)')
              );
            }

            console.log(
              chalk.gray('  └─ ') +
                chalk.yellow(`${newCount} new`) +
                chalk.gray(' (will be inscribed)')
            );
          } else {
            console.log(chalk.gray('  └─ ') + chalk.yellow(`${newCount} files will be inscribed`));
          }
          console.log();
          console.log(chalk.bold.white('⚡ Inscribing to BSV Blockchain'));
          console.log(chalk.gray('─'.repeat(CLI_CONSTANTS.DIVIDER_LENGTH)));
          spinner = ora({ text: 'Preparing inscription...', color: 'yellow' }).start();
        },
        onInscriptionStart: (file, current, total) => {
          // Update overall progress bar
          const percent = Math.round((current / total) * 100);
          const { PROGRESS_BAR_WIDTH } = CLI_CONSTANTS;
          const filled = Math.floor(percent / 5);
          const progressBar = '█'.repeat(filled) + '░'.repeat(PROGRESS_BAR_WIDTH - filled);

          spinner.text =
            chalk.yellow(`[${progressBar}] ${percent}% `) +
            chalk.gray(`Inscribing `) +
            chalk.cyan(file) +
            chalk.gray(` (${current}/${total})`);
        },
        onInscriptionComplete: (file, url) => {
          completedFiles++;
          const absoluteUrl = contentUrlForDisplay + url;
          const shortUrl = absoluteUrl.split('/').pop() || url;
          spinner.stopAndPersist({
            symbol: chalk.green('✓'),
            text: chalk.white(file.padEnd(35)) + chalk.gray(' → ') + chalk.cyan(shortUrl),
          });

          // Show overall progress after completion
          if (completedFiles < totalFiles) {
            const percent = Math.round((completedFiles / totalFiles) * 100);
            const { PROGRESS_BAR_WIDTH } = CLI_CONSTANTS;
            const filled = Math.floor(percent / 5);
            const progressBar = '█'.repeat(filled) + '░'.repeat(PROGRESS_BAR_WIDTH - filled);
            spinner.start(
              chalk.yellow(`[${progressBar}] ${percent}% `) +
                chalk.gray(`${completedFiles}/${totalFiles} complete`)
            );
          } else {
            spinner.start('');
          }
        },
        onInscriptionSkipped: (file, url, chunkCount) => {
          completedFiles++;
          const absoluteUrl = contentUrlForDisplay + url;
          const shortUrl = absoluteUrl.split('/').pop() || url;
          const cacheInfo = chunkCount
            ? chalk.gray(` (cached, ${chunkCount} chunks)`)
            : chalk.gray(' (cached)');
          spinner.stopAndPersist({
            symbol: chalk.blue('↻'),
            text:
              chalk.white(file.padEnd(35)) + chalk.gray(' → ') + chalk.cyan(shortUrl) + cacheInfo,
          });

          // Show overall progress after skipping
          if (completedFiles < totalFiles) {
            const percent = Math.round((completedFiles / totalFiles) * 100);
            const { PROGRESS_BAR_WIDTH } = CLI_CONSTANTS;
            const filled = Math.floor(percent / 5);
            const progressBar = '█'.repeat(filled) + '░'.repeat(PROGRESS_BAR_WIDTH - filled);
            spinner.start(
              chalk.yellow(`[${progressBar}] ${percent}% `) +
                chalk.gray(`${completedFiles}/${totalFiles} complete`)
            );
          } else {
            spinner.start('');
          }
        },
        onDeploymentComplete: () => {
          spinner.stop();
          console.log(chalk.gray('─'.repeat(CLI_CONSTANTS.DIVIDER_LENGTH)));
        },
        onProgress: (message) => {
          // Update spinner with progress messages (overall progress bar shown via onInscriptionStart)
          spinner.text = chalk.gray(message);
        },
      });

      // Success banner
      console.log();
      console.log(
        chalk.green('╔═══════════════════════════════════════════════════════════════════╗')
      );
      console.log(
        chalk.green('║') +
          chalk.bold.white('                     Deployment Complete!                      ') +
          chalk.green('║')
      );
      console.log(
        chalk.green('╚═══════════════════════════════════════════════════════════════════╝')
      );
      console.log();

      if (options.dryRun) {
        console.log(
          chalk.yellow.bold('⚠️  DRY RUN') + chalk.yellow(' - Mock transaction IDs shown below\n')
        );
      }

      // Display file size summary
      displaySummary(result.inscriptions, result.totalSize);

      // Stats section with detailed breakdown
      const newFiles = result.inscriptions.filter((f) => !f.cached);
      const cachedFiles = result.inscriptions.filter((f) => f.cached);
      const chunkedFiles = newFiles.filter((f) => f.isChunked);
      const regularFiles = newFiles.filter(
        (f) => !f.isChunked && f.originalPath !== 'chunk-reassembly-sw.js'
      );
      const serviceWorker = newFiles.find((f) => f.originalPath === 'chunk-reassembly-sw.js');

      const newFilesSize = newFiles.reduce((sum, f) => sum + f.size, 0);
      const totalChunks = chunkedFiles.reduce((sum, f) => sum + (f.chunkCount || 0), 0);

      console.log(chalk.bold.white('📊 Deployment Stats'));
      console.log(chalk.gray('─'.repeat(CLI_CONSTANTS.DIVIDER_LENGTH)));
      console.log(
        chalk.gray('  Regular files:    ') +
          chalk.white(regularFiles.length) +
          chalk.gray(` (${formatBytes(regularFiles.reduce((sum, f) => sum + f.size, 0))})`)
      );
      if (chunkedFiles.length > 0) {
        console.log(
          chalk.gray('  Chunked files:    ') +
            chalk.magenta(chunkedFiles.length) +
            chalk.gray(
              ` (${formatBytes(chunkedFiles.reduce((sum, f) => sum + f.size, 0))}, ${totalChunks} chunks)`
            )
        );
      }
      if (serviceWorker) {
        console.log(
          chalk.gray('  Service Worker:   ') +
            chalk.blue('1') +
            chalk.gray(` (${formatBytes(serviceWorker.size)})`)
        );
      }
      if (cachedFiles.length > 0) {
        console.log(chalk.gray('  Cached files:     ') + chalk.cyan(cachedFiles.length));
      }
      console.log(
        chalk.gray('  Total files:      ') +
          chalk.white(result.inscriptions.length) +
          chalk.gray(` (${formatBytes(result.totalSize)})`)
      );
      console.log(
        chalk.gray('  Inscription cost: ') + chalk.white(`~${result.totalCost} satoshis`)
      );
      console.log(chalk.gray('  Transactions:     ') + chalk.white(result.txids.length));
      console.log(chalk.gray('─'.repeat(CLI_CONSTANTS.DIVIDER_LENGTH)));
      console.log();

      // Display versioning information (always shown)
      console.log(chalk.bold.magenta('📦 Versioning'));
      console.log(chalk.gray('─'.repeat(CLI_CONSTANTS.DIVIDER_LENGTH)));
      console.log(
        chalk.gray('  Origin:         ') + chalk.yellow(result.versioningOriginInscription)
      );
      console.log(chalk.gray('  Version:          ') + chalk.magenta(result.version));

      // Check if this is a first deployment (no --versioning-origin-inscription provided)
      const isFirstDeployment = !options.versioningOriginInscription;

      if (isFirstDeployment) {
        // First deployment - no version redirect script injected
        console.log(
          chalk.gray('  Version redirect: ') + chalk.yellow('Not available yet (first deployment)')
        );
        console.log(
          chalk.gray('                    ') + chalk.gray('Will be enabled on next deployment')
        );
        console.log();
        console.log(chalk.gray('  💡 To deploy next version:'));
        console.log(chalk.cyan(`     npx react-onchain deploy`));
        console.log();
        console.log(chalk.gray('     (all config auto-loaded from .env and manifest)'));
      } else {
        // Subsequent deployment - version redirect script was injected
        console.log(chalk.gray('  Version redirect: ') + chalk.green('✓ Enabled'));
        console.log(
          chalk.gray('  Version access:   ') +
            chalk.cyan(`${result.entryPointUrl}?version=<VERSION>`)
        );
      }

      console.log(chalk.gray('─'.repeat(CLI_CONSTANTS.DIVIDER_LENGTH)));
      console.log();

      // Show help for additional commands
      console.log(chalk.bold.white('📋 Additional Commands'));
      console.log(chalk.gray('─'.repeat(CLI_CONSTANTS.DIVIDER_LENGTH)));
      console.log(
        chalk.gray('  Run ') + chalk.cyan('npx react-onchain -h') + chalk.gray(' for more commands')
      );
      console.log(chalk.gray('─'.repeat(CLI_CONSTANTS.DIVIDER_LENGTH)));
      console.log();

      // Save manifest with history
      const manifest = generateManifest(result);
      const outputManifestPath = options.dryRun
        ? options.manifest.replace('.json', '-dry-run.json')
        : options.manifest;
      const history = await saveManifestWithHistory(
        manifest,
        outputManifestPath,
        result.versioningOriginInscription
      );

      // Save deployment configuration to .env (only for real deployments)
      if (!options.dryRun) {
        await saveDeploymentEnv({
          paymentKey: options.paymentKey!,
          buildDir: buildDir,
          appName: options.appName!,
          versioningOriginInscription: result.versioningOriginInscription,
          ordinalContentUrl: result.ordinalContentUrl || envConfig.ordinalContentUrl,
          satsPerKb: parseInt(options.satsPerKb || '1', 10),
        });
      }

      // Show deployment count
      const deploymentNum = history.totalDeployments;
      if (deploymentNum === 1) {
        console.log(chalk.gray(`📄 Manifest saved to: ${manifestPath}`));
        if (!options.dryRun) {
          console.log(chalk.gray(`🔐 Configuration saved to: .env`));
        }
      } else {
        console.log(
          chalk.gray(`📄 Manifest saved to: ${manifestPath} `) +
            chalk.cyan(`(Deployment #${deploymentNum})`)
        );
        if (!options.dryRun) {
          console.log(chalk.gray(`🔐 Configuration updated: .env`));
        }
      }
      console.log();

      if (options.dryRun) {
        console.log(
          chalk.yellow('╭─────────────────────────────────────────────────────────────────────╮')
        );
        console.log(
          chalk.yellow('│') +
            chalk.yellow.bold(' This was a dry run. To deploy for real, remove --dry-run flag. ') +
            chalk.yellow('│')
        );
        console.log(
          chalk.yellow('╰─────────────────────────────────────────────────────────────────────╯')
        );
        console.log();
      } else {
        console.log(
          chalk.green('╔═══════════════════════════════════════════════════════════════════╗')
        );
        console.log(
          chalk.green('║') +
            chalk.bold.white('          Your app is now live on the blockchain!             ') +
            chalk.green('║')
        );
        console.log(
          chalk.green('║') +
            '                                                                   ' +
            chalk.green('║')
        );
        console.log(
          chalk.green('║') +
            chalk.gray('  Note: May take a few moments to propagate across the network ') +
            chalk.green('║')
        );
        console.log(
          chalk.green('╚═══════════════════════════════════════════════════════════════════╝')
        );
        console.log();
        console.log(
          chalk.bold.cyan('  🔗 Visit: ') +
            chalk.cyan.underline(result.ordinalContentUrl + result.entryPointUrl)
        );
        console.log();
      }
    } catch (error) {
      console.error(chalk.red('\n❌ Deployment failed:\n'));
      console.error(chalk.red(formatError(error)));
      process.exit(1);
    }
  });

// Version history command
program
  .command('version:history [inscription]')
  .description(
    'Show version history for a versioning inscription (auto-reads from manifest if not specified)'
  )
  .option('-m, --manifest <file>', 'Path to manifest file', MANIFEST_FILENAME)
  .option(
    '-l, --limit <number>',
    'Limit number of versions to display',
    String(CLI_CONSTANTS.DEFAULT_VERSION_LIMIT)
  )
  .option('-f, --from-version <version>', 'Start displaying from a specific version')
  .option('-a, --all', 'Show all versions (ignores limit)')
  .action(async (inscriptionOrigin, options) => {
    try {
      // If inscription not provided, try to read from manifest
      if (!inscriptionOrigin) {
        if (existsSync(options.manifest)) {
          const manifestJson = await readFile(options.manifest, 'utf-8');
          const manifestData = JSON.parse(manifestJson);

          if ('manifestVersion' in manifestData && 'deployments' in manifestData) {
            inscriptionOrigin = manifestData.originVersioningInscription;
          }
        }

        if (!inscriptionOrigin) {
          console.error(chalk.red('\n❌ No versioning inscription found in manifest.'));
          console.error(chalk.gray('   Please provide inscription origin as argument.\n'));
          process.exit(1);
        }

        console.log(chalk.gray('✓ Using versioning inscription from manifest\n'));
      }

      console.log(chalk.bold('\n📚 Version History\n'));
      console.log(chalk.gray(`Inscription: ${inscriptionOrigin}\n`));

      const spinner = ora('Loading version history...').start();

      const { history, info } = await getVersionInfoAndHistory(inscriptionOrigin);

      spinner.succeed(chalk.green(`Found ${history.length} version(s)`));

      // Check for sync warning: compare latest on-chain with latest in manifest
      const manifestLatestVersion = await getManifestLatestVersion(options.manifest);

      const onChainLatestVersion = history[0]?.version;
      if (manifestLatestVersion && onChainLatestVersion !== manifestLatestVersion) {
        console.log(
          chalk.yellow(
            '\n⚠️  Warning: On-chain versioning data is still syncing. Latest on-chain version differs from manifest.'
          )
        );
        console.log(
          chalk.gray(
            `   Manifest latest: ${manifestLatestVersion} | On-chain latest: ${onChainLatestVersion}`
          )
        );
        console.log(chalk.gray('   Check back in a few moments for updated data.\n'));
      }

      // Apply pagination/filtering
      let displayHistory = history;
      const limit = options.all ? history.length : parseInt(options.limit, 10);

      // Filter from specific version if requested
      if (options.fromVersion) {
        const startIndex = history.findIndex((v) => v.version === options.fromVersion);
        if (startIndex === -1) {
          console.error(chalk.red(`\n❌ Version ${options.fromVersion} not found in history.\n`));
          process.exit(1);
        }
        displayHistory = history.slice(startIndex);
      }

      // Apply limit
      displayHistory = displayHistory.slice(0, limit);

      const showingCount = displayHistory.length;
      const totalCount = history.length;

      console.log(chalk.gray('─'.repeat(CLI_CONSTANTS.DIVIDER_LENGTH)));
      console.log(
        chalk.gray('Version'.padEnd(15)) +
          chalk.gray('Description'.padEnd(40)) +
          chalk.gray('Status')
      );
      console.log(chalk.gray('─'.repeat(CLI_CONSTANTS.DIVIDER_LENGTH)));

      for (let i = 0; i < displayHistory.length; i++) {
        const { version, description } = displayHistory[i];
        const isLatest = history[0].version === version;
        const status = isLatest ? chalk.green('(latest)') : '';
        const truncatedDesc =
          description.length > 37 ? description.substring(0, 34) + '...' : description;
        console.log(
          chalk.cyan(version.padEnd(15)) + chalk.white(truncatedDesc.padEnd(40)) + status
        );
      }

      console.log(chalk.gray('─'.repeat(CLI_CONSTANTS.DIVIDER_LENGTH)));

      if (showingCount < totalCount) {
        console.log(
          chalk.gray(
            `\nShowing ${showingCount} of ${totalCount} versions. Use --all to see all or --limit <n> to adjust.`
          )
        );
      }

      console.log(chalk.gray(`\nApp: ${info.appName}`));
      console.log(chalk.gray(`Origin: ${info.originOutpoint}\n`));
    } catch (error) {
      console.error(chalk.red('\n❌ Failed to get version history:\n'));
      console.error(chalk.red(formatError(error)));
      process.exit(1);
    }
  });

// Version info command
program
  .command('version:info <version> [inscription]')
  .description(
    'Get detailed information about a specific version (auto-reads inscription from manifest if not specified)'
  )
  .option('-m, --manifest <file>', 'Path to manifest file', MANIFEST_FILENAME)
  .action(async (version, inscriptionOrigin, options) => {
    try {
      // If inscription not provided, try to read from manifest
      if (!inscriptionOrigin) {
        if (existsSync(options.manifest)) {
          const manifestJson = await readFile(options.manifest, 'utf-8');
          const manifestData = JSON.parse(manifestJson);

          if ('manifestVersion' in manifestData && 'deployments' in manifestData) {
            inscriptionOrigin = manifestData.originVersioningInscription;
          }
        }

        if (!inscriptionOrigin) {
          console.error(chalk.red('\n❌ No versioning inscription found in manifest.'));
          console.error(chalk.gray('   Please provide inscription origin as argument.\n'));
          process.exit(1);
        }

        console.log(chalk.gray('✓ Using versioning inscription from manifest\n'));
      }

      console.log(chalk.bold('\n📦 Version Details\n'));

      const spinner = ora(`Loading version ${version}...`).start();

      const contentUrl = await loadContentUrl(options.manifest);
      const details = await getVersionDetails(inscriptionOrigin, version);

      if (!details) {
        spinner.fail(chalk.red(`Version ${version} not found`));
        process.exit(1);
      }

      spinner.succeed(chalk.green(`Version ${version} found`));

      console.log(chalk.gray('─'.repeat(CLI_CONSTANTS.DIVIDER_LENGTH)));
      console.log(chalk.bold('Version:     ') + chalk.cyan(details.version));
      console.log(chalk.bold('Outpoint:    ') + chalk.gray(details.outpoint));
      console.log(
        chalk.bold('URL:         ') + chalk.cyan(`${contentUrl}/content/${details.outpoint}`)
      );
      console.log(chalk.bold('Description: ') + details.description);
      console.log(chalk.gray('─'.repeat(CLI_CONSTANTS.DIVIDER_LENGTH)));
      console.log();
    } catch (error) {
      console.error(chalk.red('\n❌ Failed to get version info:\n'));
      console.error(chalk.red(formatError(error)));
      process.exit(1);
    }
  });

// Inscription summary command
program
  .command('version:summary [inscription]')
  .description(
    'Get information about a versioning inscription (auto-reads from manifest if not specified)'
  )
  .option('-m, --manifest <file>', 'Path to manifest file', MANIFEST_FILENAME)
  .action(async (inscriptionOrigin, options) => {
    try {
      // If inscription not provided, try to read from manifest
      if (!inscriptionOrigin) {
        if (existsSync(options.manifest)) {
          const manifestJson = await readFile(options.manifest, 'utf-8');
          const manifestData = JSON.parse(manifestJson);

          if ('manifestVersion' in manifestData && 'deployments' in manifestData) {
            inscriptionOrigin = manifestData.originVersioningInscription;
          }
        }

        if (!inscriptionOrigin) {
          console.error(chalk.red('\n❌ No versioning inscription found in manifest.'));
          console.error(chalk.gray('   Please provide inscription origin as argument.\n'));
          process.exit(1);
        }

        console.log(chalk.gray('✓ Using versioning inscription from manifest\n'));
      }

      console.log(chalk.bold('\n📋 Inscription Information\n'));

      const spinner = ora('Loading inscription info...').start();

      const { info, history } = await getVersionInfoAndHistory(inscriptionOrigin);

      spinner.succeed(chalk.green('Inscription info loaded'));

      console.log(chalk.gray('─'.repeat(CLI_CONSTANTS.DIVIDER_LENGTH)));
      console.log(chalk.bold('Inscription:   ') + chalk.cyan(info.outpoint));
      console.log(chalk.bold('App Name:      ') + info.appName);
      console.log(chalk.bold('Origin:        ') + chalk.gray(info.originOutpoint));
      console.log(chalk.bold('Total Versions:') + ` ${history.length}`);
      console.log(
        chalk.bold('Latest Version:') +
          ` ${history.length > 0 ? chalk.cyan(history[0].version) : chalk.gray('(none)')}`
      );
      console.log(chalk.gray('─'.repeat(CLI_CONSTANTS.DIVIDER_LENGTH)));
      console.log();
    } catch (error) {
      console.error(chalk.red('\n❌ Failed to get inscription info:\n'));
      console.error(chalk.red(formatError(error)));
      process.exit(1);
    }
  });

// Manifest history command
program
  .command('manifest:history')
  .description('Show local deployment history from manifest file')
  .option('-m, --manifest <file>', 'Path to manifest file', MANIFEST_FILENAME)
  .action(async (options) => {
    try {
      const manifestPath = resolve(options.manifest);

      if (!existsSync(manifestPath)) {
        console.error(chalk.red(`\n❌ Manifest file not found: ${manifestPath}\n`));
        process.exit(1);
      }

      const spinner = ora('Loading deployment history...').start();

      const data = await readFile(manifestPath, 'utf-8');
      const parsed = JSON.parse(data);

      // Check format
      if (!('manifestVersion' in parsed && 'deployments' in parsed)) {
        spinner.fail(chalk.yellow('Old manifest format detected'));
        console.log(chalk.yellow('\nThis manifest uses the old single-deployment format.'));
        console.log(chalk.gray('Deploy again to migrate to the new history-tracking format.\n'));
        process.exit(0);
      }

      const history = parsed as DeploymentManifestHistory;
      spinner.succeed(chalk.green(`Found ${history.totalDeployments} deployment(s)`));

      console.log(chalk.bold('\n📚 Deployment History\n'));
      console.log(chalk.gray('─'.repeat(CLI_CONSTANTS.DIVIDER_LENGTH)));

      // Show header
      console.log(
        chalk.gray('#'.padEnd(4)) +
          chalk.gray('Version'.padEnd(12)) +
          chalk.gray('Timestamp'.padEnd(22)) +
          chalk.gray('Files'.padEnd(8)) +
          chalk.gray('Size')
      );
      console.log(chalk.gray('─'.repeat(CLI_CONSTANTS.DIVIDER_LENGTH)));

      // Show each deployment
      history.deployments.forEach((deployment, index) => {
        const num = String(index + 1).padEnd(4);
        const version = (deployment.version || 'N/A').padEnd(12);
        const timestamp = new Date(deployment.timestamp).toLocaleString().padEnd(22);
        const files = String(deployment.totalFiles).padEnd(8);
        const size = formatBytes(deployment.totalSize);

        const isLatest = index === history.deployments.length - 1;
        const latestLabel = isLatest ? chalk.green(' (latest)') : '';

        console.log(
          chalk.cyan(num) +
            chalk.white(version) +
            chalk.gray(timestamp) +
            chalk.white(files) +
            chalk.yellow(size) +
            latestLabel
        );
      });

      console.log(chalk.gray('─'.repeat(CLI_CONSTANTS.DIVIDER_LENGTH)));

      // Show summary
      const totalCost = history.deployments.reduce((sum, d) => sum + d.totalCost, 0);
      const totalSize = history.deployments.reduce((sum, d) => sum + d.totalSize, 0);
      console.log(chalk.gray(`\nTotal deployments: ${history.totalDeployments}`));
      console.log(chalk.gray(`Total cost: ~${totalCost} satoshis`));
      console.log(chalk.gray(`Total size: ${formatBytes(totalSize)}`));

      if (history.originVersioningInscription) {
        console.log(chalk.gray(`Versioning inscription: ${history.originVersioningInscription}`));
      }
      console.log();
    } catch (error) {
      console.error(chalk.red('\n❌ Failed to read manifest history:\n'));
      console.error(chalk.red(formatError(error)));
      process.exit(1);
    }
  });

program.parse();
