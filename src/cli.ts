#!/usr/bin/env node

import { Command } from 'commander';
import { existsSync } from 'fs';
import { resolve } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { deployToChain, generateManifest, saveManifestWithHistory } from './orchestrator.js';
import {
  getContractInfo,
  getVersionHistory,
  getVersionDetails,
} from './versioningContractHandler.js';
import { config as envConfig } from './config.js';
import type { DeploymentConfig, InscribedFile, DeploymentManifestHistory } from './types.js';
import { readFile } from 'fs/promises';

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
  console.log(chalk.bold.white('📄 Inscribed Files'));
  console.log(chalk.gray('─'.repeat(70)));

  // File rows
  inscriptions.forEach((file, index) => {
    const fileName =
      file.originalPath.length > 35 ? '...' + file.originalPath.slice(-32) : file.originalPath;

    const number = chalk.gray(`${String(index + 1).padStart(2)}. `);
    const name = chalk.white(fileName.padEnd(35));
    const size = chalk.yellow(formatBytes(file.size).padEnd(10));
    const txid = chalk.gray(file.txid.slice(0, 8) + '...');

    console.log(`  ${number}${name} ${size} ${txid}`);
  });

  console.log(chalk.gray('─'.repeat(70)));
  console.log(
    chalk.gray('  TOTAL'.padEnd(39)) +
      chalk.bold.green(formatBytes(totalSize).padEnd(11)) +
      chalk.gray(`${inscriptions.length} file${inscriptions.length !== 1 ? 's' : ''}`)
  );
  console.log(chalk.gray('─'.repeat(70)));
  console.log();
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

      // Beautiful header
      console.log();
      console.log(
        chalk.cyan('╔═══════════════════════════════════════════════════════════════════╗')
      );
      console.log(
        chalk.cyan('║') +
          chalk.bold.white('             🚀 React OnChain Deployment              ').padEnd(67) +
          chalk.cyan('║')
      );
      console.log(
        chalk.cyan('║') +
          chalk.gray('          Deploy your React app to the BSV blockchain        ').padEnd(67) +
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
      console.log(chalk.gray('  Destination:     ') + chalk.cyan(options.destination));
      console.log(chalk.gray('  Fee rate:        ') + chalk.cyan(`${options.satsPerKb} sats/KB`));

      // Display versioning info if enabled
      if (options.versionTag) {
        console.log(chalk.gray('  Version:         ') + chalk.magenta(options.versionTag));
        if (options.versionDescription) {
          console.log(chalk.gray('  Description:     ') + chalk.white(options.versionDescription));
        }
        if (options.versioningContract) {
          console.log(chalk.gray('  Contract:        ') + chalk.yellow(options.versioningContract));
        } else if (options.appName) {
          console.log(
            chalk.gray('  App name:        ') +
              chalk.green(options.appName) +
              chalk.gray(' (new contract)')
          );
        }
      }
      console.log(chalk.gray('─'.repeat(70)));
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
          const shortUrl = url.split('/').pop() || url;
          spinner.stopAndPersist({
            symbol: chalk.green('✓'),
            text: chalk.white(file.padEnd(35)) + chalk.gray(' → ') + chalk.cyan(shortUrl),
          });
          spinner.start('');
        },
        onVersioningContractStart: () => {
          spinner.stop();
          console.log(chalk.gray('─'.repeat(70)));
          console.log();
          spinner = ora({
            text: chalk.magenta('Deploying versioning contract...'),
            color: 'magenta',
          }).start();
        },
        onVersioningContractComplete: () => {
          spinner.succeed(chalk.green('Versioning contract deployed'));
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
          chalk.bold
            .white('              ✨ Deployment Complete! ✨                  ')
            .padEnd(67) +
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

      // Entry point section
      console.log(chalk.bold.white('🌐 Entry Point'));
      console.log(chalk.gray('─'.repeat(70)));
      console.log(chalk.cyan.bold(`  ${result.entryPointUrl}`));
      console.log(chalk.gray('─'.repeat(70)));
      console.log();

      // Stats section
      console.log(chalk.bold.white('📊 Deployment Stats'));
      console.log(chalk.gray('─'.repeat(70)));
      console.log(chalk.gray('  Total files:      ') + chalk.white(result.inscriptions.length));
      console.log(chalk.gray('  Total size:       ') + chalk.white(formatBytes(result.totalSize)));
      console.log(
        chalk.gray('  Total cost:       ') + chalk.white(`~${result.totalCost} satoshis`)
      );
      console.log(chalk.gray('  Transactions:     ') + chalk.white(result.txids.length));
      console.log(chalk.gray('─'.repeat(70)));
      console.log();

      // Display versioning information if available
      if (result.versioningContract) {
        console.log(chalk.bold.magenta('📦 Versioning'));
        console.log(chalk.gray('─'.repeat(70)));
        console.log(chalk.gray('  Contract:         ') + chalk.yellow(result.versioningContract));
        if (result.version) {
          console.log(chalk.gray('  Version:          ') + chalk.magenta(result.version));
        }

        // Check if this is a first deployment (no --versioning-contract provided)
        const isFirstDeployment = !options.versioningContract;

        if (isFirstDeployment) {
          // First deployment - no version redirect script injected
          console.log(
            chalk.gray('  Version redirect: ') +
              chalk.yellow('Not available yet (first deployment)')
          );
          console.log(
            chalk.gray('                    ') + chalk.gray('Will be enabled on next deployment')
          );
          console.log();
          console.log(chalk.gray('  💡 To deploy next version with redirect support:'));
          console.log(chalk.cyan(`     npx react-onchain deploy \\`));
          console.log(chalk.cyan(`       --build-dir ./dist \\`));
          console.log(chalk.cyan(`       --payment-key <YOUR_WIF_KEY> \\`));
          console.log(chalk.cyan(`       --destination <YOUR_ORD_ADDRESS> \\`));
          console.log(chalk.cyan(`       --version-tag "2.0.0" \\`));
          console.log(chalk.cyan(`       --version-description "Added new features" \\`));
          console.log(chalk.cyan(`       --versioning-contract "${result.versioningContract}"`));
        } else {
          // Subsequent deployment - version redirect script was injected
          console.log(chalk.gray('  Version redirect: ') + chalk.green('✓ Enabled'));
          console.log(
            chalk.gray('  Version access:   ') +
              chalk.cyan(`${result.entryPointUrl}?version=<VERSION>`)
          );
        }

        console.log(chalk.gray('─'.repeat(70)));
        console.log();

        // Show available query commands
        console.log(chalk.bold.white('📋 Available Queries'));
        console.log(chalk.gray('─'.repeat(70)));
        console.log(
          chalk.gray('  • Version history:   ') +
            chalk.cyan(`npx react-onchain version:history ${result.versioningContract}`)
        );
        console.log(
          chalk.gray('  • Version details:   ') +
            chalk.cyan(`npx react-onchain version:info ${result.versioningContract} <VERSION>`)
        );
        console.log(
          chalk.gray('  • Contract info:     ') +
            chalk.cyan(`npx react-onchain contract:info ${result.versioningContract}`)
        );
        console.log(chalk.gray('─'.repeat(70)));
        console.log();
      }

      // Save manifest with history
      const manifest = generateManifest(result);
      const manifestPath = options.dryRun
        ? options.manifest.replace('.json', '-dry-run.json')
        : options.manifest;
      const history = await saveManifestWithHistory(manifest, manifestPath);

      // Show deployment count
      const deploymentNum = history.totalDeployments;
      if (deploymentNum === 1) {
        console.log(chalk.gray(`📄 Manifest saved to: ${manifestPath}`));
      } else {
        console.log(
          chalk.gray(`📄 Manifest saved to: ${manifestPath} `) +
            chalk.cyan(`(Deployment #${deploymentNum})`)
        );
      }
      console.log();

      if (options.dryRun) {
        console.log(
          chalk.yellow('╭─────────────────────────────────────────────────────────────────────╮')
        );
        console.log(
          chalk.yellow('│') +
            chalk.yellow
              .bold('  This was a dry run. To deploy for real, remove --dry-run flag.  ')
              .padEnd(68) +
            chalk.yellow('│')
        );
        console.log(
          chalk.yellow('╰─────────────────────────────────────────────────────────────────────╯')
        );
        console.log();
      } else {
        console.log(
          chalk.green('╭─────────────────────────────────────────────────────────────────────╮')
        );
        console.log(
          chalk.green('│') +
            chalk.bold
              .white('         🎉 Your app is now live on the blockchain! 🎉          ')
              .padEnd(68) +
            chalk.green('│')
        );
        console.log(chalk.green('│') + ''.padEnd(69) + chalk.green('│'));
        console.log(
          chalk.green('│') +
            chalk
              .gray('  ⏱️  Note: It may take ~10 minutes for full confirmation           ')
              .padEnd(68) +
            chalk.green('│')
        );
        console.log(
          chalk.green('╰─────────────────────────────────────────────────────────────────────╯')
        );
        console.log();
        console.log(chalk.bold.cyan('  🔗 Visit: ') + chalk.cyan.underline(result.entryPointUrl));
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
          ` ${history.length > 0 ? chalk.cyan(history[0].version) : chalk.gray('(none)')}`
      );
      console.log(chalk.gray('─'.repeat(70)));
      console.log();
    } catch (error) {
      console.error(chalk.red('\n❌ Failed to get contract info:\n'));
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

      if (history.versioningContract) {
        console.log(chalk.gray(`Versioning contract: ${history.versioningContract}`));
      }
      console.log();
    } catch (error) {
      console.error(chalk.red('\n❌ Failed to read manifest history:\n'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

program.parse();
