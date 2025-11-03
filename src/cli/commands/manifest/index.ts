/**
 * Manifest Commands
 * Handles manifest history and related commands
 */

import { existsSync } from 'fs';
import { resolve } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import type { Command } from 'commander';
import type { DeploymentManifestHistory } from '../../../core/orchestration/index.js';
import { readFile } from 'fs/promises';
import { formatError } from '../../../utils/errors.js';
import { MANIFEST_FILENAME } from '../../../utils/constants.js';
import { displayDeploymentHistory, displayDeploymentSummary } from './display.js';

/**
 * Register manifest-related commands with the CLI program
 */
export function registerManifestCommands(program: Command): void {
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

        displayDeploymentHistory(history);
        displayDeploymentSummary(history);
      } catch (error) {
        console.error(chalk.red('\n❌ Failed to read manifest history:\n'));
        console.error(chalk.red(formatError(error)));
        process.exit(1);
      }
    });
}
