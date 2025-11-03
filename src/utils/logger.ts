/**
 * Logger Utility
 * Provides debug and standard logging with global debug flag control
 */

let debugMode = false;

/**
 * Set the global debug mode
 */
export function setDebugMode(enabled: boolean): void {
  debugMode = enabled;
}

/**
 * Get the current debug mode status
 */
export function isDebugMode(): boolean {
  return debugMode;
}

/**
 * Log a debug message (only shown when debug mode is enabled)
 */
export function debug(...args: unknown[]): void {
  if (debugMode) {
    console.log(...args);
  }
}

/**
 * Log an info message (always shown)
 */
export function info(...args: unknown[]): void {
  console.log(...args);
}

/**
 * Log a warning message (always shown)
 */
export function warn(...args: unknown[]): void {
  console.warn(...args);
}

/**
 * Log an error message (always shown)
 */
export function error(...args: unknown[]): void {
  console.error(...args);
}

/**
 * Create a scoped logger with a prefix
 */
export function createLogger(prefix: string) {
  return {
    debug: (...args: unknown[]) => debug(`[${prefix}]`, ...args),
    info: (...args: unknown[]) => info(`[${prefix}]`, ...args),
    warn: (...args: unknown[]) => warn(`[${prefix}]`, ...args),
    error: (...args: unknown[]) => error(`[${prefix}]`, ...args),
  };
}
