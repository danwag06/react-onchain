/**
 * Shared utility functions for core components
 */

/**
 * Check if URL should be skipped (external URLs, data URIs, etc.)
 * Used by both analyzer and rewriter to determine if a URL should be ignored
 */
export function shouldSkipUrl(url: string): boolean {
  return url.startsWith('http') || url.startsWith('//') || url.startsWith('data:');
}
