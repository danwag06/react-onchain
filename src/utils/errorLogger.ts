/**
 * Error Logger - Write detailed error logs to files for debugging
 */

import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { formatError } from './errors.js';

const LOGS_DIR = '.react-onchain/logs';

/**
 * Ensure logs directory exists
 */
async function ensureLogsDir(): Promise<string> {
  if (!existsSync(LOGS_DIR)) {
    await mkdir(LOGS_DIR, { recursive: true });
  }
  return LOGS_DIR;
}

/**
 * Generate timestamp for log filename
 */
function getTimestamp(): string {
  const now = new Date();
  return now.toISOString().replace(/[:.]/g, '-').slice(0, -5); // 2025-11-02T19-30-45
}

/**
 * Write detailed error log to file
 *
 * @param error - The error that occurred
 * @param context - Additional context about what was happening
 * @returns Path to the log file
 */
export async function logError(
  error: any,
  context: {
    operation?: string;
    txData?: any;
    utxoStates?: any;
    networkResponse?: any;
    additionalInfo?: any;
  } = {}
): Promise<string> {
  const logsDir = await ensureLogsDir();
  const timestamp = getTimestamp();
  const logFile = join(logsDir, `deployment-error-${timestamp}.log`);

  const logContent = [
    '='.repeat(70),
    `DEPLOYMENT ERROR LOG`,
    `Timestamp: ${new Date().toISOString()}`,
    '='.repeat(70),
    '',
    '## Error Details',
    '-'.repeat(70),
    `Message: ${formatError(error)}`,
    '',
    error.stack ? `Stack Trace:\n${error.stack}` : 'No stack trace available',
    '',
  ];

  if (context.operation) {
    logContent.push('## Operation Context', '-'.repeat(70), context.operation, '');
  }

  if (context.txData) {
    logContent.push(
      '## Transaction Data',
      '-'.repeat(70),
      JSON.stringify(context.txData, null, 2),
      ''
    );
  }

  if (context.utxoStates) {
    logContent.push(
      '## UTXO States',
      '-'.repeat(70),
      JSON.stringify(context.utxoStates, null, 2),
      ''
    );
  }

  if (context.networkResponse) {
    logContent.push(
      '## Network Response',
      '-'.repeat(70),
      JSON.stringify(context.networkResponse, null, 2),
      ''
    );
  }

  if (context.additionalInfo) {
    logContent.push(
      '## Additional Information',
      '-'.repeat(70),
      JSON.stringify(context.additionalInfo, null, 2),
      ''
    );
  }

  logContent.push('='.repeat(70), `End of error log`, '='.repeat(70));

  await writeFile(logFile, logContent.join('\n'), 'utf-8');

  return logFile;
}

/**
 * Clean old log files (keep last 10)
 */
export async function cleanOldLogs(): Promise<void> {
  // TODO: Implement log file cleanup
  // This is optional and can be added later
}
