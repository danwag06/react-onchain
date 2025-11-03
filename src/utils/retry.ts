/**
 * Retry utility with exponential backoff
 */

import { formatError } from './errors.js';

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 5,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 *
 * @param fn - Async function to retry
 * @param options - Retry configuration
 * @param shouldRetry - Optional function to determine if error is retryable
 * @returns Result of the function
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
  shouldRetry?: (error: unknown, attempt: number) => boolean
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;
  let delay = opts.initialDelayMs;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry this error
      if (shouldRetry && !shouldRetry(error, attempt)) {
        throw error;
      }

      // Don't retry if this was the last attempt
      if (attempt === opts.maxAttempts) {
        break;
      }

      // Log retry attempt
      const errorMsg = formatError(error);
      console.log(`⚠️  Attempt ${attempt} failed: ${errorMsg}`);
      console.log(`   Retrying in ${delay}ms... (${attempt}/${opts.maxAttempts})`);

      // Wait before retrying
      await sleep(delay);

      // Increase delay for next attempt (exponential backoff)
      delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelayMs);
    }
  }

  // All attempts failed
  throw lastError;
}

/**
 * Check if an error is related to UTXO not being found
 */
export function isUtxoNotFoundError(error: unknown): boolean {
  const errorMsg = formatError(error);
  const lowerMsg = errorMsg.toLowerCase();

  return (
    lowerMsg.includes('not-found') ||
    lowerMsg.includes('not found') ||
    lowerMsg.includes('utxo') ||
    lowerMsg.includes('missing inputs') ||
    lowerMsg.includes('could not find')
  );
}

/**
 * Determine if an error should trigger a retry
 */
export function shouldRetryError(error: unknown, _attempt: number): boolean {
  const errorMsg = formatError(error);
  const lowerMsg = errorMsg.toLowerCase();

  // NEVER retry double-spend or already spent errors
  if (
    lowerMsg.includes('already spent') ||
    lowerMsg.includes('double spend') ||
    lowerMsg.includes('txn-mempool-conflict') ||
    lowerMsg.includes('missing inputs') ||
    lowerMsg.includes('bad-txns-inputs-spent')
  ) {
    return false;
  }

  // Always retry UTXO not found errors
  if (isUtxoNotFoundError(error)) {
    return true;
  }

  // Retry network-related errors
  if (
    lowerMsg.includes('network') ||
    lowerMsg.includes('timeout') ||
    lowerMsg.includes('econnrefused') ||
    lowerMsg.includes('enotfound') ||
    lowerMsg.includes('429') ||
    lowerMsg.includes('too many requests') ||
    lowerMsg.includes('rate limit')
  ) {
    return true;
  }

  // Don't retry other errors (e.g., insufficient funds, invalid transaction)
  return false;
}
