/**
 * Deploy Command
 * Handles deployment of React applications to the BSV blockchain
 */

import { resolve } from 'path';
import chalk from 'chalk';
import type { Command } from 'commander';
import {
  deployToChain,
  generateManifest,
  saveManifestWithHistory,
} from '../../../core/orchestration/index.js';
import type { DeploymentConfig } from '../../../core/orchestration/index.js';
import { config as envConfig } from '../../../lib/config.js';
import { formatError } from '../../../utils/errors.js';
import { MANIFEST_FILENAME } from '../../../utils/constants.js';
import { readManifestData, saveDeploymentEnv, displaySummary } from '../../utils.js';
import { setDebugMode } from '../../../utils/logger.js';
import {
  detectCliArguments,
  promptBuildReminder,
  promptForBuildDir,
  promptPaymentKey,
  promptAppName,
  promptForVersion,
  promptVersionDescription,
  promptDeploymentConfirmation,
  validateBuildDirectory,
} from './input.js';
import {
  displayDeploymentHeader,
  displayConfiguration,
  displaySuccessBanner,
  displayDeploymentStats,
  displayVersioningInfo,
  displayAdditionalCommands,
  displayManifestSaved,
  displayFinalMessage,
} from './display.js';
import { DeploymentProgressHandler } from './progress.js';

/**
 * Register the deploy command with the CLI program
 */
export function registerDeployCommand(program: Command): void {
  program
    .command('deploy')
    .description('Deploy a React build directory to the blockchain')
    .option('-b, --build-dir <directory>', 'Build directory to deploy', envConfig.buildDir)
    .option('-p, --payment-key <wif>', 'Payment private key (WIF format)', envConfig.paymentKey)
    .option('-c, --change <address>', 'Change address (optional)', envConfig.changeAddress)
    .option('-s, --sats-per-kb <number>', 'Satoshis per KB for fees', String(envConfig.satsPerKb))
    .option('-m, --manifest <file>', 'Output manifest file', envConfig.manifestFile)
    .option('--dry-run', 'Simulate deployment without broadcasting transactions', envConfig.dryRun)
    .option('--debug', 'Enable debug logging for verbose output', false)
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
        // Set debug mode if flag is present
        if (options.debug) {
          setDebugMode(true);
        }

        // Phase 1: Detect CLI arguments & pre-flight checks
        const cliFlags = detectCliArguments();

        if (!options.dryRun && !cliFlags.hasAnyExplicitFlags) {
          await promptBuildReminder();
        }

        // Phase 2: Load manifest & resolve configuration
        const manifestPath = resolve(MANIFEST_FILENAME);
        const manifestData = await readManifestData(manifestPath);

        const previousConfig = {
          buildDir: manifestData.buildDir,
          versioningOriginInscription: manifestData.versioningOriginInscription,
        };

        const isSubsequentDeployment = !!previousConfig.versioningOriginInscription;

        // Build directory selection
        if (!cliFlags.wasBuildDirProvided) {
          try {
            options.buildDir = await promptForBuildDir(previousConfig.buildDir);
          } catch {
            console.error(chalk.red('\nBuild directory selection cancelled.'));
            process.exit(1);
          }
        }

        // Apply versioning origin from manifest
        if (!options.versioningOriginInscription && previousConfig.versioningOriginInscription) {
          options.versioningOriginInscription = previousConfig.versioningOriginInscription;
        }

        // Interactive prompts for missing values
        if (!options.paymentKey) {
          options.paymentKey = await promptPaymentKey(options.dryRun);
        }

        if (!options.appName) {
          options.appName = await promptAppName(
            options.dryRun,
            isSubsequentDeployment,
            options.buildDir
          );
        }

        if (!options.versionTag) {
          if (options.dryRun) {
            options.versionTag = '1.0.0-dryrun';
          } else {
            try {
              options.versionTag = await promptForVersion(
                !isSubsequentDeployment,
                options.manifest || MANIFEST_FILENAME
              );
            } catch {
              console.error(chalk.red('\nVersion input cancelled.'));
              process.exit(1);
            }
          }
        }

        if (!options.versionDescription) {
          options.versionDescription = await promptVersionDescription(
            !isSubsequentDeployment,
            options.dryRun
          );
        }

        // Phase 3: Validate build directory
        const buildDir = resolve(options.buildDir);
        validateBuildDirectory(buildDir);

        // Phase 4: Display header & configuration
        displayDeploymentHeader(options.dryRun);
        displayConfiguration({
          buildDir,
          satsPerKb: parseInt(options.satsPerKb, 10),
          versionTag: options.versionTag!,
          versionDescription: options.versionDescription!,
        });

        // Phase 5: Confirmation prompt
        const hasProvidedFlags =
          cliFlags.wasBuildDirProvided ||
          cliFlags.wasPaymentKeyProvided ||
          cliFlags.wasVersionTagProvided;

        if (!options.dryRun && !hasProvidedFlags) {
          await promptDeploymentConfirmation();
        }

        // Phase 6: Build deployment config
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

        // Phase 7: Execute deployment with progress tracking
        const contentUrlForDisplay = config.ordinalContentUrl || envConfig.ordinalContentUrl;
        const progressHandler = new DeploymentProgressHandler(contentUrlForDisplay);

        const result = await deployToChain(config, progressHandler.getCallbacks());

        // Phase 8: Display results
        displaySuccessBanner(!!config.dryRun);
        displaySummary(result.inscriptions, result.totalSize);
        displayDeploymentStats(result);

        const isFirstDeployment = !options.versioningOriginInscription;
        displayVersioningInfo(result, isFirstDeployment);
        displayAdditionalCommands();

        // Phase 9: Save artifacts
        const manifest = generateManifest(result);
        const outputManifestPath = options.dryRun
          ? options.manifest.replace('.json', '-dry-run.json')
          : options.manifest;
        const history = await saveManifestWithHistory(
          manifest,
          outputManifestPath,
          result.versioningOriginInscription,
          result.htmlOriginInscription
        );

        if (!options.dryRun) {
          await saveDeploymentEnv({
            paymentKey: options.paymentKey!,
            buildDir: buildDir,
            appName: options.appName!,
            versioningOriginInscription: result.versioningOriginInscription,
            htmlOriginInscription: result.htmlOriginInscription,
            ordinalContentUrl: result.ordinalContentUrl || envConfig.ordinalContentUrl,
            satsPerKb: parseInt(options.satsPerKb || '1', 10),
          });
        }

        // Phase 10: Display save confirmations & final messages
        displayManifestSaved(manifestPath, history.totalDeployments, !!options.dryRun);
        displayFinalMessage(result, !!options.dryRun);
      } catch (error) {
        console.error(chalk.red('\n❌ Deployment failed:\n'));
        console.error(chalk.red(formatError(error)));
        process.exit(1);
      }
    });
}
