/**
 * Rewriting Module
 * URL rewriting for HTML, CSS, and JavaScript files
 */

import { readFile } from 'fs/promises';
import { rewriteHtml, injectVersionScript, injectBasePathFix } from './htmlRewriter.js';
import { rewriteCss } from './cssRewriter.js';
import { rewriteJs } from './jsRewriter.js';
import { createUrlMap } from './utils.js';

// Re-export individual rewriters
export { rewriteHtml, injectVersionScript, injectBasePathFix, rewriteCss, rewriteJs, createUrlMap };

/**
 * Rewrites file content based on file type
 */
export async function rewriteFile(
  filePath: string,
  baseDir: string,
  originalPath: string,
  contentType: string,
  urlMap: Map<string, string>
): Promise<Buffer> {
  if (contentType === 'text/html') {
    const content = await rewriteHtml(filePath, baseDir, originalPath, urlMap);
    return Buffer.from(content, 'utf-8');
  } else if (contentType === 'text/css') {
    const content = await rewriteCss(filePath, baseDir, originalPath, urlMap);
    return Buffer.from(content, 'utf-8');
  } else if (contentType === 'application/javascript') {
    const content = await rewriteJs(filePath, baseDir, originalPath, urlMap);
    return Buffer.from(content, 'utf-8');
  } else {
    // For other file types, return as-is (binary files, etc.)
    return await readFile(filePath);
  }
}
