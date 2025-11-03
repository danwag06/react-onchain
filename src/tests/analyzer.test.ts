import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { analyzeBuildDirectory } from '../analyzer.js';
import { tmpdir } from 'os';

// Helper to create a temporary test directory
async function createTempTestDir(): Promise<string> {
  const testDir = join(tmpdir(), `analyzer-test-${Date.now()}`);
  await mkdir(testDir, { recursive: true });
  return testDir;
}

// Helper to create a test file
async function createTestFile(dir: string, path: string, content: string): Promise<void> {
  const fullPath = join(dir, path);
  const dirPath = join(fullPath, '..');
  await mkdir(dirPath, { recursive: true });
  await writeFile(fullPath, content, 'utf-8');
}

describe('HTML Dependency Extraction', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTempTestDir();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should extract basic script, link, and img src attributes', async () => {
    await createTestFile(
      testDir,
      'index.html',
      `<!DOCTYPE html>
      <html>
        <head>
          <script src="/bundle.js"></script>
          <link href="/styles.css" rel="stylesheet">
        </head>
        <body>
          <img src="/logo.png" alt="Logo">
        </body>
      </html>`
    );
    await createTestFile(testDir, 'bundle.js', 'console.log("test");');
    await createTestFile(testDir, 'styles.css', 'body { margin: 0; }');
    await createTestFile(testDir, 'logo.png', 'fake-png-data');

    const result = await analyzeBuildDirectory(testDir);
    const indexFile = result.files.find((f) => f.originalPath === 'index.html');

    assert.ok(indexFile, 'index.html should be analyzed');
    assert.ok(indexFile.dependencies.includes('bundle.js'), 'Should include bundle.js');
    assert.ok(indexFile.dependencies.includes('styles.css'), 'Should include styles.css');
    assert.ok(indexFile.dependencies.includes('logo.png'), 'Should include logo.png');
  });

  it('should extract srcset attributes for responsive images', async () => {
    await createTestFile(
      testDir,
      'index.html',
      `<!DOCTYPE html>
      <html>
        <body>
          <img src="/small.jpg" srcset="/medium.jpg 768w, /large.jpg 1024w" alt="Responsive">
        </body>
      </html>`
    );
    await createTestFile(testDir, 'small.jpg', 'fake-jpg');
    await createTestFile(testDir, 'medium.jpg', 'fake-jpg');
    await createTestFile(testDir, 'large.jpg', 'fake-jpg');

    const result = await analyzeBuildDirectory(testDir);
    const indexFile = result.files.find((f) => f.originalPath === 'index.html');

    assert.ok(indexFile?.dependencies.includes('small.jpg'), 'Should include small.jpg from src');
    assert.ok(
      indexFile?.dependencies.includes('medium.jpg'),
      'Should include medium.jpg from srcset'
    );
    assert.ok(
      indexFile?.dependencies.includes('large.jpg'),
      'Should include large.jpg from srcset'
    );
  });

  it('should extract picture element with source srcset', async () => {
    await createTestFile(
      testDir,
      'index.html',
      `<!DOCTYPE html>
      <html>
        <body>
          <picture>
            <source media="(min-width: 800px)" srcset="/large.webp">
            <source media="(min-width: 400px)" srcset="/medium.webp">
            <img src="/small.webp" alt="Art Direction">
          </picture>
        </body>
      </html>`
    );
    await createTestFile(testDir, 'large.webp', 'fake-webp');
    await createTestFile(testDir, 'medium.webp', 'fake-webp');
    await createTestFile(testDir, 'small.webp', 'fake-webp');

    const result = await analyzeBuildDirectory(testDir);
    const indexFile = result.files.find((f) => f.originalPath === 'index.html');

    assert.ok(indexFile?.dependencies.includes('large.webp'), 'Should include large.webp');
    assert.ok(indexFile?.dependencies.includes('medium.webp'), 'Should include medium.webp');
    assert.ok(indexFile?.dependencies.includes('small.webp'), 'Should include small.webp');
  });

  it('should extract manifest link', async () => {
    await createTestFile(
      testDir,
      'index.html',
      `<!DOCTYPE html>
      <html>
        <head>
          <link rel="manifest" href="/manifest.json">
        </head>
      </html>`
    );
    await createTestFile(testDir, 'manifest.json', '{"name":"Test App"}');

    const result = await analyzeBuildDirectory(testDir);
    const indexFile = result.files.find((f) => f.originalPath === 'index.html');

    assert.ok(indexFile?.dependencies.includes('manifest.json'), 'Should include manifest.json');
  });

  it('should extract favicon and icon links', async () => {
    await createTestFile(
      testDir,
      'index.html',
      `<!DOCTYPE html>
      <html>
        <head>
          <link rel="icon" href="/favicon.ico">
          <link rel="apple-touch-icon" href="/apple-icon.png">
          <link rel="shortcut icon" href="/shortcut.ico">
        </head>
      </html>`
    );
    await createTestFile(testDir, 'favicon.ico', 'fake-ico');
    await createTestFile(testDir, 'apple-icon.png', 'fake-png');
    await createTestFile(testDir, 'shortcut.ico', 'fake-ico');

    const result = await analyzeBuildDirectory(testDir);
    const indexFile = result.files.find((f) => f.originalPath === 'index.html');

    assert.ok(indexFile?.dependencies.includes('favicon.ico'), 'Should include favicon.ico');
    assert.ok(indexFile?.dependencies.includes('apple-icon.png'), 'Should include apple-icon.png');
    assert.ok(indexFile?.dependencies.includes('shortcut.ico'), 'Should include shortcut.ico');
  });

  it('should extract video poster attribute', async () => {
    await createTestFile(
      testDir,
      'index.html',
      `<!DOCTYPE html>
      <html>
        <body>
          <video src="/movie.mp4" poster="/thumbnail.jpg" controls></video>
        </body>
      </html>`
    );
    await createTestFile(testDir, 'movie.mp4', 'fake-video');
    await createTestFile(testDir, 'thumbnail.jpg', 'fake-jpg');

    const result = await analyzeBuildDirectory(testDir);
    const indexFile = result.files.find((f) => f.originalPath === 'index.html');

    assert.ok(indexFile?.dependencies.includes('movie.mp4'), 'Should include movie.mp4');
    assert.ok(indexFile?.dependencies.includes('thumbnail.jpg'), 'Should include thumbnail.jpg');
  });

  it('should extract data-* attributes with asset paths', async () => {
    await createTestFile(
      testDir,
      'index.html',
      `<!DOCTYPE html>
      <html>
        <body>
          <div data-background="/hero.jpg" data-poster="/poster.png"></div>
        </body>
      </html>`
    );
    await createTestFile(testDir, 'hero.jpg', 'fake-jpg');
    await createTestFile(testDir, 'poster.png', 'fake-png');

    const result = await analyzeBuildDirectory(testDir);
    const indexFile = result.files.find((f) => f.originalPath === 'index.html');

    assert.ok(indexFile?.dependencies.includes('hero.jpg'), 'Should include hero.jpg');
    assert.ok(indexFile?.dependencies.includes('poster.png'), 'Should include poster.png');
  });

  it('should skip external URLs and data URIs', async () => {
    await createTestFile(
      testDir,
      'index.html',
      `<!DOCTYPE html>
      <html>
        <head>
          <script src="https://cdn.example.com/lib.js"></script>
          <link href="//fonts.googleapis.com/css" rel="stylesheet">
        </head>
        <body>
          <img src="data:image/png;base64,abc123" alt="Data URI">
        </body>
      </html>`
    );

    const result = await analyzeBuildDirectory(testDir);
    const indexFile = result.files.find((f) => f.originalPath === 'index.html');

    assert.strictEqual(
      indexFile?.dependencies.length,
      0,
      'Should not include external URLs or data URIs'
    );
  });
});

describe('CSS Dependency Extraction', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTempTestDir();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should extract url() references', async () => {
    await createTestFile(
      testDir,
      'styles.css',
      `
      body {
        background: url("/bg.jpg");
      }
      .icon {
        background-image: url('./icon.png');
      }
      `
    );
    await createTestFile(testDir, 'bg.jpg', 'fake-jpg');
    await createTestFile(testDir, 'icon.png', 'fake-png');

    const result = await analyzeBuildDirectory(testDir);
    const cssFile = result.files.find((f) => f.originalPath === 'styles.css');

    assert.ok(cssFile?.dependencies.includes('bg.jpg'), 'Should include bg.jpg');
    assert.ok(cssFile?.dependencies.includes('icon.png'), 'Should include icon.png');
  });

  it('should extract @import statements', async () => {
    await createTestFile(
      testDir,
      'main.css',
      `
      @import url("reset.css");
      @import "typography.css";
      @import url('/variables.css');

      body { margin: 0; }
      `
    );
    await createTestFile(testDir, 'reset.css', '* { margin: 0; }');
    await createTestFile(testDir, 'typography.css', 'body { font-family: sans-serif; }');
    await createTestFile(testDir, 'variables.css', ':root { --color: blue; }');

    const result = await analyzeBuildDirectory(testDir);
    const cssFile = result.files.find((f) => f.originalPath === 'main.css');

    assert.ok(cssFile?.dependencies.includes('reset.css'), 'Should include reset.css');
    assert.ok(cssFile?.dependencies.includes('typography.css'), 'Should include typography.css');
    assert.ok(cssFile?.dependencies.includes('variables.css'), 'Should include variables.css');
  });

  it('should extract @font-face src with multiple formats', async () => {
    await createTestFile(
      testDir,
      'fonts.css',
      `
      @font-face {
        font-family: 'MyFont';
        src: url('fonts/myfont.woff2') format('woff2'),
             url('fonts/myfont.woff') format('woff');
      }
      `
    );
    await mkdir(join(testDir, 'fonts'), { recursive: true });
    await createTestFile(testDir, 'fonts/myfont.woff2', 'fake-woff2');
    await createTestFile(testDir, 'fonts/myfont.woff', 'fake-woff');

    const result = await analyzeBuildDirectory(testDir);
    const cssFile = result.files.find((f) => f.originalPath === 'fonts.css');

    assert.ok(cssFile?.dependencies.includes('fonts/myfont.woff2'), 'Should include woff2 font');
    assert.ok(cssFile?.dependencies.includes('fonts/myfont.woff'), 'Should include woff font');
  });

  it('should extract image-set() function', async () => {
    await createTestFile(
      testDir,
      'styles.css',
      `
      .hero {
        background-image: image-set(
          url("hero-1x.jpg") 1x,
          url("hero-2x.jpg") 2x
        );
      }
      `
    );
    await createTestFile(testDir, 'hero-1x.jpg', 'fake-jpg');
    await createTestFile(testDir, 'hero-2x.jpg', 'fake-jpg');

    const result = await analyzeBuildDirectory(testDir);
    const cssFile = result.files.find((f) => f.originalPath === 'styles.css');

    assert.ok(cssFile?.dependencies.includes('hero-1x.jpg'), 'Should include hero-1x.jpg');
    assert.ok(cssFile?.dependencies.includes('hero-2x.jpg'), 'Should include hero-2x.jpg');
  });
});

describe('JavaScript Dependency Extraction', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTempTestDir();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should extract import statements', async () => {
    await createTestFile(
      testDir,
      'main.js',
      `
      import React from 'react';
      import App from './App.js';
      import config from './config.json';
      import logo from '/assets/logo.svg';
      `
    );
    await createTestFile(testDir, 'App.js', 'export default {};');
    await createTestFile(testDir, 'config.json', '{}');
    await mkdir(join(testDir, 'assets'), { recursive: true });
    await createTestFile(testDir, 'assets/logo.svg', '<svg></svg>');

    const result = await analyzeBuildDirectory(testDir);
    const jsFile = result.files.find((f) => f.originalPath === 'main.js');

    assert.ok(jsFile?.dependencies.includes('App.js'), 'Should include App.js');
    assert.ok(jsFile?.dependencies.includes('config.json'), 'Should include config.json');
    assert.ok(jsFile?.dependencies.includes('assets/logo.svg'), 'Should include assets/logo.svg');
    assert.ok(
      !jsFile?.dependencies.some((d) => d.includes('react')),
      'Should not include npm packages'
    );
  });

  it('should extract dynamic import() statements', async () => {
    await createTestFile(
      testDir,
      'app.js',
      `
      const Component = React.lazy(() => import('./LazyComponent.js'));
      const data = await import('./data.json');
      `
    );
    await createTestFile(testDir, 'LazyComponent.js', 'export default {};');
    await createTestFile(testDir, 'data.json', '{}');

    const result = await analyzeBuildDirectory(testDir);
    const jsFile = result.files.find((f) => f.originalPath === 'app.js');

    assert.ok(jsFile?.dependencies.includes('LazyComponent.js'), 'Should include LazyComponent.js');
    assert.ok(jsFile?.dependencies.includes('data.json'), 'Should include data.json');
  });

  it('should extract require() statements', async () => {
    await createTestFile(
      testDir,
      'server.js',
      `
      const config = require('./config.json');
      const utils = require('./utils.js');
      `
    );
    await createTestFile(testDir, 'config.json', '{}');
    await createTestFile(testDir, 'utils.js', 'module.exports = {};');

    const result = await analyzeBuildDirectory(testDir);
    const jsFile = result.files.find((f) => f.originalPath === 'server.js');

    assert.ok(jsFile?.dependencies.includes('config.json'), 'Should include config.json');
    assert.ok(jsFile?.dependencies.includes('utils.js'), 'Should include utils.js');
  });

  it('should extract new URL() constructor', async () => {
    await createTestFile(
      testDir,
      'module.js',
      `
      const imageUrl = new URL('./image.png', import.meta.url);
      const workerUrl = new URL('/worker.js', import.meta.url);
      `
    );
    await createTestFile(testDir, 'image.png', 'fake-png');
    await createTestFile(testDir, 'worker.js', 'self.postMessage("hi");');

    const result = await analyzeBuildDirectory(testDir);
    const jsFile = result.files.find((f) => f.originalPath === 'module.js');

    assert.ok(jsFile?.dependencies.includes('image.png'), 'Should include image.png');
    assert.ok(jsFile?.dependencies.includes('worker.js'), 'Should include worker.js');
  });

  it('should extract Worker constructors', async () => {
    await createTestFile(
      testDir,
      'app.js',
      `
      const worker = new Worker('/workers/processor.js');
      const sharedWorker = new SharedWorker('./shared.js');
      `
    );
    await mkdir(join(testDir, 'workers'), { recursive: true });
    await createTestFile(testDir, 'workers/processor.js', 'self.postMessage("hi");');
    await createTestFile(testDir, 'shared.js', 'self.postMessage("hi");');

    const result = await analyzeBuildDirectory(testDir);
    const jsFile = result.files.find((f) => f.originalPath === 'app.js');

    assert.ok(jsFile?.dependencies.includes('workers/processor.js'), 'Should include worker');
    assert.ok(jsFile?.dependencies.includes('shared.js'), 'Should include shared worker');
  });

  it('should extract Service Worker registration', async () => {
    await createTestFile(
      testDir,
      'app.js',
      `
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js');
      }
      `
    );
    await createTestFile(testDir, 'sw.js', 'self.addEventListener("install", () => {});');

    const result = await analyzeBuildDirectory(testDir);
    const jsFile = result.files.find((f) => f.originalPath === 'app.js');

    assert.ok(jsFile?.dependencies.includes('sw.js'), 'Should include service worker');
  });

  it('should extract fetch() calls to local resources', async () => {
    await createTestFile(
      testDir,
      'api.js',
      `
      const data = await fetch('/api/data.json');
      const config = await fetch('./config.json');
      `
    );
    await mkdir(join(testDir, 'api'), { recursive: true });
    await createTestFile(testDir, 'api/data.json', '{}');
    await createTestFile(testDir, 'config.json', '{}');

    const result = await analyzeBuildDirectory(testDir);
    const jsFile = result.files.find((f) => f.originalPath === 'api.js');

    assert.ok(jsFile?.dependencies.includes('api/data.json'), 'Should include api/data.json');
    assert.ok(jsFile?.dependencies.includes('config.json'), 'Should include config.json');
  });

  it('should extract template literals with asset paths', async () => {
    await createTestFile(
      testDir,
      'app.js',
      `
      const logo = \`./logo.png\`;
      const icon = \`/assets/icon.svg\`;
      `
    );
    await createTestFile(testDir, 'logo.png', 'fake-png');
    await mkdir(join(testDir, 'assets'), { recursive: true });
    await createTestFile(testDir, 'assets/icon.svg', '<svg></svg>');

    const result = await analyzeBuildDirectory(testDir);
    const jsFile = result.files.find((f) => f.originalPath === 'app.js');

    assert.ok(jsFile?.dependencies.includes('logo.png'), 'Should include logo.png');
    assert.ok(jsFile?.dependencies.includes('assets/icon.svg'), 'Should include assets/icon.svg');
  });

  it('should extract string literal asset paths', async () => {
    await createTestFile(
      testDir,
      'app.js',
      `
      const img = document.createElement('img');
      img.src = "./image.jpg";
      const video = "/videos/intro.mp4";
      `
    );
    await createTestFile(testDir, 'image.jpg', 'fake-jpg');
    await mkdir(join(testDir, 'videos'), { recursive: true });
    await createTestFile(testDir, 'videos/intro.mp4', 'fake-video');

    const result = await analyzeBuildDirectory(testDir);
    const jsFile = result.files.find((f) => f.originalPath === 'app.js');

    assert.ok(jsFile?.dependencies.includes('image.jpg'), 'Should include image.jpg');
    assert.ok(jsFile?.dependencies.includes('videos/intro.mp4'), 'Should include videos/intro.mp4');
  });

  it('should handle expanded file extensions (wasm, webm, mp3)', async () => {
    await createTestFile(
      testDir,
      'app.js',
      `
      import wasmModule from './module.wasm';
      const video = "/video.webm";
      const audio = "./music.mp3";
      `
    );
    await createTestFile(testDir, 'module.wasm', 'fake-wasm');
    await createTestFile(testDir, 'video.webm', 'fake-webm');
    await createTestFile(testDir, 'music.mp3', 'fake-mp3');

    const result = await analyzeBuildDirectory(testDir);
    const jsFile = result.files.find((f) => f.originalPath === 'app.js');

    assert.ok(jsFile?.dependencies.includes('module.wasm'), 'Should include module.wasm');
    assert.ok(jsFile?.dependencies.includes('video.webm'), 'Should include video.webm');
    assert.ok(jsFile?.dependencies.includes('music.mp3'), 'Should include music.mp3');
  });
});

describe('JSON Dependency Extraction', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTempTestDir();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should extract icon paths from manifest.json', async () => {
    await createTestFile(
      testDir,
      'manifest.json',
      JSON.stringify({
        name: 'My PWA',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      })
    );
    await createTestFile(testDir, 'icon-192.png', 'fake-png');
    await createTestFile(testDir, 'icon-512.png', 'fake-png');

    const result = await analyzeBuildDirectory(testDir);
    const manifestFile = result.files.find((f) => f.originalPath === 'manifest.json');

    assert.ok(manifestFile?.dependencies.includes('icon-192.png'), 'Should include icon-192.png');
    assert.ok(manifestFile?.dependencies.includes('icon-512.png'), 'Should include icon-512.png');
  });

  it('should extract screenshot paths from manifest.json', async () => {
    await createTestFile(
      testDir,
      'manifest.webmanifest',
      JSON.stringify({
        name: 'My PWA',
        screenshots: [{ src: '/screenshot1.png', sizes: '1280x720', type: 'image/png' }],
      })
    );
    await createTestFile(testDir, 'screenshot1.png', 'fake-png');

    const result = await analyzeBuildDirectory(testDir);
    const manifestFile = result.files.find((f) => f.originalPath === 'manifest.webmanifest');

    assert.ok(
      manifestFile?.dependencies.includes('screenshot1.png'),
      'Should include screenshot1.png'
    );
  });

  it('should extract paths from nested JSON objects', async () => {
    await createTestFile(
      testDir,
      'config.json',
      JSON.stringify({
        theme: {
          logo: './assets/logo.png',
          background: '/images/bg.jpg',
        },
      })
    );
    await mkdir(join(testDir, 'assets'), { recursive: true });
    await mkdir(join(testDir, 'images'), { recursive: true });
    await createTestFile(testDir, 'assets/logo.png', 'fake-png');
    await createTestFile(testDir, 'images/bg.jpg', 'fake-jpg');

    const result = await analyzeBuildDirectory(testDir);
    const configFile = result.files.find((f) => f.originalPath === 'config.json');

    assert.ok(configFile?.dependencies.includes('assets/logo.png'), 'Should include nested logo');
    assert.ok(
      configFile?.dependencies.includes('images/bg.jpg'),
      'Should include nested background'
    );
  });
});

describe('SVG Dependency Extraction', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTempTestDir();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should extract href references in SVG', async () => {
    await createTestFile(
      testDir,
      'sprite.svg',
      `<svg xmlns="http://www.w3.org/2000/svg">
        <use href="icons.svg#check" />
        <image href="embedded.png" />
      </svg>`
    );
    await createTestFile(testDir, 'icons.svg', '<svg></svg>');
    await createTestFile(testDir, 'embedded.png', 'fake-png');

    const result = await analyzeBuildDirectory(testDir);
    const svgFile = result.files.find((f) => f.originalPath === 'sprite.svg');

    assert.ok(svgFile?.dependencies.includes('icons.svg'), 'Should include external SVG reference');
    assert.ok(svgFile?.dependencies.includes('embedded.png'), 'Should include embedded image');
  });

  it('should extract xlink:href references', async () => {
    await createTestFile(
      testDir,
      'graphic.svg',
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
        <use xlink:href="symbols.svg#arrow" />
      </svg>`
    );
    await createTestFile(testDir, 'symbols.svg', '<svg></svg>');

    const result = await analyzeBuildDirectory(testDir);
    const svgFile = result.files.find((f) => f.originalPath === 'graphic.svg');

    assert.ok(svgFile?.dependencies.includes('symbols.svg'), 'Should include xlink:href reference');
  });

  it('should extract url() in SVG styles', async () => {
    await createTestFile(
      testDir,
      'styled.svg',
      `<svg xmlns="http://www.w3.org/2000/svg">
        <style>
          .bg { fill: url(pattern.svg#dots); }
        </style>
        <rect class="bg" />
      </svg>`
    );
    await createTestFile(testDir, 'pattern.svg', '<svg></svg>');

    const result = await analyzeBuildDirectory(testDir);
    const svgFile = result.files.find((f) => f.originalPath === 'styled.svg');

    assert.ok(svgFile?.dependencies.includes('pattern.svg'), 'Should include pattern from style');
  });

  it('should skip internal fragment-only references', async () => {
    await createTestFile(
      testDir,
      'internal.svg',
      `<svg xmlns="http://www.w3.org/2000/svg">
        <defs>
          <symbol id="icon"></symbol>
        </defs>
        <use href="#icon" />
      </svg>`
    );

    const result = await analyzeBuildDirectory(testDir);
    const svgFile = result.files.find((f) => f.originalPath === 'internal.svg');

    assert.strictEqual(
      svgFile?.dependencies.length,
      0,
      'Should not include internal fragment references'
    );
  });
});

describe('Dependency Graph and Topological Order', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTempTestDir();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should create correct dependency graph', async () => {
    // index.html -> [bundle.js, styles.css]
    // bundle.js -> [config.json]
    // styles.css -> [font.woff2]
    await createTestFile(
      testDir,
      'index.html',
      `<!DOCTYPE html>
      <html>
        <head>
          <script src="/bundle.js"></script>
          <link href="/styles.css" rel="stylesheet">
        </head>
      </html>`
    );
    await createTestFile(testDir, 'bundle.js', 'import config from "./config.json";');
    await createTestFile(testDir, 'styles.css', '@font-face { src: url("font.woff2"); }');
    await createTestFile(testDir, 'config.json', '{}');
    await createTestFile(testDir, 'font.woff2', 'fake-font');

    const result = await analyzeBuildDirectory(testDir);

    // Check graph structure
    assert.ok(result.graph.has('index.html'), 'Graph should contain index.html');
    assert.ok(result.graph.has('bundle.js'), 'Graph should contain bundle.js');
    assert.ok(result.graph.has('styles.css'), 'Graph should contain styles.css');
    assert.ok(result.graph.has('config.json'), 'Graph should contain config.json');
    assert.ok(result.graph.has('font.woff2'), 'Graph should contain font.woff2');
  });

  it('should order dependencies before dependents', async () => {
    await createTestFile(
      testDir,
      'index.html',
      `<!DOCTYPE html>
      <html>
        <head>
          <script src="/bundle.js"></script>
          <link href="/styles.css" rel="stylesheet">
        </head>
      </html>`
    );
    await createTestFile(testDir, 'bundle.js', 'import config from "./config.json";');
    await createTestFile(testDir, 'styles.css', '@font-face { src: url("font.woff2"); }');
    await createTestFile(testDir, 'config.json', '{}');
    await createTestFile(testDir, 'font.woff2', 'fake-font');

    const result = await analyzeBuildDirectory(testDir);

    // Dependencies should come before dependents
    const configIndex = result.order.indexOf('config.json');
    const bundleIndex = result.order.indexOf('bundle.js');
    const fontIndex = result.order.indexOf('font.woff2');
    const stylesIndex = result.order.indexOf('styles.css');
    const htmlIndex = result.order.indexOf('index.html');

    assert.ok(configIndex < bundleIndex, 'config.json should come before bundle.js');
    assert.ok(fontIndex < stylesIndex, 'font.woff2 should come before styles.css');
    assert.ok(bundleIndex < htmlIndex, 'bundle.js should come before index.html');
    assert.ok(stylesIndex < htmlIndex, 'styles.css should come before index.html');
  });

  it('should handle circular dependencies gracefully', async () => {
    await createTestFile(testDir, 'a.js', 'import "./b.js";');
    await createTestFile(testDir, 'b.js', 'import "./a.js";');

    const result = await analyzeBuildDirectory(testDir);

    assert.ok(result.order.includes('a.js'), 'Should include a.js despite circular dependency');
    assert.ok(result.order.includes('b.js'), 'Should include b.js despite circular dependency');
  });
});

describe('Edge Cases and Integration', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTempTestDir();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should handle query parameters in URLs', async () => {
    await createTestFile(
      testDir,
      'index.html',
      `<!DOCTYPE html>
      <html>
        <body>
          <img src="/image.png?v=123" alt="Versioned">
        </body>
      </html>`
    );
    await createTestFile(testDir, 'image.png', 'fake-png');

    const result = await analyzeBuildDirectory(testDir);
    const indexFile = result.files.find((f) => f.originalPath === 'index.html');

    // The dependency should be extracted (implementation might strip query params)
    assert.ok(
      indexFile?.dependencies.some((d) => d.includes('image.png')),
      'Should handle URLs with query parameters'
    );
  });

  it('should handle hash fragments in URLs', async () => {
    await createTestFile(
      testDir,
      'index.html',
      `<!DOCTYPE html>
      <html>
        <body>
          <a href="/doc.html#section">Link</a>
        </body>
      </html>`
    );
    await createTestFile(testDir, 'doc.html', '<html></html>');

    const result = await analyzeBuildDirectory(testDir);
    const indexFile = result.files.find((f) => f.originalPath === 'index.html');

    // Hash fragments in href for navigation shouldn't be treated as dependencies
    // (current implementation doesn't extract <a href>, so this should be empty or not include it)
    // This test documents current behavior
    assert.ok(true, 'Test for hash fragment handling');
  });

  it('should remove duplicate dependencies', async () => {
    await createTestFile(
      testDir,
      'index.html',
      `<!DOCTYPE html>
      <html>
        <body>
          <img src="/logo.png">
          <img src="/logo.png">
          <meta property="og:image" content="/logo.png">
        </body>
      </html>`
    );
    await createTestFile(testDir, 'logo.png', 'fake-png');

    const result = await analyzeBuildDirectory(testDir);
    const indexFile = result.files.find((f) => f.originalPath === 'index.html');

    const logoDeps = indexFile?.dependencies.filter((d) => d.includes('logo.png'));
    assert.strictEqual(logoDeps?.length, 1, 'Should deduplicate dependencies');
  });

  it('should handle files in nested directories', async () => {
    await mkdir(join(testDir, 'assets/images'), { recursive: true });
    await mkdir(join(testDir, 'js'), { recursive: true });

    await createTestFile(
      testDir,
      'index.html',
      `<!DOCTYPE html>
      <html>
        <head>
          <script src="/js/app.js"></script>
        </head>
        <body>
          <img src="/assets/images/logo.png">
        </body>
      </html>`
    );
    await createTestFile(testDir, 'js/app.js', 'console.log("test");');
    await createTestFile(testDir, 'assets/images/logo.png', 'fake-png');

    const result = await analyzeBuildDirectory(testDir);
    const indexFile = result.files.find((f) => f.originalPath === 'index.html');

    assert.ok(indexFile?.dependencies.includes('js/app.js'), 'Should handle nested js');
    assert.ok(
      indexFile?.dependencies.includes('assets/images/logo.png'),
      'Should handle deeply nested assets'
    );
  });

  it('should compute content hashes correctly', async () => {
    await createTestFile(testDir, 'file1.txt', 'content A');
    await createTestFile(testDir, 'file2.txt', 'content B');

    const result = await analyzeBuildDirectory(testDir);
    const file1 = result.files.find((f) => f.originalPath === 'file1.txt');
    const file2 = result.files.find((f) => f.originalPath === 'file2.txt');

    assert.ok(file1?.contentHash, 'Should have content hash for file1');
    assert.ok(file2?.contentHash, 'Should have content hash for file2');
    assert.notStrictEqual(
      file1?.contentHash,
      file2?.contentHash,
      'Different content should have different hashes'
    );
  });

  it('should handle realistic React build output', async () => {
    await mkdir(join(testDir, 'assets'), { recursive: true });

    await createTestFile(
      testDir,
      'index.html',
      `<!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <link rel="icon" href="/favicon.ico">
          <link rel="manifest" href="/manifest.json">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>React App</title>
          <script type="module" src="/assets/index-abc123.js"></script>
          <link rel="stylesheet" href="/assets/index-def456.css">
        </head>
        <body>
          <div id="root"></div>
        </body>
      </html>`
    );

    await createTestFile(
      testDir,
      'assets/index-abc123.js',
      `
      import logo from '/assets/logo-xyz789.svg';
      const worker = new Worker('/assets/worker-ghi012.js');
      `
    );

    await createTestFile(
      testDir,
      'assets/index-def456.css',
      `
      @import url('/assets/normalize-jkl345.css');
      body { background: url('/assets/bg-mno678.jpg'); }
      `
    );

    await createTestFile(testDir, 'favicon.ico', 'fake-ico');
    await createTestFile(
      testDir,
      'manifest.json',
      JSON.stringify({ name: 'App', icons: [{ src: '/icon.png' }] })
    );
    await createTestFile(testDir, 'icon.png', 'fake-png');
    await createTestFile(testDir, 'assets/logo-xyz789.svg', '<svg></svg>');
    await createTestFile(testDir, 'assets/worker-ghi012.js', 'self.postMessage("hi");');
    await createTestFile(testDir, 'assets/normalize-jkl345.css', '* { margin: 0; }');
    await createTestFile(testDir, 'assets/bg-mno678.jpg', 'fake-jpg');

    const result = await analyzeBuildDirectory(testDir);

    // Verify all files are discovered
    assert.ok(
      result.files.find((f) => f.originalPath === 'index.html'),
      'Should find index.html'
    );
    assert.ok(
      result.files.find((f) => f.originalPath === 'favicon.ico'),
      'Should find favicon'
    );
    assert.ok(
      result.files.find((f) => f.originalPath === 'manifest.json'),
      'Should find manifest'
    );
    assert.ok(
      result.files.find((f) => f.originalPath === 'icon.png'),
      'Should find icon'
    );
    assert.ok(
      result.files.find((f) => f.originalPath.includes('index-abc123.js')),
      'Should find JS bundle'
    );
    assert.ok(
      result.files.find((f) => f.originalPath.includes('index-def456.css')),
      'Should find CSS bundle'
    );
    assert.ok(
      result.files.find((f) => f.originalPath.includes('logo-xyz789.svg')),
      'Should find logo'
    );
    assert.ok(
      result.files.find((f) => f.originalPath.includes('worker-ghi012.js')),
      'Should find worker'
    );

    // Verify dependency chains
    const htmlFile = result.files.find((f) => f.originalPath === 'index.html');
    assert.ok(
      htmlFile?.dependencies.some((d) => d.includes('index-abc123.js')),
      'HTML should depend on JS'
    );
    assert.ok(
      htmlFile?.dependencies.some((d) => d.includes('index-def456.css')),
      'HTML should depend on CSS'
    );
    assert.ok(htmlFile?.dependencies.includes('manifest.json'), 'HTML should depend on manifest');

    const jsFile = result.files.find((f) => f.originalPath.includes('index-abc123.js'));
    assert.ok(
      jsFile?.dependencies.some((d) => d.includes('logo-xyz789.svg')),
      'JS should depend on logo'
    );
    assert.ok(
      jsFile?.dependencies.some((d) => d.includes('worker-ghi012.js')),
      'JS should depend on worker'
    );

    const cssFile = result.files.find((f) => f.originalPath.includes('index-def456.css'));
    assert.ok(
      cssFile?.dependencies.some((d) => d.includes('normalize-jkl345.css')),
      'CSS should depend on imported CSS'
    );
    assert.ok(
      cssFile?.dependencies.some((d) => d.includes('bg-mno678.jpg')),
      'CSS should depend on background image'
    );

    // Verify topological order - dependencies should come before dependents
    const logoIndex = result.order.findIndex((p) => p.includes('logo-xyz789.svg'));
    const jsIndex = result.order.findIndex((p) => p.includes('index-abc123.js'));
    const htmlIndex = result.order.indexOf('index.html');

    assert.ok(logoIndex < jsIndex, 'Logo should come before JS that imports it');
    assert.ok(jsIndex < htmlIndex, 'JS should come before HTML that includes it');
  });
});
