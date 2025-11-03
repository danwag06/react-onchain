/**
 * Progress Logger - Clean, dynamic CLI progress display
 *
 * Features:
 * - Dynamic status lines that replace themselves
 * - Single progress bar that updates in place
 * - ANSI escape codes for cursor control
 * - Tracks total operations for accurate progress
 */

import chalk from 'chalk';

interface ProgressState {
  totalSteps: number;
  completedSteps: number;
  currentOperation: string;
  statusLines: string[];
  isActive: boolean;
}

const PROGRESS_BAR_WIDTH = 20;

export class ProgressLogger {
  private state: ProgressState;
  private dynamicLineCount: number = 0;

  constructor() {
    this.state = {
      totalSteps: 0,
      completedSteps: 0,
      currentOperation: '',
      statusLines: [],
      isActive: false,
    };
  }

  /**
   * Initialize progress tracking
   */
  start(totalSteps: number): void {
    this.state = {
      totalSteps,
      completedSteps: 0,
      currentOperation: '',
      statusLines: [],
      isActive: true,
    };
    this.dynamicLineCount = 0;
  }

  /**
   * Update current operation and optionally increment progress
   */
  update(operation: string, incrementStep: boolean = false): void {
    if (!this.state.isActive) return;

    if (incrementStep) {
      this.state.completedSteps++;
    }

    this.state.currentOperation = operation;
    this.render();
  }

  /**
   * Set a status line that appears above the progress bar (replaces previous)
   */
  setStatus(status: string): void {
    if (!this.state.isActive) return;

    // Replace all status lines with just this one
    this.state.statusLines = [status];
    this.render();
  }

  /**
   * Add a status line that appears above the progress bar
   */
  addStatus(status: string): void {
    if (!this.state.isActive) return;

    // Keep only last 2 status lines to avoid clutter
    this.state.statusLines.push(status);
    if (this.state.statusLines.length > 2) {
      this.state.statusLines.shift();
    }

    this.render();
  }

  /**
   * Complete a step and update display
   */
  completeStep(operation: string): void {
    this.update(operation, true);
  }

  /**
   * Finish progress tracking and clear dynamic display
   */
  finish(): void {
    if (!this.state.isActive) return;

    this.state.isActive = false;
    this.clearDynamic();
  }

  /**
   * Clear dynamic content (status lines + progress bar)
   */
  private clearDynamic(): void {
    if (this.dynamicLineCount === 0) return;

    // Move cursor up and clear each line
    for (let i = 0; i < this.dynamicLineCount; i++) {
      process.stdout.write('\x1b[1A'); // Move up
      process.stdout.write('\x1b[2K'); // Clear line
    }

    this.dynamicLineCount = 0;
  }

  /**
   * Render dynamic status + progress bar
   */
  private render(): void {
    // Clear previous render
    this.clearDynamic();

    const lines: string[] = [];

    // Add status lines
    for (const status of this.state.statusLines) {
      lines.push(chalk.gray(status));
    }

    // Add progress bar
    const percent = Math.min(
      100,
      Math.round((this.state.completedSteps / this.state.totalSteps) * 100)
    );
    const filled = Math.floor((percent / 100) * PROGRESS_BAR_WIDTH);
    const empty = PROGRESS_BAR_WIDTH - filled;

    const progressBar = chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));

    const progressLine =
      chalk.gray('[') +
      progressBar +
      chalk.gray(']') +
      chalk.yellow(` ${percent}%`) +
      chalk.gray(` ${this.state.currentOperation}`);

    lines.push(progressLine);

    // Write all lines
    for (const line of lines) {
      process.stdout.write(line + '\n');
    }

    this.dynamicLineCount = lines.length;
  }

  /**
   * Get current progress percentage
   */
  getProgress(): number {
    return Math.round((this.state.completedSteps / this.state.totalSteps) * 100);
  }
}

// Singleton instance
export const progressLogger = new ProgressLogger();
