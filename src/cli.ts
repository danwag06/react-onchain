#!/usr/bin/env node

import { Command } from 'commander';
import { existsSync } from 'fs';
import { resolve } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { deployToChain, generateManifest, saveManifest } from './orchestrator.js';
import type { DeploymentConfig, InscribedFile } from './types.js';

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
 * Display file size summary table
 */
function displaySummary(inscriptions: InscribedFile[], totalSize: number): void {
  console.log(chalk.bold('\n📊 Deployment Summary:\n'));

  // Table header
  console.log(chalk.gray('─'.repeat(70)));
  console.log(
    chalk.gray('File'.padEnd(40)) +
    chalk.gray('Size'.padEnd(15)) +
    chalk.gray('TXID')
  );
  console.log(chalk.gray('─'.repeat(70)));

  // File rows
  inscriptions.forEach((file) => {
    const fileName = file.originalPath.length > 38
      ? '...' + file.originalPath.slice(-35)
      : file.originalPath;

    console.log(
      chalk.cyan(fileName.padEnd(40)) +
      chalk.yellow(formatBytes(file.size).padEnd(15)) +
      chalk.gray(file.txid.slice(0, 12) + '...')
    );
  });

  console.log(chalk.gray('─'.repeat(70)));
  console.log(
    chalk.bold('TOTAL'.padEnd(40)) +
    chalk.bold.green(formatBytes(totalSize).padEnd(15)) +
    chalk.bold.gray(`${inscriptions.length} file${inscriptions.length !== 1 ? 's' : ''}`)
  );
  console.log(chalk.gray('─'.repeat(70)) + '\n');
}

program
  .name('react-onchain')
  .description('Deploy React applications to BSV blockchain using 1Sat Ordinals')
  .version('1.0.0');

program
  .command('deploy')
  .description('Deploy a React build directory to the blockchain')
  .option('-b, --build-dir <directory>', 'Build directory to deploy', './dist')
  .option('-p, --payment-key <wif>', 'Payment private key (WIF format)')
  .option('-d, --destination <address>', 'Destination address for inscriptions')
  .option('-c, --change <address>', 'Change address (optional)')
  .option('-s, --sats-per-kb <number>', 'Satoshis per KB for fees', '1')
  .option('-m, --manifest <file>', 'Output manifest file', 'deployment-manifest.json')
  .option('--dry-run', 'Simulate deployment without broadcasting transactions')
  .action(async (options) => {
    try {
      // Validate required options (unless dry-run)
      if (!options.dryRun) {
        if (!options.paymentKey) {
          console.error(chalk.red('Error: --payment-key is required (or use --dry-run)'));
          process.exit(1);
        }

        if (!options.destination) {
          console.error(chalk.red('Error: --destination is required (or use --dry-run)'));
          process.exit(1);
        }
      } else {
        // In dry-run mode, use dummy values if not provided
        if (!options.paymentKey) {
          options.paymentKey = 'L1aB2cD3eF4gH5iJ6kL7mN8oP9qR0sT1uV2wX3yZ4a5b6c7d8e9f0';
        }
        if (!options.destination) {
          options.destination = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
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
        console.error(
          chalk.red(`Error: index.html not found in build directory: ${buildDir}`)
        );
        process.exit(1);
      }

      console.log(chalk.bold('\n🚀 React OnChain Deployment\n'));

      if (options.dryRun) {
        console.log(chalk.yellow.bold('⚠️  DRY RUN MODE - No transactions will be broadcast\n'));
      }

      console.log(chalk.gray(`Build directory: ${buildDir}`));
      console.log(chalk.gray(`Destination: ${options.destination}`));
      console.log(chalk.gray(`Fee rate: ${options.satsPerKb} sats/KB\n`));

      const config: DeploymentConfig = {
        buildDir,
        paymentKey: options.paymentKey,
        destinationAddress: options.destination,
        changeAddress: options.change,
        satsPerKb: parseInt(options.satsPerKb, 10),
        dryRun: options.dryRun,
      };

      let spinner = ora('Analyzing build directory...').start();
      let fileCount = 0;
      let currentFile = '';

      const result = await deployToChain(config, {
        onAnalysisStart: () => {
          spinner.text = 'Analyzing build directory...';
        },
        onAnalysisComplete: (count) => {
          fileCount = count;
          spinner.succeed(chalk.green(`Found ${count} files to inscribe`));
          spinner = ora('Inscribing files...').start();
        },
        onInscriptionStart: (file, current, total) => {
          currentFile = file;
          spinner.text = `Inscribing ${chalk.cyan(file)} (${current}/${total})`;
        },
        onInscriptionComplete: (file, url) => {
          spinner.succeed(
            chalk.green(`✓ ${file}`) + chalk.gray(` → ${url}`)
          );
          spinner = ora('Inscribing files...').start();
        },
        onDeploymentComplete: (entryPointUrl) => {
          spinner.stop();
        },
      });

      console.log(chalk.bold('\n✨ Deployment Complete!\n'));

      if (options.dryRun) {
        console.log(chalk.yellow.bold('⚠️  DRY RUN - Mock transaction IDs shown below:\n'));
      }

      // Display file size summary
      displaySummary(result.inscriptions, result.totalSize);

      console.log(chalk.green(`Entry Point: ${chalk.bold(result.entryPointUrl)}\n`));
      console.log(chalk.gray(`Total files: ${result.inscriptions.length}`));
      console.log(chalk.gray(`Total size: ${formatBytes(result.totalSize)}`));
      console.log(chalk.gray(`Total cost: ~${result.totalCost} satoshis`));
      console.log(chalk.gray(`Transactions: ${result.txids.length}\n`));

      // Save manifest
      const manifest = generateManifest(result);
      const manifestPath = options.dryRun
        ? options.manifest.replace('.json', '-dry-run.json')
        : options.manifest;
      await saveManifest(manifest, manifestPath);
      console.log(chalk.gray(`Manifest saved to: ${manifestPath}\n`));

      if (options.dryRun) {
        console.log(chalk.yellow.bold('📋 This was a dry run. To deploy for real, remove --dry-run flag.\n'));
      } else {
        console.log(chalk.bold('🌐 Your app is now live on the blockchain!'));
        console.log(chalk.cyan(`\nVisit: ${result.entryPointUrl}\n`));
      }

    } catch (error) {
      console.error(chalk.red('\n❌ Deployment failed:\n'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

program.parse();
