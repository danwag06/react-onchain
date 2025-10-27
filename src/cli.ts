#!/usr/bin/env node

import { Command } from 'commander';
import { existsSync } from 'fs';
import { resolve } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { deployToChain, generateManifest, saveManifest } from './orchestrator.js';
import {
  getContractInfo,
  getVersionHistory,
  getVersionDetails,
} from './versioningContractHandler.js';
import { config as envConfig } from './config.js';
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
  console.log(chalk.gray('File'.padEnd(40)) + chalk.gray('Size'.padEnd(15)) + chalk.gray('TXID'));
  console.log(chalk.gray('─'.repeat(70)));

  // File rows
  inscriptions.forEach((file) => {
    const fileName =
      file.originalPath.length > 38 ? '...' + file.originalPath.slice(-35) : file.originalPath;

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
  .option('-b, --build-dir <directory>', 'Build directory to deploy', envConfig.buildDir)
  .option('-p, --payment-key <wif>', 'Payment private key (WIF format)', envConfig.paymentKey)
  .option(
    '-d, --destination <address>',
    'Destination address for inscriptions',
    envConfig.destinationAddress
  )
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
    '--enable-service-resolver',
    'Enable service resolver for runtime failover',
    envConfig.enableServiceResolver
  )
  .option('--disable-service-resolver', 'Disable service resolver')
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
    '--versioning-contract <outpoint>',
    'Existing versioning contract outpoint (txid_vout)',
    envConfig.versioningContract
  )
  .option('--app-name <string>', 'Application name for new versioning contract', envConfig.appName)
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
        console.error(chalk.red(`Error: index.html not found in build directory: ${buildDir}`));
        process.exit(1);
      }

      console.log(chalk.bold('\n🚀 React OnChain Deployment\n'));

      if (options.dryRun) {
        console.log(chalk.yellow.bold('⚠️  DRY RUN MODE - No transactions will be broadcast\n'));
      }

      console.log(chalk.gray(`Build directory: ${buildDir}`));
      console.log(chalk.gray(`Destination: ${options.destination}`));
      console.log(chalk.gray(`Fee rate: ${options.satsPerKb} sats/KB`));

      // Display versioning info if enabled
      if (options.versionTag) {
        console.log(chalk.gray(`Version: ${options.versionTag}`));
        if (options.versionDescription) {
          console.log(chalk.gray(`Description: ${options.versionDescription}`));
        }
        if (options.versioningContract) {
          console.log(chalk.gray(`Versioning contract: ${options.versioningContract}`));
        } else if (options.appName) {
          console.log(
            chalk.gray(`App name: ${options.appName} (new versioning contract will be created)`)
          );
        }
      }
      console.log();

      // Determine if service resolver should be enabled
      const enableServiceResolver = options.disableServiceResolver
        ? false
        : (options.enableServiceResolver ?? envConfig.enableServiceResolver);

      const config: DeploymentConfig = {
        buildDir,
        paymentKey: options.paymentKey,
        destinationAddress: options.destination,
        changeAddress: options.change,
        satsPerKb: parseInt(options.satsPerKb, 10),
        dryRun: options.dryRun,
        ordinalContentUrl: options.ordinalContentUrl,
        ordinalIndexerUrl: options.ordinalIndexerUrl,
        enableServiceResolver,
        enableVersioning: !!options.versionTag,
        version: options.versionTag,
        versionDescription: options.versionDescription,
        versioningContract: options.versioningContract,
        appName: options.appName,
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
          spinner.succeed(chalk.green(`✓ ${file}`) + chalk.gray(` → ${url}`));
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
      console.log(chalk.gray(`Transactions: ${result.txids.length}`));

      // Display versioning information if available
      if (result.versioningContract) {
        console.log();
        console.log(chalk.bold.cyan('📦 Versioning Information:'));
        console.log(chalk.gray(`Contract: ${result.versioningContract}`));
        if (result.version) {
          console.log(chalk.gray(`Version: ${result.version}`));
        }
        console.log(chalk.gray(`\nAccess versions via: ${result.entryPointUrl}?version=<VERSION>`));
      }
      console.log();

      // Save manifest
      const manifest = generateManifest(result);
      const manifestPath = options.dryRun
        ? options.manifest.replace('.json', '-dry-run.json')
        : options.manifest;
      await saveManifest(manifest, manifestPath);
      console.log(chalk.gray(`Manifest saved to: ${manifestPath}\n`));

      if (options.dryRun) {
        console.log(
          chalk.yellow.bold('📋 This was a dry run. To deploy for real, remove --dry-run flag.\n')
        );
      } else {
        console.log(chalk.bold('🌐 Your app is now live on the blockchain!'));
        console.log(
          chalk.gray(
            '⏱️  Note: It may take up to 1 confirmation (~10 minutes) for your app to be fully accessible.\n'
          )
        );
        console.log(chalk.cyan(`Visit: ${result.entryPointUrl}\n`));
      }
    } catch (error) {
      console.error(chalk.red('\n❌ Deployment failed:\n'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

// Version history command
program
  .command('version:history <contract>')
  .description('Show version history for a versioning contract')
  .action(async (contractOutpoint) => {
    try {
      console.log(chalk.bold('\n📚 Version History\n'));
      console.log(chalk.gray(`Contract: ${contractOutpoint}\n`));

      const spinner = ora('Loading version history...').start();

      const history = await getVersionHistory(contractOutpoint);
      const info = await getContractInfo(contractOutpoint);

      spinner.succeed(chalk.green(`Found ${history.length} version(s)`));

      console.log(chalk.gray('─'.repeat(70)));
      console.log(chalk.gray('Version'.padEnd(20)) + chalk.gray('Status'));
      console.log(chalk.gray('─'.repeat(70)));

      for (let i = 0; i < history.length; i++) {
        const version = history[i];
        const isLatest = i === 0;
        const status = isLatest ? chalk.green('(latest)') : '';
        console.log(chalk.cyan(version.padEnd(20)) + status);
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
  .command('version:info <contract> <version>')
  .description('Get detailed information about a specific version')
  .action(async (contractOutpoint, version) => {
    try {
      console.log(chalk.bold('\n📦 Version Details\n'));

      const spinner = ora(`Loading version ${version}...`).start();

      const details = await getVersionDetails(contractOutpoint, version);

      if (!details) {
        spinner.fail(chalk.red(`Version ${version} not found`));
        process.exit(1);
      }

      spinner.succeed(chalk.green(`Version ${version} found`));

      console.log(chalk.gray('─'.repeat(70)));
      console.log(chalk.bold('Version:     ') + chalk.cyan(details.version));
      console.log(chalk.bold('Outpoint:    ') + chalk.gray(details.outpoint));
      console.log(
        chalk.bold('URL:         ') +
          chalk.cyan(`https://ordfs.network/content/${details.outpoint}`)
      );
      console.log(chalk.bold('Description: ') + details.description);
      console.log(chalk.bold('Deployed:    ') + chalk.gray(details.timestamp));
      console.log(chalk.gray('─'.repeat(70)));
      console.log();
    } catch (error) {
      console.error(chalk.red('\n❌ Failed to get version info:\n'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

// Contract info command
program
  .command('contract:info <contract>')
  .description('Get information about a versioning contract')
  .action(async (contractOutpoint) => {
    try {
      console.log(chalk.bold('\n📋 Contract Information\n'));

      const spinner = ora('Loading contract info...').start();

      const info = await getContractInfo(contractOutpoint);
      const history = await getVersionHistory(contractOutpoint);

      spinner.succeed(chalk.green('Contract info loaded'));

      console.log(chalk.gray('─'.repeat(70)));
      console.log(chalk.bold('Contract:      ') + chalk.cyan(info.outpoint));
      console.log(chalk.bold('App Name:      ') + info.appName);
      console.log(chalk.bold('Origin:        ') + chalk.gray(info.originOutpoint));
      console.log(chalk.bold('Total Versions:') + ` ${history.length}`);
      console.log(
        chalk.bold('Latest Version:') +
          ` ${history.length > 0 ? chalk.cyan(history[0]) : chalk.gray('(none)')}`
      );
      console.log(chalk.gray('─'.repeat(70)));
      console.log();
    } catch (error) {
      console.error(chalk.red('\n❌ Failed to get contract info:\n'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

program.parse();
