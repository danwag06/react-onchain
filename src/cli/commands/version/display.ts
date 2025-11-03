/**
 * Display Functions
 * Handles UI output for version commands
 */

import chalk from 'chalk';
import { CLI_CONSTANTS } from '../../utils.js';

/**
 * Version history entry
 */
interface VersionHistoryEntry {
  version: string;
  description: string;
}

/**
 * Version info structure
 */
interface VersionInfo {
  appName: string;
  outpoint: string;
  originOutpoint: string;
}

/**
 * Display version history table
 */
export function displayVersionHistory(
  history: VersionHistoryEntry[],
  inscriptionOrigin: string,
  showingCount: number,
  totalCount: number,
  info: VersionInfo
): void {
  console.log(chalk.bold('\n📚 Version History\n'));
  console.log(chalk.gray(`Inscription: ${inscriptionOrigin}\n`));

  console.log(chalk.gray('─'.repeat(CLI_CONSTANTS.DIVIDER_LENGTH)));
  console.log(
    chalk.gray('Version'.padEnd(15)) + chalk.gray('Description'.padEnd(40)) + chalk.gray('Status')
  );
  console.log(chalk.gray('─'.repeat(CLI_CONSTANTS.DIVIDER_LENGTH)));

  for (let i = 0; i < history.length; i++) {
    const { version, description } = history[i];
    const isLatest = i === 0;
    const status = isLatest ? chalk.green('(latest)') : '';
    const truncatedDesc =
      description.length > 37 ? description.substring(0, 34) + '...' : description;
    console.log(chalk.cyan(version.padEnd(15)) + chalk.white(truncatedDesc.padEnd(40)) + status);
  }

  console.log(chalk.gray('─'.repeat(CLI_CONSTANTS.DIVIDER_LENGTH)));

  if (showingCount < totalCount) {
    console.log(
      chalk.gray(
        `\nShowing ${showingCount} of ${totalCount} versions. Use --all to see all or --limit <n> to adjust.`
      )
    );
  }

  console.log(chalk.gray(`\nApp: ${info.appName}`));
  console.log(chalk.gray(`Origin: ${info.originOutpoint}\n`));
}

/**
 * Display sync warning
 */
export function displaySyncWarning(manifestLatest: string, onChainLatest: string): void {
  console.log(
    chalk.yellow(
      '\n⚠️  Warning: On-chain versioning data is still syncing. Latest on-chain version differs from manifest.'
    )
  );
  console.log(
    chalk.gray(`   Manifest latest: ${manifestLatest} | On-chain latest: ${onChainLatest}`)
  );
  console.log(chalk.gray('   Check back in a few moments for updated data.\n'));
}

/**
 * Display version details
 */
export function displayVersionDetails(details: {
  version: string;
  outpoint: string;
  description: string;
  contentUrl: string;
}): void {
  console.log(chalk.bold('\n📦 Version Details\n'));
  console.log(chalk.gray('─'.repeat(CLI_CONSTANTS.DIVIDER_LENGTH)));
  console.log(chalk.bold('Version:     ') + chalk.cyan(details.version));
  console.log(chalk.bold('Outpoint:    ') + chalk.gray(details.outpoint));
  console.log(
    chalk.bold('URL:         ') + chalk.cyan(`${details.contentUrl}/content/${details.outpoint}`)
  );
  console.log(chalk.bold('Description: ') + details.description);
  console.log(chalk.gray('─'.repeat(CLI_CONSTANTS.DIVIDER_LENGTH)));
  console.log();
}

/**
 * Display inscription summary
 */
export function displayInscriptionSummary(
  info: VersionInfo,
  historyLength: number,
  latestVersion: string | null
): void {
  console.log(chalk.bold('\n📋 Inscription Information\n'));
  console.log(chalk.gray('─'.repeat(CLI_CONSTANTS.DIVIDER_LENGTH)));
  console.log(chalk.bold('Inscription:   ') + chalk.cyan(info.outpoint));
  console.log(chalk.bold('App Name:      ') + info.appName);
  console.log(chalk.bold('Origin:        ') + chalk.gray(info.originOutpoint));
  console.log(chalk.bold('Total Versions:') + ` ${historyLength}`);
  console.log(
    chalk.bold('Latest Version:') +
      ` ${latestVersion ? chalk.cyan(latestVersion) : chalk.gray('(none)')}`
  );
  console.log(chalk.gray('─'.repeat(CLI_CONSTANTS.DIVIDER_LENGTH)));
  console.log();
}
