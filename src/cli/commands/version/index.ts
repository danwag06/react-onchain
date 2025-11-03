/**
 * Version Commands
 * Handles version history, info, and summary commands
 */

import { existsSync } from 'fs';
import chalk from 'chalk';
import ora from 'ora';
import type { Command } from 'commander';
import { getVersionDetails, getVersionInfoAndHistory } from '../../../core/versioning/index.js';
import { config as envConfig } from '../../../lib/config.js';
import { readFile } from 'fs/promises';
import { formatError } from '../../../utils/errors.js';
import { MANIFEST_FILENAME } from '../../../utils/constants.js';
import { getManifestLatestVersion } from '../../../core/versioning/utils.js';
import { CLI_CONSTANTS, loadContentUrl } from '../../utils.js';
import {
  displayVersionHistory,
  displaySyncWarning,
  displayVersionDetails,
  displayInscriptionSummary,
} from './display.js';

/**
 * Read versioning inscription from manifest
 */
async function getInscriptionFromManifest(manifestPath: string): Promise<string | null> {
  if (existsSync(manifestPath)) {
    const manifestJson = await readFile(manifestPath, 'utf-8');
    const manifestData = JSON.parse(manifestJson);

    if ('manifestVersion' in manifestData && 'deployments' in manifestData) {
      return manifestData.originVersioningInscription;
    }
  }
  return null;
}

/**
 * Register version-related commands with the CLI program
 */
export function registerVersionCommands(program: Command): void {
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
          inscriptionOrigin = await getInscriptionFromManifest(options.manifest);

          if (!inscriptionOrigin) {
            console.error(chalk.red('\n❌ No versioning inscription found in manifest.'));
            console.error(chalk.gray('   Please provide inscription origin as argument.\n'));
            process.exit(1);
          }

          console.log(chalk.gray('✓ Using versioning inscription from manifest\n'));
        }

        const spinner = ora('Loading version history...').start();

        const { history, info } = await getVersionInfoAndHistory(inscriptionOrigin);

        spinner.succeed(chalk.green(`Found ${history.length} version(s)`));

        // Check for sync warning: compare latest on-chain with latest in manifest
        const manifestLatestVersion = await getManifestLatestVersion(options.manifest);

        const onChainLatestVersion = history[0]?.version;
        if (manifestLatestVersion && onChainLatestVersion !== manifestLatestVersion) {
          displaySyncWarning(manifestLatestVersion, onChainLatestVersion);
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

        displayVersionHistory(displayHistory, inscriptionOrigin, showingCount, totalCount, info);
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
          inscriptionOrigin = await getInscriptionFromManifest(options.manifest);

          if (!inscriptionOrigin) {
            console.error(chalk.red('\n❌ No versioning inscription found in manifest.'));
            console.error(chalk.gray('   Please provide inscription origin as argument.\n'));
            process.exit(1);
          }

          console.log(chalk.gray('✓ Using versioning inscription from manifest\n'));
        }

        const spinner = ora(`Loading version ${version}...`).start();

        const contentUrl = await loadContentUrl(options.manifest, envConfig.ordinalContentUrl);
        const details = await getVersionDetails(inscriptionOrigin, version);

        if (!details) {
          spinner.fail(chalk.red(`Version ${version} not found`));
          process.exit(1);
        }

        spinner.succeed(chalk.green(`Version ${version} found`));

        displayVersionDetails({
          version: details.version,
          outpoint: details.outpoint,
          description: details.description,
          contentUrl,
        });
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
          inscriptionOrigin = await getInscriptionFromManifest(options.manifest);

          if (!inscriptionOrigin) {
            console.error(chalk.red('\n❌ No versioning inscription found in manifest.'));
            console.error(chalk.gray('   Please provide inscription origin as argument.\n'));
            process.exit(1);
          }

          console.log(chalk.gray('✓ Using versioning inscription from manifest\n'));
        }

        const spinner = ora('Loading inscription info...').start();

        const { info, history } = await getVersionInfoAndHistory(inscriptionOrigin);

        spinner.succeed(chalk.green('Inscription info loaded'));

        displayInscriptionSummary(
          info,
          history.length,
          history.length > 0 ? history[0].version : null
        );
      } catch (error) {
        console.error(chalk.red('\n❌ Failed to get inscription info:\n'));
        console.error(chalk.red(formatError(error)));
        process.exit(1);
      }
    });
}
