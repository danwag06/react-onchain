/**
 * Local Service Worker Test
 *
 * This script simulates the chunked video streaming setup locally without deploying onchain.
 * It chunks the video, generates a service worker, and creates a test HTML page.
 *
 * Usage:
 *   npm run test:sw-local
 *
 * Then open: http://localhost:3000/test-video.html
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { createServer } from 'http';
import { createHash } from 'crypto';
import { splitFileIntoChunks } from '../chunker.js';
import { generateChunkReassemblyServiceWorker } from '../serviceWorkerGenerator.js';
import type { ChunkManifest } from '../types.js';

const TEST_VIDEO_PATH = join(process.cwd(), 'video-test/video.mp4');
const TEST_OUTPUT_DIR = join(process.cwd(), '.test-sw-output');
const PORT = 3000;

/**
 * Main test function
 */
async function runLocalTest() {
  console.log('🧪 Service Worker Local Test\n');

  // Step 1: Check if video exists
  if (!existsSync(TEST_VIDEO_PATH)) {
    console.error('❌ Video file not found:', TEST_VIDEO_PATH);
    console.error('   Please ensure video-test/video.mp4 exists');
    process.exit(1);
  }

  // Step 2: Create output directory
  if (!existsSync(TEST_OUTPUT_DIR)) {
    await mkdir(TEST_OUTPUT_DIR, { recursive: true });
  }

  console.log('📹 Reading video file...');
  const videoBuffer = await readFile(TEST_VIDEO_PATH);
  const videoSize = videoBuffer.length;
  console.log(`   Size: ${(videoSize / 1024 / 1024).toFixed(2)} MB`);

  // Step 3: Chunk the video
  console.log('\n✂️  Chunking video...');
  const chunkSize = 5 * 1024 * 1024; // 5MB chunks
  const chunks = splitFileIntoChunks(videoBuffer, chunkSize);
  console.log(`   Created ${chunks.length} chunks`);

  // Step 4: Write chunks to disk and build manifest
  const chunkMetadata = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkFilename = `chunk_${i}.bin`;
    const chunkPath = join(TEST_OUTPUT_DIR, chunkFilename);

    await writeFile(chunkPath, chunk);

    const chunkHash = createHash('sha256').update(chunk).digest('hex');

    chunkMetadata.push({
      index: i,
      txid: `local_${i}`, // Mock txid
      vout: 0,
      urlPath: `/chunks/${chunkFilename}`,
      size: chunk.length,
      hash: chunkHash,
    });
  }

  // Step 5: Create chunk manifest
  const manifest: ChunkManifest = {
    version: '1.0',
    originalPath: 'video.mp4',
    mimeType: 'video/mp4',
    totalSize: videoSize,
    chunkSize: chunkSize,
    chunks: chunkMetadata,
  };

  console.log('\n📝 Generating service worker...');
  const serviceWorkerCode = generateChunkReassemblyServiceWorker(
    [manifest],
    'http://localhost:3000'
  );
  const swPath = join(TEST_OUTPUT_DIR, 'sw.js');
  await writeFile(swPath, serviceWorkerCode);
  console.log(`   Written to: ${swPath}`);

  // Step 6: Create test HTML page
  console.log('\n🌐 Generating test HTML...');
  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Service Worker Video Test</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      background: #1a1a1a;
      color: #fff;
    }
    h1 {
      color: #4a9eff;
    }
    .video-container {
      margin: 20px 0;
      background: #000;
      border-radius: 8px;
      overflow: hidden;
    }
    video {
      width: 100%;
      height: auto;
      display: block;
    }
    .info {
      background: #2a2a2a;
      padding: 15px;
      border-radius: 8px;
      margin: 20px 0;
      font-family: 'Courier New', monospace;
      font-size: 14px;
    }
    .info h3 {
      margin-top: 0;
      color: #4a9eff;
    }
    .status {
      padding: 10px;
      border-radius: 4px;
      margin: 10px 0;
    }
    .status.success {
      background: #1a4d1a;
      border-left: 4px solid #4caf50;
    }
    .status.error {
      background: #4d1a1a;
      border-left: 4px solid #f44336;
    }
    .status.info {
      background: #1a2a4d;
      border-left: 4px solid #2196f3;
    }
    .log {
      background: #0a0a0a;
      padding: 10px;
      border-radius: 4px;
      max-height: 200px;
      overflow-y: auto;
      font-size: 12px;
      line-height: 1.6;
    }
    .log-entry {
      margin: 2px 0;
    }
    .log-entry.sw {
      color: #4a9eff;
    }
    .log-entry.video {
      color: #ff9800;
    }
    .controls {
      margin: 20px 0;
    }
    button {
      background: #4a9eff;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 4px;
      cursor: pointer;
      margin-right: 10px;
      font-size: 14px;
    }
    button:hover {
      background: #357abd;
    }
    button:disabled {
      background: #666;
      cursor: not-allowed;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
      margin: 20px 0;
    }
    .metric {
      background: #2a2a2a;
      padding: 15px;
      border-radius: 8px;
    }
    .metric-value {
      font-size: 24px;
      font-weight: bold;
      color: #4a9eff;
    }
    .metric-label {
      font-size: 12px;
      color: #999;
      text-transform: uppercase;
    }
  </style>
</head>
<body>
  <h1>🎬 Service Worker Video Streaming Test</h1>

  <div class="info">
    <h3>Test Configuration</h3>
    <p><strong>Video Size:</strong> ${(videoSize / 1024 / 1024).toFixed(2)} MB</p>
    <p><strong>Chunk Size:</strong> ${(chunkSize / 1024 / 1024).toFixed(2)} MB</p>
    <p><strong>Total Chunks:</strong> ${chunks.length}</p>
    <p><strong>Service Worker:</strong> <span id="sw-status">Checking...</span></p>
  </div>

  <div class="video-container">
    <video id="test-video" controls preload="metadata">
      <source src="/video.mp4" type="video/mp4">
      Your browser doesn't support video playback.
    </video>
  </div>

  <div class="controls">
    <button onclick="testSeek(30)">Seek to 30s</button>
    <button onclick="testSeek(60)">Seek to 60s</button>
    <button onclick="clearCache()">Clear Cache</button>
    <button onclick="reloadPage()">Reload Page</button>
  </div>

  <div class="metrics">
    <div class="metric">
      <div class="metric-value" id="duration">--</div>
      <div class="metric-label">Duration (seconds)</div>
    </div>
    <div class="metric">
      <div class="metric-value" id="buffered">0%</div>
      <div class="metric-label">Buffered</div>
    </div>
    <div class="metric">
      <div class="metric-value" id="current-time">0s</div>
      <div class="metric-label">Current Time</div>
    </div>
    <div class="metric">
      <div class="metric-value" id="seek-count">0</div>
      <div class="metric-label">Seeks</div>
    </div>
  </div>

  <div class="info">
    <h3>Event Log</h3>
    <div class="log" id="event-log"></div>
  </div>

  <script>
    const video = document.getElementById('test-video');
    const eventLog = document.getElementById('event-log');
    let seekCount = 0;

    function log(message, type = 'info') {
      const entry = document.createElement('div');
      entry.className = 'log-entry ' + type;
      entry.textContent = new Date().toLocaleTimeString() + ' - ' + message;
      eventLog.insertBefore(entry, eventLog.firstChild);
      console.log(message);
    }

    // Register Service Worker
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', async () => {
        try {
          const registration = await navigator.serviceWorker.register('/sw.js');
          log('[SW] Registered: ' + registration.scope, 'sw');
          document.getElementById('sw-status').innerHTML = '<span style="color: #4caf50;">✓ Active</span>';

          // Wait for SW to be ready
          await navigator.serviceWorker.ready;
          log('[SW] Service Worker ready', 'sw');
        } catch (error) {
          log('[SW] Registration failed: ' + error.message, 'sw');
          document.getElementById('sw-status').innerHTML = '<span style="color: #f44336;">✗ Failed</span>';
        }
      });
    } else {
      document.getElementById('sw-status').innerHTML = '<span style="color: #f44336;">Not supported</span>';
    }

    // Video event listeners
    video.addEventListener('loadedmetadata', () => {
      log('[Video] Metadata loaded: ' + video.videoWidth + 'x' + video.videoHeight + ', ' + video.duration.toFixed(2) + 's', 'video');
      document.getElementById('duration').textContent = video.duration.toFixed(2);
    });

    video.addEventListener('loadstart', () => {
      log('[Video] Load started', 'video');
    });

    video.addEventListener('canplay', () => {
      log('[Video] Can play', 'video');
    });

    video.addEventListener('play', () => {
      log('[Video] Playing...', 'video');
    });

    video.addEventListener('pause', () => {
      log('[Video] Paused', 'video');
    });

    video.addEventListener('seeking', () => {
      log('[Video] Seeking to: ' + video.currentTime.toFixed(2) + 's', 'video');
      seekCount++;
      document.getElementById('seek-count').textContent = seekCount;
    });

    video.addEventListener('seeked', () => {
      log('[Video] Seek complete', 'video');
    });

    video.addEventListener('timeupdate', () => {
      document.getElementById('current-time').textContent = video.currentTime.toFixed(1) + 's';

      // Update buffered percentage
      if (video.buffered.length > 0) {
        const bufferedEnd = video.buffered.end(video.buffered.length - 1);
        const percent = (bufferedEnd / video.duration * 100).toFixed(1);
        document.getElementById('buffered').textContent = percent + '%';
      }
    });

    video.addEventListener('error', (e) => {
      log('[Video] Error: ' + (video.error ? video.error.message : 'Unknown'), 'video');
    });

    // Test functions
    function testSeek(seconds) {
      if (video.duration && seconds < video.duration) {
        video.currentTime = seconds;
        log('[Test] Seeking to ' + seconds + 's', 'info');
      } else {
        log('[Test] Cannot seek to ' + seconds + 's (duration: ' + video.duration + 's)', 'info');
      }
    }

    async function clearCache() {
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        for (const name of cacheNames) {
          await caches.delete(name);
          log('[Test] Cleared cache: ' + name, 'info');
        }
        log('[Test] All caches cleared', 'info');
      }
    }

    function reloadPage() {
      location.reload();
    }

    // Listen for SW messages
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        log('[SW] Message: ' + JSON.stringify(event.data), 'sw');
      });
    }
  </script>
</body>
</html>`;

  const htmlPath = join(TEST_OUTPUT_DIR, 'test-video.html');
  await writeFile(htmlPath, htmlContent);
  console.log(`   Written to: ${htmlPath}`);

  // Step 7: Start local server
  console.log('\n🚀 Starting test server...\n');
  startTestServer();
}

/**
 * Creates a simple HTTP server to serve the test files
 */
function startTestServer() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);
    const pathname = url.pathname;

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    try {
      // Route: Service Worker
      if (pathname === '/sw.js') {
        const swCode = await readFile(join(TEST_OUTPUT_DIR, 'sw.js'), 'utf-8');
        res.writeHead(200, {
          'Content-Type': 'application/javascript',
          'Service-Worker-Allowed': '/',
        });
        res.end(swCode);
        return;
      }

      // Route: Test HTML page
      if (pathname === '/' || pathname === '/test-video.html') {
        const html = await readFile(join(TEST_OUTPUT_DIR, 'test-video.html'), 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
        return;
      }

      // Route: Video file (will be intercepted by SW)
      if (pathname === '/video.mp4') {
        // This should be intercepted by the service worker
        // But if not registered yet, serve the original
        const videoBuffer = await readFile(TEST_VIDEO_PATH);
        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Accept-Ranges': 'bytes',
          'Content-Length': videoBuffer.length,
        });
        res.end(videoBuffer);
        return;
      }

      // Route: Chunks
      if (pathname.startsWith('/chunks/')) {
        const chunkFilename = pathname.replace('/chunks/', '');
        const chunkPath = join(TEST_OUTPUT_DIR, chunkFilename);

        if (existsSync(chunkPath)) {
          const chunkBuffer = await readFile(chunkPath);
          res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Cache-Control': 'public, max-age=31536000',
          });
          res.end(chunkBuffer);
          return;
        }
      }

      // 404
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    } catch (error) {
      console.error('Server error:', error);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  });

  server.listen(PORT, () => {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  ✅ Test server running!');
    console.log('');
    console.log('  🌐 Open in browser: \x1b[36mhttp://localhost:3000/test-video.html\x1b[0m');
    console.log('');
    console.log('  What to test:');
    console.log('    1. Video should load and play instantly');
    console.log('    2. Seeking should be smooth (no pauses)');
    console.log('    3. Check DevTools → Network for proper 206 responses');
    console.log('    4. Check DevTools → Application → Cache Storage');
    console.log('');
    console.log('  Press Ctrl+C to stop');
    console.log('═══════════════════════════════════════════════════════════════\n');
  });

  // Handle shutdown
  process.on('SIGINT', () => {
    console.log('\n\n👋 Shutting down test server...');
    server.close();
    process.exit(0);
  });
}

// Run the test
runLocalTest().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
