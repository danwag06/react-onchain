/**
 * Test for CRA webpack-style asset path rewriting
 *
 * This test verifies that react-onchain correctly rewrites asset paths
 * that webpack concatenates with the public path (n.p + "static/...")
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { rewriteJs } from '../core/rewriting/jsRewriter.js';
import { resolveAssetPath, createAssetPathPattern } from '../core/utils.js';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('CRA Webpack Asset Path Rewriting', () => {
  let testDir: string;
  let buildDir: string;

  beforeEach(async () => {
    // Create a temporary test directory
    testDir = join(tmpdir(), `react-onchain-test-${Date.now()}`);
    buildDir = join(testDir, 'build');
    await mkdir(join(buildDir, 'static', 'js'), { recursive: true });
    await mkdir(join(buildDir, 'static', 'media'), { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should match webpack public path concatenation patterns', () => {
    // Use shared pattern
    const pattern = createAssetPathPattern();

    // Test various webpack-style paths
    const testCases = [
      { input: '"static/media/logo.svg"', shouldMatch: true },
      { input: '"static/css/main.css"', shouldMatch: true },
      { input: '"assets/img/icon.png"', shouldMatch: true },
      { input: '"/static/media/logo.svg"', shouldMatch: true }, // Absolute path
      { input: '"./relative/path.js"', shouldMatch: true }, // Relative path
      { input: '"../parent/file.css"', shouldMatch: true }, // Parent relative
      { input: '"https://external.com/file.js"', shouldMatch: false }, // External URL (has :)
    ];

    for (const testCase of testCases) {
      const matches = testCase.input.match(pattern);
      if (testCase.shouldMatch) {
        assert.ok(matches, `Expected pattern to match: ${testCase.input}`);
        assert.ok(
          matches![0].includes(testCase.input.slice(1, -1)),
          `Expected match to contain path`
        );
      } else {
        assert.ok(!matches, `Expected pattern NOT to match: ${testCase.input}`);
      }
    }
  });

  it('should resolve webpack-style paths relative to build root', () => {
    // Test path without leading slash (webpack concatenates with n.p)
    const resolved1 = resolveAssetPath('static/media/logo.svg', 'static/js/main.js', buildDir);
    assert.strictEqual(resolved1, 'static/media/logo.svg');

    // Test absolute path from build root
    const resolved2 = resolveAssetPath('/static/media/logo.svg', 'static/js/main.js', buildDir);
    assert.strictEqual(resolved2, 'static/media/logo.svg');

    // Test relative path
    const resolved3 = resolveAssetPath('../media/logo.svg', 'static/js/main.js', buildDir);
    assert.strictEqual(resolved3, 'static/media/logo.svg');
  });

  it('should rewrite CRA webpack bundle with logo reference', async () => {
    // Create a mock webpack bundle with the logo reference pattern from CRA
    const mockJsContent = `
(()=>{"use strict";
var n={p:"/content/abc123/"};
const logo=n.p+"static/media/logo.6ce24c58023cc2f8fd88fe9d219db6c6.svg";
const img=document.createElement("img");
img.src=logo;
})();
`;

    const jsPath = join(buildDir, 'static', 'js', 'main.js');
    await writeFile(jsPath, mockJsContent);

    // Create URL map with the logo's inscription URL
    const urlMap = new Map<string, string>();
    urlMap.set(
      'static/media/logo.6ce24c58023cc2f8fd88fe9d219db6c6.svg',
      '/content/2f0b6c5c4cb8611494a1f9c16693e82a94bb0acbf7783c1aeb43e4a30dabb816_0'
    );

    // Rewrite the JS file
    const rewritten = await rewriteJs(jsPath, buildDir, 'static/js/main.js', urlMap);

    // Verify the logo path was rewritten
    assert.ok(
      rewritten.includes(
        '/content/2f0b6c5c4cb8611494a1f9c16693e82a94bb0acbf7783c1aeb43e4a30dabb816_0'
      ),
      'Rewritten content should include inscription URL'
    );
    assert.ok(
      !rewritten.includes('static/media/logo.6ce24c58023cc2f8fd88fe9d219db6c6.svg'),
      'Rewritten content should not include original path'
    );
  });

  it('should handle multiple webpack-style asset references', async () => {
    const mockJsContent = `
const logo="static/media/logo.svg";
const icon="assets/icons/favicon.ico";
const font="static/fonts/roboto.woff2";
`;

    const jsPath = join(buildDir, 'bundle.js');
    await writeFile(jsPath, mockJsContent);

    const urlMap = new Map<string, string>();
    urlMap.set('static/media/logo.svg', '/content/logo_inscription');
    urlMap.set('assets/icons/favicon.ico', '/content/favicon_inscription');
    urlMap.set('static/fonts/roboto.woff2', '/content/font_inscription');

    const rewritten = await rewriteJs(jsPath, buildDir, 'bundle.js', urlMap);

    assert.ok(rewritten.includes('/content/logo_inscription'), 'Should rewrite logo');
    assert.ok(rewritten.includes('/content/favicon_inscription'), 'Should rewrite favicon');
    assert.ok(rewritten.includes('/content/font_inscription'), 'Should rewrite font');
    assert.ok(!rewritten.includes('static/media/logo.svg'), 'Should remove original logo path');
    assert.ok(
      !rewritten.includes('assets/icons/favicon.ico'),
      'Should remove original favicon path'
    );
    assert.ok(!rewritten.includes('static/fonts/roboto.woff2'), 'Should remove original font path');
  });
});
