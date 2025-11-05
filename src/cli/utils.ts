/**
 * CLI Utility Functions
 * Shared helpers for CLI commands
 */

import { existsSync } from 'fs';
import { resolve, relative } from 'path';
import { readFile, writeFile } from 'fs/promises';
import chalk from 'chalk';
import { input, confirm, select } from '@inquirer/prompts';
import { formatError } from '../utils/errors.js';
import { MANIFEST_FILENAME } from '../utils/constants.js';
import type { InscribedFile } from '../core/inscription/index.js';
import type { DeploymentManifestHistory } from '../core/orchestration/index.js';

// ============================================================================
// Constants
// ============================================================================

export const CLI_CONSTANTS = {
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

export interface ManifestData {
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
export function formatBytes(bytes: number): string {
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
export function parseSizeInput(input: string): number {
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
export async function readManifestData(
  manifestPath: string = MANIFEST_FILENAME
): Promise<ManifestData> {
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
export function incrementPatchVersion(version: string): string {
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
export async function loadContentUrl(
  manifestPath: string = MANIFEST_FILENAME,
  fallbackUrl: string
): Promise<string> {
  const manifestData = await readManifestData(manifestPath);

  if (manifestData.ordinalContentUrl) {
    return manifestData.ordinalContentUrl;
  }

  // Fallback to environment config
  return fallbackUrl;
}

/**
 * Display file size summary table
 */
export function displaySummary(inscriptions: InscribedFile[], totalSize: number): void {
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
export async function promptForBuildDir(previousBuildDir?: string): Promise<string> {
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
    // Convert to relative path for display (e.g., ./dist instead of /full/path/to/dist)
    const displayPath = relative(process.cwd(), previousBuildDir) || previousBuildDir;
    const formattedPath = displayPath.startsWith('.') ? displayPath : `./${displayPath}`;

    const useExisting = await confirm({
      message: `Use build directory from previous deployment? ${chalk.cyan(formattedPath)}`,
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
export async function checkVersionInManifest(
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
export async function getLastVersionAndSuggestNext(
  manifestPath: string
): Promise<string | undefined> {
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
export async function promptForVersion(
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
 * Parse existing .env file and extract user content (non-react-onchain variables)
 */
function parseExistingEnv(envContent: string): {
  userLines: string[];
  hasReactOnchainSection: boolean;
} {
  const lines = envContent.split('\n');
  const userLines: string[] = [];
  let inReactOnchainSection = false;
  let hasReactOnchainSection = false;

  // React OnChain variable names to identify our section
  const reactOnchainVars = [
    'REACT_ONCHAIN_PAYMENT_KEY',
    'BUILD_DIR',
    'APP_NAME',
    'VERSIONING_ORIGIN_INSCRIPTION',
    'HTML_ORIGIN_INSCRIPTION',
    'ORDINAL_CONTENT_URL',
    'SATS_PER_KB',
  ];

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect start of React OnChain section
    if (trimmed.includes('React OnChain Deployment Configuration')) {
      inReactOnchainSection = true;
      hasReactOnchainSection = true;
      continue;
    }

    // Detect React OnChain variables
    if (reactOnchainVars.some((varName) => trimmed.startsWith(`${varName}=`))) {
      inReactOnchainSection = true;
      hasReactOnchainSection = true;
      continue;
    }

    // Detect end of React OnChain section (closing comment box)
    if (inReactOnchainSection && trimmed.includes('==============')) {
      // Skip this line and the next few that are part of closing comments
      continue;
    }

    // If we're in React OnChain section, skip lines until we're out
    if (inReactOnchainSection) {
      // Check if this is a user variable (not a comment and not empty)
      if (trimmed && !trimmed.startsWith('#')) {
        // We've hit a user variable, we're out of the section
        inReactOnchainSection = false;
        userLines.push(line);
      }
      continue;
    }

    // We're not in React OnChain section, keep this line
    userLines.push(line);
  }

  return { userLines, hasReactOnchainSection };
}

/**
 * Save deployment configuration to .env file
 * Merges with existing .env content to preserve user variables
 */
export async function saveDeploymentEnv(config: {
  paymentKey: string;
  buildDir: string;
  appName: string;
  versioningOriginInscription: string;
  htmlOriginInscription?: string;
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

  // Read existing .env file if it exists
  let userContent = '';
  if (existsSync(envPath)) {
    const existingContent = await readFile(envPath, 'utf-8');
    const { userLines } = parseExistingEnv(existingContent);

    // Trim trailing empty lines from user content
    while (userLines.length > 0 && userLines[userLines.length - 1].trim() === '') {
      userLines.pop();
    }

    if (userLines.length > 0) {
      userContent = userLines.join('\n') + '\n\n';
    }
  }

  const reactOnchainSection = `# ==============================================================
# React OnChain Deployment Configuration
# Auto-generated by react-onchain on ${timestamp}
#
# ⚠️  SECURITY WARNING ⚠️
# This file contains your PRIVATE KEY!
# - NEVER commit this file to version control
# - NEVER share this file with anyone
#
# The .env file is in .gitignore to protect your keys.
# ==============================================================

# Payment private key (WIF format)
# Destination address is automatically derived from this key
REACT_ONCHAIN_PAYMENT_KEY=${config.paymentKey}

# Build directory
BUILD_DIR=${config.buildDir}

# Application name
APP_NAME=${config.appName}

# Versioning origin inscription (permanent reference)
VERSIONING_ORIGIN_INSCRIPTION=${config.versioningOriginInscription}

# HTML origin inscription (permanent reference for :-1 resolution)
HTML_ORIGIN_INSCRIPTION=${config.htmlOriginInscription || ''}

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

  // Merge user content with React OnChain section
  const finalContent = userContent + reactOnchainSection;

  await writeFile(envPath, finalContent, 'utf-8');
}

/**
 * Progress Logger - Clean, dynamic CLI progress display
 *
 * Features:
 * - Dynamic status lines that replace themselves
 * - Single progress bar that updates in place
 * - ANSI escape codes for cursor control
 * - Tracks total operations for accurate progress
 */

interface ProgressState {
  totalSteps: number;
  completedSteps: number;
  currentOperation: string;
  statusLines: string[];
  isActive: boolean;
}

const PROGRESS_BAR_WIDTH = 20;

export class ProgressLogger {
  private state: ProgressState;
  private dynamicLineCount: number = 0;

  constructor() {
    this.state = {
      totalSteps: 0,
      completedSteps: 0,
      currentOperation: '',
      statusLines: [],
      isActive: false,
    };
  }

  /**
   * Initialize progress tracking
   */
  start(totalSteps: number): void {
    this.state = {
      totalSteps,
      completedSteps: 0,
      currentOperation: '',
      statusLines: [],
      isActive: true,
    };
    this.dynamicLineCount = 0;
  }

  /**
   * Update current operation and optionally increment progress
   */
  update(operation: string, incrementStep: boolean = false): void {
    if (!this.state.isActive) return;

    if (incrementStep) {
      this.state.completedSteps++;
    }

    this.state.currentOperation = operation;
    this.render();
  }

  /**
   * Set a status line that appears above the progress bar (replaces previous)
   */
  setStatus(status: string): void {
    if (!this.state.isActive) return;

    // Replace all status lines with just this one
    this.state.statusLines = [status];
    this.render();
  }

  /**
   * Add a status line that appears above the progress bar
   */
  addStatus(status: string): void {
    if (!this.state.isActive) return;

    // Keep only last 2 status lines to avoid clutter
    this.state.statusLines.push(status);
    if (this.state.statusLines.length > 2) {
      this.state.statusLines.shift();
    }

    this.render();
  }

  /**
   * Complete a step and update display
   */
  completeStep(operation: string): void {
    this.update(operation, true);
  }

  /**
   * Finish progress tracking and clear dynamic display
   */
  finish(): void {
    if (!this.state.isActive) return;

    this.state.isActive = false;
    this.clearDynamic();
  }

  /**
   * Clear dynamic content (status lines + progress bar)
   */
  private clearDynamic(): void {
    if (this.dynamicLineCount === 0) return;

    // Move cursor up and clear each line
    for (let i = 0; i < this.dynamicLineCount; i++) {
      process.stdout.write('\x1b[1A'); // Move up
      process.stdout.write('\x1b[2K'); // Clear line
    }

    this.dynamicLineCount = 0;
  }

  /**
   * Render dynamic status + progress bar
   */
  private render(): void {
    // Clear previous render
    this.clearDynamic();

    const lines: string[] = [];

    // Add status lines
    for (const status of this.state.statusLines) {
      lines.push(chalk.gray(status));
    }

    // Add progress bar
    const percent = Math.min(
      100,
      Math.round((this.state.completedSteps / this.state.totalSteps) * 100)
    );
    const filled = Math.floor((percent / 100) * PROGRESS_BAR_WIDTH);
    const empty = PROGRESS_BAR_WIDTH - filled;

    const progressBar = chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));

    const progressLine =
      chalk.gray('[') +
      progressBar +
      chalk.gray(']') +
      chalk.yellow(` ${percent}%`) +
      chalk.gray(` ${this.state.currentOperation}`);

    lines.push(progressLine);

    // Write all lines
    for (const line of lines) {
      process.stdout.write(line + '\n');
    }

    this.dynamicLineCount = lines.length;
  }

  /**
   * Get current progress percentage
   */
  getProgress(): number {
    return Math.round((this.state.completedSteps / this.state.totalSteps) * 100);
  }
}

// Singleton instance
export const progressLogger = new ProgressLogger();
