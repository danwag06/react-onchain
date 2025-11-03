/**
 * Progress Tracking
 * Handles deployment progress callbacks and spinner state
 */

import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { CLI_CONSTANTS } from '../../utils.js';
import type { ChunkedFileInfo } from '../../../core/orchestration/index.js';

/**
 * Deployment progress handler with stateful spinner and counters
 */
export class DeploymentProgressHandler {
  private spinner: Ora;
  private totalFiles: number = 0;
  private completedFiles: number = 0;
  private contentUrlForDisplay: string;

  constructor(contentUrl: string) {
    this.contentUrlForDisplay = contentUrl;
    this.spinner = ora({ text: 'Analyzing build directory...', color: 'cyan' }).start();
  }

  /**
   * Update overall progress spinner
   */
  private updateProgressSpinner(): void {
    if (this.completedFiles < this.totalFiles) {
      this.spinner.start(chalk.gray(`${this.completedFiles}/${this.totalFiles} complete`));
    } else {
      this.spinner.start('');
    }
  }

  /**
   * Get callbacks object for deployToChain
   */
  public getCallbacks() {
    return {
      onAnalysisStart: this.onAnalysisStart.bind(this),
      onAnalysisComplete: this.onAnalysisComplete.bind(this),
      onCacheAnalysis: this.onCacheAnalysis.bind(this),
      onInscriptionStart: this.onInscriptionStart.bind(this),
      onInscriptionComplete: this.onInscriptionComplete.bind(this),
      onInscriptionSkipped: this.onInscriptionSkipped.bind(this),
      onDeploymentComplete: this.onDeploymentComplete.bind(this),
      onProgress: this.onProgress.bind(this),
    };
  }

  /**
   * Called when analysis starts
   */
  private onAnalysisStart(): void {
    this.spinner.text = '🔍 Analyzing build directory...';
  }

  /**
   * Called when analysis completes
   */
  private onAnalysisComplete(count: number): void {
    this.totalFiles = count;
    this.spinner.succeed(chalk.bold.green(`Found ${chalk.white(count)} source files`));
  }

  /**
   * Called with cache analysis results
   */
  private onCacheAnalysis(
    cachedCount: number,
    newCount: number,
    cachedFiles: string[],
    chunkedFilesInfo: ChunkedFileInfo[]
  ): void {
    // Show cache analysis with detailed chunk information
    if (cachedCount > 0) {
      // Show chunked files separately
      const chunkedFiles = chunkedFilesInfo.filter((f) => !f.isServiceWorker);
      const cachedSW = chunkedFilesInfo.find((f) => f.isServiceWorker);
      const regularCachedCount = cachedCount - chunkedFiles.length - (cachedSW ? 1 : 0);

      if (chunkedFiles.length > 0) {
        for (const chunkedFile of chunkedFiles) {
          console.log(
            chalk.gray('  ├─ ') +
              chalk.green(`${chunkedFile.chunkCount} cached chunks`) +
              chalk.gray(` (${chunkedFile.filename})`)
          );
        }
      }

      if (cachedSW) {
        console.log(
          chalk.gray('  ├─ ') + chalk.green(`1 cached`) + chalk.gray(' (chunk-reassembly-sw.js)')
        );
      }

      if (regularCachedCount > 0) {
        console.log(
          chalk.gray('  ├─ ') +
            chalk.green(`${regularCachedCount} cached`) +
            chalk.gray(' (will reuse from previous deployment)')
        );
      }

      console.log(
        chalk.gray('  └─ ') + chalk.yellow(`${newCount} new`) + chalk.gray(' (will be inscribed)')
      );
    } else {
      console.log(chalk.gray('  └─ ') + chalk.yellow(`${newCount} files will be inscribed`));
    }
    console.log();
    console.log(chalk.bold.white('⚡ Inscribing to BSV Blockchain'));
    console.log(chalk.gray('─'.repeat(CLI_CONSTANTS.DIVIDER_LENGTH)));
    this.spinner = ora({ text: 'Preparing inscription...', color: 'yellow' }).start();
  }

  /**
   * Called when inscription starts for a file
   */
  private onInscriptionStart(file: string, current: number, total: number): void {
    this.spinner.text =
      chalk.gray(`Inscribing `) + chalk.cyan(file) + chalk.gray(` (${current}/${total})`);
  }

  /**
   * Called when inscription completes for a file
   */
  private onInscriptionComplete(file: string, url: string): void {
    this.completedFiles++;
    const absoluteUrl = this.contentUrlForDisplay + url;
    const shortUrl = absoluteUrl.split('/').pop() || url;
    this.spinner.stopAndPersist({
      symbol: chalk.green('✓'),
      text:
        chalk.white(file.padEnd(CLI_CONSTANTS.FILENAME_MAX_LENGTH)) +
        chalk.gray(' → ') +
        chalk.cyan(shortUrl),
    });

    this.updateProgressSpinner();
  }

  /**
   * Called when inscription is skipped (cached)
   */
  private onInscriptionSkipped(file: string, url: string, chunkCount?: number): void {
    this.completedFiles++;
    const absoluteUrl = this.contentUrlForDisplay + url;
    const shortUrl = absoluteUrl.split('/').pop() || url;
    const cacheInfo = chunkCount
      ? chalk.gray(` (cached, ${chunkCount} chunks)`)
      : chalk.gray(' (cached)');
    this.spinner.stopAndPersist({
      symbol: chalk.blue('↻'),
      text:
        chalk.white(file.padEnd(CLI_CONSTANTS.FILENAME_MAX_LENGTH)) +
        chalk.gray(' → ') +
        chalk.cyan(shortUrl) +
        cacheInfo,
    });

    this.updateProgressSpinner();
  }

  /**
   * Called when deployment completes
   */
  private onDeploymentComplete(): void {
    this.spinner.stop();
    console.log(chalk.gray('─'.repeat(CLI_CONSTANTS.DIVIDER_LENGTH)));
  }

  /**
   * Called with progress messages
   */
  private onProgress(message: string): void {
    this.spinner.text = chalk.gray(message);
  }
}
