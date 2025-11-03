/**
 * Display Functions
 * Handles all UI output for the deploy command
 */

import chalk from 'chalk';
import { CLI_CONSTANTS, formatBytes } from '../../utils.js';
import type { DeploymentResult } from '../../../core/orchestration/index.js';

/**
 * Display deployment header with ASCII art
 */
export function displayDeploymentHeader(dryRun: boolean): void {
  console.log();
  console.log(chalk.cyan('╔═══════════════════════════════════════════════════════════════════╗'));
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
  console.log(chalk.cyan('╚═══════════════════════════════════════════════════════════════════╝'));
  console.log();

  if (dryRun) {
    console.log(
      chalk.yellow.bold('⚠️  DRY RUN MODE') + chalk.yellow(' - No transactions will be broadcast\n')
    );
  }
}

/**
 * Display configuration summary
 */
export function displayConfiguration(config: {
  buildDir: string;
  satsPerKb: number;
  versionTag: string;
  versionDescription: string;
}): void {
  console.log(chalk.bold.white('📋 Configuration'));
  console.log(chalk.gray('─'.repeat(CLI_CONSTANTS.DIVIDER_LENGTH)));
  console.log(chalk.gray('  Build directory: ') + chalk.cyan(config.buildDir));
  console.log(chalk.gray('  Fee rate:        ') + chalk.cyan(`${config.satsPerKb} sats/KB`));
  console.log(chalk.gray('  Version:         ') + chalk.magenta(config.versionTag));
  console.log(chalk.gray('  Description:     ') + chalk.white(config.versionDescription));
  console.log(chalk.gray('─'.repeat(CLI_CONSTANTS.DIVIDER_LENGTH)));
  console.log();
}

/**
 * Display success banner
 */
export function displaySuccessBanner(dryRun: boolean): void {
  console.log();
  console.log(chalk.green('╔═══════════════════════════════════════════════════════════════════╗'));
  console.log(
    chalk.green('║') +
      chalk.bold.white('                     Deployment Complete!                      ') +
      chalk.green('║')
  );
  console.log(chalk.green('╚═══════════════════════════════════════════════════════════════════╝'));
  console.log();

  if (dryRun) {
    console.log(
      chalk.yellow.bold('⚠️  DRY RUN') + chalk.yellow(' - Mock transaction IDs shown below\n')
    );
  }
}

/**
 * Display deployment statistics
 */
export function displayDeploymentStats(result: DeploymentResult): void {
  const newFiles = result.inscriptions.filter((f) => !f.cached);
  const cachedFiles = result.inscriptions.filter((f) => f.cached);
  const chunkedFiles = newFiles.filter((f) => f.isChunked);
  const regularFiles = newFiles.filter(
    (f) => !f.isChunked && f.originalPath !== 'chunk-reassembly-sw.js'
  );
  const serviceWorker = newFiles.find((f) => f.originalPath === 'chunk-reassembly-sw.js');

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
  console.log(chalk.gray('  Inscription cost: ') + chalk.white(`~${result.totalCost} satoshis`));
  console.log(chalk.gray('  Transactions:     ') + chalk.white(result.txids.length));
  console.log(chalk.gray('─'.repeat(CLI_CONSTANTS.DIVIDER_LENGTH)));
  console.log();
}

/**
 * Display versioning information
 */
export function displayVersioningInfo(result: DeploymentResult, isFirstDeployment: boolean): void {
  console.log(chalk.bold.magenta('📦 Versioning'));
  console.log(chalk.gray('─'.repeat(CLI_CONSTANTS.DIVIDER_LENGTH)));
  console.log(chalk.gray('  Origin:         ') + chalk.yellow(result.versioningOriginInscription));
  console.log(chalk.gray('  Version:          ') + chalk.magenta(result.version));

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
      chalk.gray('  Version access:   ') + chalk.cyan(`${result.entryPointUrl}?version=<VERSION>`)
    );
  }

  console.log(chalk.gray('─'.repeat(CLI_CONSTANTS.DIVIDER_LENGTH)));
  console.log();
}

/**
 * Display additional commands help
 */
export function displayAdditionalCommands(): void {
  console.log(chalk.bold.white('📋 Additional Commands'));
  console.log(chalk.gray('─'.repeat(CLI_CONSTANTS.DIVIDER_LENGTH)));
  console.log(
    chalk.gray('  Run ') + chalk.cyan('npx react-onchain -h') + chalk.gray(' for more commands')
  );
  console.log(chalk.gray('─'.repeat(CLI_CONSTANTS.DIVIDER_LENGTH)));
  console.log();
}

/**
 * Display manifest saved confirmation
 */
export function displayManifestSaved(
  manifestPath: string,
  deploymentNum: number,
  dryRun: boolean
): void {
  if (deploymentNum === 1) {
    console.log(chalk.gray(`📄 Manifest saved to: ${manifestPath}`));
    if (!dryRun) {
      console.log(chalk.gray(`🔐 Configuration saved to: .env`));
    }
  } else {
    console.log(
      chalk.gray(`📄 Manifest saved to: ${manifestPath} `) +
        chalk.cyan(`(Deployment #${deploymentNum})`)
    );
    if (!dryRun) {
      console.log(chalk.gray(`🔐 Configuration updated: .env`));
    }
  }
  console.log();
}

/**
 * Display final deployment message
 */
export function displayFinalMessage(result: DeploymentResult, dryRun: boolean): void {
  if (dryRun) {
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
}
