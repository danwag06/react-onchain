/**
 * Input & Validation Functions
 * Handles user prompts and validation for deployment
 */

import { existsSync } from 'fs';
import { resolve } from 'path';
import chalk from 'chalk';
import { input, password, confirm } from '@inquirer/prompts';
import { promptForBuildDir, promptForVersion } from '../../utils.js';

/**
 * CLI argument detection result
 */
export interface CliArguments {
  wasPaymentKeyProvided: boolean;
  wasVersionTagProvided: boolean;
  wasBuildDirProvided: boolean;
  hasAnyExplicitFlags: boolean;
}

/**
 * Detect which CLI arguments were explicitly provided
 */
export function detectCliArguments(): CliArguments {
  const cliArgs = process.argv.join(' ');
  const wasPaymentKeyProvided = cliArgs.includes('--payment-key') || cliArgs.includes('-p');
  const wasVersionTagProvided = cliArgs.includes('--version-tag');
  const wasBuildDirProvided = cliArgs.includes('--build-dir') || cliArgs.includes('-b');

  return {
    wasPaymentKeyProvided,
    wasVersionTagProvided,
    wasBuildDirProvided,
    hasAnyExplicitFlags: wasPaymentKeyProvided || wasVersionTagProvided || wasBuildDirProvided,
  };
}

/**
 * Prompt user to confirm they've built their project
 */
export async function promptBuildReminder(): Promise<void> {
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
      console.log(chalk.yellow('\n✋ Please build your project first, then run deploy again.\n'));
      process.exit(0);
    }

    console.log();
  } catch {
    console.log(chalk.yellow('\n✋ Deployment cancelled.\n'));
    process.exit(0);
  }
}

/**
 * Prompt for payment key with validation
 */
export async function promptPaymentKey(dryRun: boolean): Promise<string> {
  if (dryRun) {
    // In dry-run mode, use dummy value
    return 'L1aB2cD3eF4gH5iJ6kL7mN8oP9qR0sT1uV2wX3yZ4a5b6c7d8e9f0';
  }

  try {
    return await password({
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
  } catch {
    console.error(chalk.red('\nPayment key input cancelled.'));
    process.exit(1);
  }
}

/**
 * Prompt for app name (first deployment only)
 */
export async function promptAppName(
  dryRun: boolean,
  isSubsequentDeployment: boolean
): Promise<string> {
  if (isSubsequentDeployment) {
    // Load app name from manifest for subsequent deployments
    return 'ReactApp'; // Default fallback
  }

  if (dryRun) {
    return 'DryRunApp';
  }

  try {
    return await input({
      message: 'App name (for versioning):',
      default: 'ReactApp',
    });
  } catch {
    console.error(chalk.red('\nApp name input cancelled.'));
    process.exit(1);
  }
}

/**
 * Prompt for version description
 */
export async function promptVersionDescription(
  isFirstDeployment: boolean,
  dryRun: boolean
): Promise<string> {
  if (dryRun) {
    return 'Dry run deployment';
  }

  try {
    return await input({
      message: 'Version description:',
      default: isFirstDeployment ? 'Initial release' : undefined,
    });
  } catch {
    console.error(chalk.red('\nVersion description input cancelled.'));
    process.exit(1);
  }
}

/**
 * Prompt for final deployment confirmation
 */
export async function promptDeploymentConfirmation(): Promise<void> {
  console.log(chalk.yellow('⚠️  This will inscribe files to the blockchain and spend satoshis.'));
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
  } catch {
    console.log(chalk.yellow('\n✋ Deployment cancelled.\n'));
    process.exit(0);
  }
}

/**
 * Validate build directory exists and contains index.html
 */
export function validateBuildDirectory(buildDir: string): void {
  const resolvedDir = resolve(buildDir);

  if (!existsSync(resolvedDir)) {
    console.error(chalk.red(`Error: Build directory not found: ${resolvedDir}`));
    process.exit(1);
  }

  // Check for index.html
  const indexPath = resolve(resolvedDir, 'index.html');
  if (!existsSync(indexPath)) {
    console.error(chalk.red(`Error: index.html not found in build directory: ${resolvedDir}`));
    process.exit(1);
  }
}

/**
 * Exported re-exports from cli/utils for convenience
 */
export { promptForBuildDir, promptForVersion };
