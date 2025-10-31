#!/usr/bin/env node

import { Command } from 'commander';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { input, password, confirm, select } from '@inquirer/prompts';
import { deployToChain, generateManifest, saveManifestWithHistory } from './orchestrator.js';
import { getVersionDetails, getVersionInfoAndHistory } from './versioningInscriptionHandler.js';
import { config as envConfig, DEFAULT_CONFIG } from './config.js';
import type { DeploymentConfig, InscribedFile, DeploymentManifestHistory } from './types.js';
import { readFile, writeFile } from 'fs/promises';

const program = new Command();

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
 * Load content service URL from manifest (if exists) or fallback to config
 * Prioritizes manifest value since it represents what was used during deployment
 */
async function loadContentUrl(manifestPath: string = 'deployment-manifest.json'): Promise<string> {
  if (existsSync(manifestPath)) {
    try {
      const manifestJson = await readFile(manifestPath, 'utf-8');
      const manifestData = JSON.parse(manifestJson);

      // Check new format (history)
      if ('manifestVersion' in manifestData && 'deployments' in manifestData) {
        const history = manifestData as DeploymentManifestHistory;
        if (history.deployments.length > 0) {
          const latestDeployment = history.deployments[history.deployments.length - 1];
          if (latestDeployment.ordinalContentUrl) {
            return latestDeployment.ordinalContentUrl;
          }
        }
      } else if ('ordinalContentUrl' in manifestData && manifestData.ordinalContentUrl) {
        // Old format (single deployment)
        return manifestData.ordinalContentUrl;
      }
    } catch (error) {
      // Failed to read/parse manifest, fall through to config
    }
  }

  // Fallback to environment config
  return envConfig.ordinalContentUrl;
}

/**
 * Display file size summary table
 */
function displaySummary(inscriptions: InscribedFile[], totalSize: number): void {
  // Separate cached and new files
  const newFiles = inscriptions.filter((f) => !f.cached);
  const cachedFiles = inscriptions.filter((f) => f.cached);

  // Display new inscriptions
  if (newFiles.length > 0) {
    console.log(chalk.bold.white('📄 New Inscriptions'));
    console.log(chalk.gray('─'.repeat(70)));

    newFiles.forEach((file, index) => {
      const fileName =
        file.originalPath.length > 35 ? '...' + file.originalPath.slice(-32) : file.originalPath;

      const number = chalk.gray(`${String(index + 1).padStart(2)}. `);
      const name = chalk.white(fileName.padEnd(35));
      const size = chalk.yellow(formatBytes(file.size).padEnd(10));
      const txid = chalk.gray(file.txid.slice(0, 8) + '...');

      console.log(`  ${number}${name} ${size} ${txid}`);
    });

    const newFilesSize = newFiles.reduce((sum, f) => sum + f.size, 0);
    console.log(chalk.gray('─'.repeat(70)));
    console.log(
      chalk.gray('  SUBTOTAL'.padEnd(39)) +
        chalk.bold.green(formatBytes(newFilesSize).padEnd(11)) +
        chalk.gray(`${newFiles.length} file${newFiles.length !== 1 ? 's' : ''}`)
    );
    console.log(chalk.gray('─'.repeat(70)));
    console.log();
  }

  // Display cached files
  if (cachedFiles.length > 0) {
    console.log(chalk.bold.cyan('📦 Cached Files (Reused)'));
    console.log(chalk.gray('─'.repeat(70)));

    cachedFiles.forEach((file, index) => {
      const fileName =
        file.originalPath.length > 35 ? '...' + file.originalPath.slice(-32) : file.originalPath;

      const number = chalk.gray(`${String(index + 1).padStart(2)}. `);
      const name = chalk.cyan(fileName.padEnd(35));
      const size = chalk.gray(formatBytes(file.size).padEnd(10));
      const txid = chalk.gray(file.txid.slice(0, 8) + '...');

      console.log(`  ${number}${name} ${size} ${txid}`);
    });

    const cachedFilesSize = cachedFiles.reduce((sum, f) => sum + f.size, 0);
    console.log(chalk.gray('─'.repeat(70)));
    console.log(
      chalk.gray('  SUBTOTAL'.padEnd(39)) +
        chalk.cyan(formatBytes(cachedFilesSize).padEnd(11)) +
        chalk.gray(`${cachedFiles.length} file${cachedFiles.length !== 1 ? 's' : ''}`)
    );
    console.log(chalk.gray('─'.repeat(70)));
    console.log();
  }

  // Display total
  console.log(chalk.bold.white('📊 Total'));
  console.log(chalk.gray('─'.repeat(70)));
  console.log(
    chalk.gray('  TOTAL'.padEnd(39)) +
      chalk.bold.green(formatBytes(totalSize).padEnd(11)) +
      chalk.gray(`${inscriptions.length} file${inscriptions.length !== 1 ? 's' : ''}`)
  );
  console.log(chalk.gray('─'.repeat(70)));
  console.log();
}

/**
 * Detect available build directories and prompt user to select one
 */
async function promptForBuildDir(previousBuildDir?: string): Promise<string> {
  const commonBuildDirs = ['dist', 'build', 'out', '.next/standalone', 'public'];
  const detectedDirs: string[] = [];

  // Check each common directory
  for (const dir of commonBuildDirs) {
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
function checkVersionInManifest(
  version: string,
  manifestPath: string = 'deployment-manifest.json'
): { exists: boolean; availableVersions: string[]; suggestion: string } {
  const availableVersions: string[] = [];

  const resolvedPath = resolve(manifestPath);
  if (existsSync(resolvedPath)) {
    try {
      const manifestJson = readFileSync(resolvedPath, 'utf-8');
      const manifestData = JSON.parse(manifestJson);

      let deployments = [];
      if ('manifestVersion' in manifestData && 'deployments' in manifestData) {
        deployments = manifestData.deployments;
      } else if ('version' in manifestData) {
        deployments = [manifestData];
      }

      // Collect all versions
      for (const deployment of deployments) {
        if (deployment.version) {
          availableVersions.push(deployment.version);
        }
      }

      // Check if version exists
      const exists = availableVersions.includes(version);

      // Generate suggestion
      let suggestion = version;
      if (exists) {
        const parts = version.split('.');
        const lastPart = parseInt(parts[parts.length - 1] || '0');
        parts[parts.length - 1] = String(lastPart + 1);
        suggestion = parts.join('.');
      }

      return { exists, availableVersions, suggestion };
    } catch (error) {
      // Error reading manifest, assume version doesn't exist
      console.error(
        chalk.yellow('⚠️  Warning: Could not read manifest for version validation:'),
        error
      );
    }
  }

  return { exists: false, availableVersions: [], suggestion: version };
}

/**
 * Get the last version from manifest and increment patch version
 */
function getLastVersionAndSuggestNext(manifestPath: string): string | undefined {
  const resolvedPath = resolve(manifestPath);
  if (!existsSync(resolvedPath)) {
    return undefined;
  }

  try {
    const manifestJson = readFileSync(resolvedPath, 'utf-8');
    const manifestData = JSON.parse(manifestJson);

    let lastVersion: string | undefined;

    if ('manifestVersion' in manifestData && 'deployments' in manifestData) {
      // New format - get last deployment version
      const deployments = manifestData.deployments;
      if (deployments.length > 0) {
        lastVersion = deployments[deployments.length - 1].version;
      }
    } else if ('version' in manifestData) {
      // Old format - single deployment
      lastVersion = manifestData.version;
    }

    if (lastVersion) {
      // Increment patch version (e.g., "1.0.0" → "1.0.1")
      const parts = lastVersion.split('.');
      if (parts.length === 3) {
        parts[2] = String(parseInt(parts[2]) + 1);
        return parts.join('.');
      }
    }
  } catch (error) {
    // Ignore errors, return undefined
  }

  return undefined;
}

/**
 * Prompt for version tag with validation
 */
async function promptForVersion(
  isFirstDeployment: boolean,
  manifestPath: string = 'deployment-manifest.json'
): Promise<string> {
  let version: string;

  // Get suggested version
  const suggestedVersion = isFirstDeployment
    ? '1.0.0'
    : getLastVersionAndSuggestNext(manifestPath) || '1.0.0';

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

    const check = checkVersionInManifest(version.trim(), manifestPath);

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
  const envPath = resolve('.env');
  const gitignorePath = resolve('.gitignore');
  const timestamp = new Date().toISOString().split('T')[0];

  // Ensure .gitignore exists and contains .env
  if (existsSync(gitignorePath)) {
    // Read existing .gitignore
    const gitignoreContent = await readFile(gitignorePath, 'utf-8');
    const lines = gitignoreContent.split('\n');

    // Check if .env is already in .gitignore
    const hasEnv = lines.some((line) => line.trim() === '.env');

    if (!hasEnv) {
      // Add .env to .gitignore
      const updatedContent = gitignoreContent.endsWith('\n')
        ? gitignoreContent + '.env\n'
        : gitignoreContent + '\n.env\n';
      await writeFile(gitignorePath, updatedContent, 'utf-8');
    }
  } else {
    // Create .gitignore with .env
    await writeFile(gitignorePath, '.env\n', 'utf-8');
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
  .action(async (options) => {
    try {
      // Step 0: Capture which flags were explicitly provided via CLI (before interactive prompts)
      const wasPaymentKeyProvided = options.paymentKey !== undefined;
      const wasVersionTagProvided = options.versionTag !== undefined;

      // Step 1: Load previous manifest to get stored configuration
      const manifestPath = resolve('deployment-manifest.json');
      let previousConfig: {
        buildDir?: string;
        versioningOriginInscription?: string;
      } = {};

      if (existsSync(manifestPath)) {
        try {
          const manifestJson = await readFile(manifestPath, 'utf-8');
          const manifestData = JSON.parse(manifestJson);

          if ('manifestVersion' in manifestData && 'deployments' in manifestData) {
            // New format - use top-level originVersioningInscription, last deployment for other config
            const history = manifestData;
            if (history.deployments.length > 0) {
              const lastDeployment = history.deployments[history.deployments.length - 1];

              // Origin versioning inscription from top-level field
              previousConfig.versioningOriginInscription = history.originVersioningInscription;
              // Build dir from last deployment
              previousConfig.buildDir = lastDeployment.buildDir;
            }
          } else if ('timestamp' in manifestData && 'entryPoint' in manifestData) {
            // Old format - single deployment
            previousConfig.versioningOriginInscription =
              manifestData.originVersioningInscription || '';
            previousConfig.buildDir = manifestData.buildDir;
          }
        } catch (error) {
          // Failed to load manifest - continue without previous config
        }
      }

      // Step 2: Build directory - interactive prompt or auto-detect
      const buildDirExplicitlySet = options.buildDir !== DEFAULT_CONFIG.buildDir;
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
              options.manifest || 'deployment-manifest.json'
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
      console.log(chalk.gray('─'.repeat(70)));
      console.log(chalk.gray('  Build directory: ') + chalk.cyan(buildDir));
      console.log(chalk.gray('  Fee rate:        ') + chalk.cyan(`${options.satsPerKb} sats/KB`));

      // Display versioning info (always shown)
      console.log(chalk.gray('  Version:         ') + chalk.magenta(options.versionTag!));
      console.log(chalk.gray('  Description:     ') + chalk.white(options.versionDescription!));
      if (options.versioningOriginInscription) {
        console.log(
          chalk.gray('  Origin Inscription:        ') +
            chalk.yellow(options.versioningOriginInscription)
        );
      } else {
        console.log(
          chalk.gray('  App name:        ') +
            chalk.green(options.appName!) +
            chalk.gray(' (new versioning inscription)')
        );
      }
      console.log(chalk.gray('─'.repeat(70)));
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

      const result = await deployToChain(config, {
        onAnalysisStart: () => {
          spinner.text = '🔍 Analyzing build directory...';
        },
        onAnalysisComplete: (count) => {
          spinner.succeed(chalk.bold.green(`Found ${chalk.white(count)} files to inscribe`));
          console.log();
          console.log(chalk.bold.white('⚡ Inscribing to BSV Blockchain'));
          console.log(chalk.gray('─'.repeat(70)));
          spinner = ora({ text: 'Preparing inscription...', color: 'yellow' }).start();
        },
        onInscriptionStart: (file, current, total) => {
          const percent = Math.round((current / total) * 100);
          const progressBar =
            '█'.repeat(Math.floor(percent / 5)) + '░'.repeat(20 - Math.floor(percent / 5));
          spinner.text =
            chalk.yellow(`[${progressBar}] ${percent}%`) +
            chalk.gray(` Inscribing `) +
            chalk.cyan(file) +
            chalk.gray(` (${current}/${total})`);
        },
        onInscriptionComplete: (file, url) => {
          const absoluteUrl = contentUrlForDisplay + url;
          const shortUrl = absoluteUrl.split('/').pop() || url;
          spinner.stopAndPersist({
            symbol: chalk.green('✓'),
            text: chalk.white(file.padEnd(35)) + chalk.gray(' → ') + chalk.cyan(shortUrl),
          });
          spinner.start('');
        },
        onInscriptionSkipped: (file, url) => {
          const absoluteUrl = contentUrlForDisplay + url;
          const shortUrl = absoluteUrl.split('/').pop() || url;
          spinner.stopAndPersist({
            symbol: chalk.blue('↻'),
            text:
              chalk.white(file.padEnd(35)) +
              chalk.gray(' → ') +
              chalk.cyan(shortUrl) +
              chalk.gray(' (cached)'),
          });
          spinner.start('');
        },
        onDeploymentComplete: () => {
          spinner.stop();
          console.log(chalk.gray('─'.repeat(70)));
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

      // Stats section
      const newFileCount = result.inscriptions.filter((f) => !f.cached).length;
      const cachedFileCount = result.inscriptions.filter((f) => f.cached).length;
      const newFilesSize = result.inscriptions
        .filter((f) => !f.cached)
        .reduce((sum, f) => sum + f.size, 0);

      console.log(chalk.bold.white('📊 Deployment Stats'));
      console.log(chalk.gray('─'.repeat(70)));
      console.log(
        chalk.gray('  New files:        ') +
          chalk.white(newFileCount) +
          chalk.gray(` (${formatBytes(newFilesSize)})`)
      );
      console.log(chalk.gray('  Cached files:     ') + chalk.cyan(cachedFileCount));
      console.log(
        chalk.gray('  Total files:      ') +
          chalk.white(result.inscriptions.length) +
          chalk.gray(` (${formatBytes(result.totalSize)})`)
      );
      console.log(
        chalk.gray('  Inscription cost: ') + chalk.white(`~${result.totalCost} satoshis`)
      );
      console.log(chalk.gray('  Transactions:     ') + chalk.white(result.txids.length));
      console.log(chalk.gray('─'.repeat(70)));
      console.log();

      // Display versioning information (always shown)
      console.log(chalk.bold.magenta('📦 Versioning'));
      console.log(chalk.gray('─'.repeat(70)));
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
            chalk.cyan(`${result.ordinalContentUrl + result.entryPointUrl}?version=<VERSION>`)
        );
      }

      console.log(chalk.gray('─'.repeat(70)));
      console.log();

      // Show available query commands
      console.log(chalk.bold.white('📋 Available Queries'));
      console.log(chalk.gray('─'.repeat(70)));
      console.log(
        chalk.gray('  • Version history:   ') +
          chalk.cyan(`npx react-onchain version:history <ORIGIN>`)
      );
      console.log(
        chalk.gray('  • Version summary:   ') +
          chalk.cyan(`npx react-onchain version:summary <ORIGIN>`)
      );
      console.log(
        chalk.gray('  • Version details:   ') +
          chalk.cyan(`npx react-onchain version:info <ORIGIN> <VERSION>`)
      );
      console.log(chalk.gray('─'.repeat(70)));
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
            chalk.gray('  Note: It may take ~10 minutes for full confirmation           ') +
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
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

// Version history command
program
  .command('version:history [inscription]')
  .description(
    'Show version history for a versioning inscription (auto-reads from manifest if not specified)'
  )
  .option('-m, --manifest <file>', 'Path to manifest file', 'deployment-manifest.json')
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

      console.log(chalk.gray('─'.repeat(70)));
      console.log(
        chalk.gray('Version'.padEnd(15)) +
          chalk.gray('Description'.padEnd(40)) +
          chalk.gray('Status')
      );
      console.log(chalk.gray('─'.repeat(70)));

      for (let i = 0; i < history.length; i++) {
        const { version, description } = history[i];
        const isLatest = i === 0;
        const status = isLatest ? chalk.green('(latest)') : '';
        const truncatedDesc =
          description.length > 37 ? description.substring(0, 34) + '...' : description;
        console.log(
          chalk.cyan(version.padEnd(15)) + chalk.white(truncatedDesc.padEnd(40)) + status
        );
      }

      console.log(chalk.gray('─'.repeat(70)));
      console.log(chalk.gray(`\nApp: ${info.appName}`));
      console.log(chalk.gray(`Origin: ${info.originOutpoint}\n`));
    } catch (error) {
      console.error(chalk.red('\n❌ Failed to get version history:\n'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

// Version info command
program
  .command('version:info <version> [inscription]')
  .description(
    'Get detailed information about a specific version (auto-reads inscription from manifest if not specified)'
  )
  .option('-m, --manifest <file>', 'Path to manifest file', 'deployment-manifest.json')
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

      console.log(chalk.gray('─'.repeat(70)));
      console.log(chalk.bold('Version:     ') + chalk.cyan(details.version));
      console.log(chalk.bold('Outpoint:    ') + chalk.gray(details.outpoint));
      console.log(
        chalk.bold('URL:         ') + chalk.cyan(`${contentUrl}/content/${details.outpoint}`)
      );
      console.log(chalk.bold('Description: ') + details.description);
      console.log(chalk.gray('─'.repeat(70)));
      console.log();
    } catch (error) {
      console.error(chalk.red('\n❌ Failed to get version info:\n'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

// Inscription summary command
program
  .command('version:summary [inscription]')
  .description(
    'Get information about a versioning inscription (auto-reads from manifest if not specified)'
  )
  .option('-m, --manifest <file>', 'Path to manifest file', 'deployment-manifest.json')
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

      console.log(chalk.gray('─'.repeat(70)));
      console.log(chalk.bold('Inscription:   ') + chalk.cyan(info.outpoint));
      console.log(chalk.bold('App Name:      ') + info.appName);
      console.log(chalk.bold('Origin:        ') + chalk.gray(info.originOutpoint));
      console.log(chalk.bold('Total Versions:') + ` ${history.length}`);
      console.log(
        chalk.bold('Latest Version:') +
          ` ${history.length > 0 ? chalk.cyan(history[0].version) : chalk.gray('(none)')}`
      );
      console.log(chalk.gray('─'.repeat(70)));
      console.log();
    } catch (error) {
      console.error(chalk.red('\n❌ Failed to get inscription info:\n'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

// Manifest history command
program
  .command('manifest:history')
  .description('Show local deployment history from manifest file')
  .option('-m, --manifest <file>', 'Path to manifest file', 'deployment-manifest.json')
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
      console.log(chalk.gray('─'.repeat(70)));

      // Show header
      console.log(
        chalk.gray('#'.padEnd(4)) +
          chalk.gray('Version'.padEnd(12)) +
          chalk.gray('Timestamp'.padEnd(22)) +
          chalk.gray('Files'.padEnd(8)) +
          chalk.gray('Size')
      );
      console.log(chalk.gray('─'.repeat(70)));

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

      console.log(chalk.gray('─'.repeat(70)));

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
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

program.parse();
