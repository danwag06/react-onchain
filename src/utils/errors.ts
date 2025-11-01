/**
 * Shared error handling utilities
 */

/**
 * Formats error message from unknown error type
 * This replaces the pattern: error instanceof Error ? error.message : String(error)
 * which was duplicated 17+ times across the codebase
 */
export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Wraps error with additional context
 */
export function wrapError(context: string, error: unknown): Error {
  const message = formatError(error);
  return new Error(`${context}: ${message}`);
}

/**
 * Checks if error message contains specific text (case-insensitive)
 */
export function isErrorMessage(error: unknown, fragment: string): boolean {
  return formatError(error).toLowerCase().includes(fragment.toLowerCase());
}
