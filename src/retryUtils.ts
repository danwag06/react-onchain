/**
 * Retry utility with exponential backoff
 */

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
  return new Promise(resolve => setTimeout(resolve, ms));
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
  shouldRetry?: (error: any, attempt: number) => boolean
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: any;
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
      const errorMsg = error instanceof Error ? error.message : String(error);
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
export function isUtxoNotFoundError(error: any): boolean {
  const errorMsg = error instanceof Error ? error.message : String(error);
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
export function shouldRetryError(error: any, attempt: number): boolean {
  // Always retry UTXO not found errors
  if (isUtxoNotFoundError(error)) {
    return true;
  }

  // Retry network-related errors
  const errorMsg = error instanceof Error ? error.message : String(error);
  const lowerMsg = errorMsg.toLowerCase();

  if (
    lowerMsg.includes('network') ||
    lowerMsg.includes('timeout') ||
    lowerMsg.includes('econnrefused') ||
    lowerMsg.includes('enotfound')
  ) {
    return true;
  }

  // Don't retry other errors (e.g., insufficient funds, invalid transaction)
  return false;
}
