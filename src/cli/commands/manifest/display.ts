/**
 * Display Functions
 * Handles UI output for manifest commands
 */

import chalk from 'chalk';
import { CLI_CONSTANTS, formatBytes } from '../../utils.js';
import type { DeploymentManifestHistory } from '../../../core/orchestration/index.js';

/**
 * Display deployment history table
 */
export function displayDeploymentHistory(history: DeploymentManifestHistory): void {
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
}

/**
 * Display deployment summary
 */
export function displayDeploymentSummary(history: DeploymentManifestHistory): void {
  const totalCost = history.deployments.reduce((sum, d) => sum + d.totalCost, 0);
  const totalSize = history.deployments.reduce((sum, d) => sum + d.totalSize, 0);

  console.log(chalk.gray(`\nTotal deployments: ${history.totalDeployments}`));
  console.log(chalk.gray(`Total cost: ~${totalCost} satoshis`));
  console.log(chalk.gray(`Total size: ${formatBytes(totalSize)}`));

  if (history.originVersioningInscription) {
    console.log(chalk.gray(`Versioning inscription: ${history.originVersioningInscription}`));
  }
  console.log();
}
