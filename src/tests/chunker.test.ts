import { describe, it } from 'node:test';
import assert from 'node:assert';
import { shouldChunkFile, splitFileIntoChunks, createChunkManifest } from '../chunker.js';
import type { InscribedFile } from '../types.js';
import {
  PROGRESSIVE_VIDEO_CHUNK_SIZES,
  PROGRESSIVE_VIDEO_MAX_CHUNK_SIZE,
} from '../utils/constants.js';

describe('Chunker Module', () => {
  describe('shouldChunkFile', () => {
    const DEFAULT_THRESHOLD = 5 * 1024 * 1024; // 5MB

    it('should chunk files exceeding threshold', () => {
      const fileSize = 6 * 1024 * 1024; // 6MB
      const result = shouldChunkFile(fileSize, '/assets/video.mp4', DEFAULT_THRESHOLD);
      assert.strictEqual(result, true);
    });

    it('should not chunk files below threshold', () => {
      const fileSize = 2 * 1024 * 1024; // 2MB
      const result = shouldChunkFile(fileSize, '/assets/image.png', DEFAULT_THRESHOLD);
      assert.strictEqual(result, false);
    });

    it('should not chunk files exactly at threshold', () => {
      const fileSize = DEFAULT_THRESHOLD;
      const result = shouldChunkFile(fileSize, '/assets/data.json', DEFAULT_THRESHOLD);
      assert.strictEqual(result, false);
    });

    it('should never chunk index.html regardless of size', () => {
      const largeSize = 10 * 1024 * 1024; // 10MB

      assert.strictEqual(shouldChunkFile(largeSize, 'index.html', DEFAULT_THRESHOLD), false);
      assert.strictEqual(shouldChunkFile(largeSize, '/index.html', DEFAULT_THRESHOLD), false);
      assert.strictEqual(shouldChunkFile(largeSize, 'public/index.html', DEFAULT_THRESHOLD), false);
    });

    it('should respect custom threshold', () => {
      const fileSize = 2 * 1024 * 1024; // 2MB
      const customThreshold = 1 * 1024 * 1024; // 1MB

      assert.strictEqual(shouldChunkFile(fileSize, '/video.mp4', customThreshold), true);
      assert.strictEqual(shouldChunkFile(fileSize, '/video.mp4', DEFAULT_THRESHOLD), false);
    });

    it('should handle edge case of 0 byte files', () => {
      assert.strictEqual(shouldChunkFile(0, '/empty.txt', DEFAULT_THRESHOLD), false);
    });

    it('should handle very large files', () => {
      const veryLarge = 100 * 1024 * 1024; // 100MB
      assert.strictEqual(shouldChunkFile(veryLarge, '/large-video.mp4', DEFAULT_THRESHOLD), true);
    });
  });

  describe('splitFileIntoChunks', () => {
    const DEFAULT_CHUNK_SIZE = 10 * 1024 * 1024; // 10MB

    it('should split buffer into equal chunks', () => {
      const size = 10 * 1024; // 10KB
      const chunkSize = 4 * 1024; // 4KB
      const buffer = Buffer.alloc(size);

      // Fill with identifiable data
      for (let i = 0; i < size; i++) {
        buffer[i] = i % 256;
      }

      const chunks = splitFileIntoChunks(buffer, chunkSize);

      assert.strictEqual(chunks.length, 3); // 4KB + 4KB + 2KB
      assert.strictEqual(chunks[0].length, 4096);
      assert.strictEqual(chunks[1].length, 4096);
      assert.strictEqual(chunks[2].length, 2048);

      // Verify data integrity
      assert.strictEqual(chunks[0][0], 0);
      assert.strictEqual(chunks[1][0], 4096 % 256);
      assert.strictEqual(chunks[2][0], 8192 % 256);
    });

    it('should handle buffer smaller than chunk size', () => {
      const buffer = Buffer.from('small data');
      const chunks = splitFileIntoChunks(buffer, 1024);

      assert.strictEqual(chunks.length, 1);
      assert.strictEqual(chunks[0].length, 10);
      assert.strictEqual(chunks[0].toString(), 'small data');
    });

    it('should handle buffer exactly equal to chunk size', () => {
      const chunkSize = 1024;
      const buffer = Buffer.alloc(chunkSize);
      const chunks = splitFileIntoChunks(buffer, chunkSize);

      assert.strictEqual(chunks.length, 1);
      assert.strictEqual(chunks[0].length, chunkSize);
    });

    it('should handle empty buffer', () => {
      const buffer = Buffer.alloc(0);
      const chunks = splitFileIntoChunks(buffer, 1024);

      assert.strictEqual(chunks.length, 0);
    });

    it('should split large buffer into multiple chunks', () => {
      const size = 10 * 1024 * 1024; // 10MB
      const chunkSize = 5 * 1024 * 1024; // 5MB
      const buffer = Buffer.alloc(size);

      const chunks = splitFileIntoChunks(buffer, chunkSize);

      assert.strictEqual(chunks.length, 2); // 5MB + 5MB
      assert.strictEqual(chunks[0].length, chunkSize);
      assert.strictEqual(chunks[1].length, chunkSize);
    });

    it('should maintain data integrity across chunks', () => {
      const buffer = Buffer.from('Hello World! This is a test.');
      const chunks = splitFileIntoChunks(buffer, 10);

      // Reassemble
      const reassembled = Buffer.concat(chunks);

      assert.strictEqual(reassembled.toString(), 'Hello World! This is a test.');
      assert.strictEqual(reassembled.length, buffer.length);
    });

    it('should use default chunk size when not specified', () => {
      const size = 20 * 1024 * 1024; // 20MB (larger than default 10MB chunk size)
      const buffer = Buffer.alloc(size);

      const chunks = splitFileIntoChunks(buffer);

      // Without filePath, uses uniform chunking with default 10MB chunks
      assert.strictEqual(chunks.length, 2);
      assert.strictEqual(chunks[0].length, DEFAULT_CHUNK_SIZE);
      assert.strictEqual(chunks[1].length, DEFAULT_CHUNK_SIZE);
    });
  });

  describe('createChunkManifest', () => {
    it('should create valid chunk manifest', () => {
      const chunkInscriptions: InscribedFile[] = [
        {
          originalPath: 'video.mp4.chunk0',
          txid: 'abc123',
          vout: 0,
          urlPath: '/content/abc123_0',
          size: 5242880,
          contentHash: 'hash0',
        },
        {
          originalPath: 'video.mp4.chunk1',
          txid: 'def456',
          vout: 0,
          urlPath: '/content/def456_0',
          size: 5242880,
          contentHash: 'hash1',
        },
      ];

      const manifest = createChunkManifest(
        '/assets/video.mp4',
        'video/mp4',
        10485760,
        5242880,
        chunkInscriptions
      );

      assert.strictEqual(manifest.version, '1.0');
      assert.strictEqual(manifest.originalPath, '/assets/video.mp4');
      assert.strictEqual(manifest.mimeType, 'video/mp4');
      assert.strictEqual(manifest.totalSize, 10485760);
      assert.strictEqual(manifest.chunkSize, 5242880);
      assert.strictEqual(manifest.chunks.length, 2);

      // Verify chunk metadata
      assert.deepStrictEqual(manifest.chunks[0], {
        index: 0,
        txid: 'abc123',
        vout: 0,
        urlPath: '/content/abc123_0',
        size: 5242880,
        hash: 'hash0',
      });

      assert.deepStrictEqual(manifest.chunks[1], {
        index: 1,
        txid: 'def456',
        vout: 0,
        urlPath: '/content/def456_0',
        size: 5242880,
        hash: 'hash1',
      });
    });

    it('should create manifest for single chunk file', () => {
      const chunkInscriptions: InscribedFile[] = [
        {
          originalPath: 'data.bin.chunk0',
          txid: 'single123',
          vout: 0,
          urlPath: '/content/single123_0',
          size: 6000000,
          contentHash: 'singlehash',
        },
      ];

      const manifest = createChunkManifest(
        'data.bin',
        'application/octet-stream',
        6000000,
        5242880,
        chunkInscriptions
      );

      assert.strictEqual(manifest.chunks.length, 1);
      assert.strictEqual(manifest.chunks[0].index, 0);
      assert.strictEqual(manifest.totalSize, 6000000);
    });

    it('should preserve chunk order by index', () => {
      const chunkInscriptions: InscribedFile[] = [
        {
          originalPath: 'file.chunk0',
          txid: 'c',
          vout: 0,
          urlPath: '/content/c_0',
          size: 100,
          contentHash: 'h2',
        },
        {
          originalPath: 'file.chunk1',
          txid: 'a',
          vout: 0,
          urlPath: '/content/a_0',
          size: 100,
          contentHash: 'h0',
        },
        {
          originalPath: 'file.chunk2',
          txid: 'b',
          vout: 0,
          urlPath: '/content/b_0',
          size: 100,
          contentHash: 'h1',
        },
      ];

      const manifest = createChunkManifest(
        'file.dat',
        'application/octet-stream',
        300,
        100,
        chunkInscriptions
      );

      // Should maintain order based on array index
      assert.strictEqual(manifest.chunks[0].index, 0);
      assert.strictEqual(manifest.chunks[1].index, 1);
      assert.strictEqual(manifest.chunks[2].index, 2);
      assert.strictEqual(manifest.chunks[0].txid, 'c');
      assert.strictEqual(manifest.chunks[1].txid, 'a');
      assert.strictEqual(manifest.chunks[2].txid, 'b');
    });

    it('should handle various MIME types', () => {
      const chunkInscriptions: InscribedFile[] = [
        {
          originalPath: 'test.chunk0',
          txid: 'tx1',
          vout: 0,
          urlPath: '/content/tx1_0',
          size: 1000,
          contentHash: 'hash',
        },
      ];

      const mimeTypes = [
        'video/mp4',
        'image/png',
        'application/pdf',
        'audio/mpeg',
        'application/octet-stream',
      ];

      mimeTypes.forEach((mimeType) => {
        const manifest = createChunkManifest('test.file', mimeType, 1000, 1000, chunkInscriptions);
        assert.strictEqual(manifest.mimeType, mimeType);
      });
    });
  });

  describe('Integration: chunking workflow', () => {
    it('should correctly determine chunking for typical file sizes', () => {
      const testCases = [
        { size: 500 * 1024, shouldChunk: false, name: '500KB image' },
        { size: 2 * 1024 * 1024, shouldChunk: false, name: '2MB document' },
        { size: 5 * 1024 * 1024, shouldChunk: false, name: '5MB at threshold' },
        { size: 6 * 1024 * 1024, shouldChunk: true, name: '6MB video' },
        { size: 10 * 1024 * 1024, shouldChunk: true, name: '10MB video' },
        { size: 50 * 1024 * 1024, shouldChunk: true, name: '50MB archive' },
      ];

      testCases.forEach(({ size, shouldChunk, name }) => {
        const result = shouldChunkFile(size, `/assets/${name}`, 5 * 1024 * 1024);
        assert.strictEqual(result, shouldChunk);
      });
    });

    it('should split and reassemble data correctly', () => {
      // Create test data
      const originalData = Buffer.alloc(10 * 1024 * 1024); // 10MB
      for (let i = 0; i < originalData.length; i++) {
        originalData[i] = i % 256;
      }

      // Split into chunks
      const chunkSize = 5 * 1024 * 1024;
      const chunks = splitFileIntoChunks(originalData, chunkSize);

      // Verify chunk count
      assert.ok(chunks.length > 1);

      // Reassemble
      const reassembled = Buffer.concat(chunks);

      // Verify integrity
      assert.strictEqual(reassembled.length, originalData.length);
      assert.strictEqual(reassembled.equals(originalData), true);

      // Verify each byte
      for (let i = 0; i < originalData.length; i++) {
        assert.strictEqual(reassembled[i], originalData[i]);
      }
    });

    it('should create manifest that matches chunk count', () => {
      const fileSize = 15 * 1024 * 1024; // 15MB
      const chunkSize = 5 * 1024 * 1024; // 5MB
      const buffer = Buffer.alloc(fileSize);

      const chunks = splitFileIntoChunks(buffer, chunkSize);

      // Simulate chunk inscriptions
      const chunkInscriptions: InscribedFile[] = chunks.map((chunk, index) => ({
        originalPath: `large.bin.chunk${index}`,
        txid: `tx${index}`,
        vout: 0,
        urlPath: `/content/tx${index}_0`,
        size: chunk.length,
        contentHash: `hash${index}`,
      }));

      const manifest = createChunkManifest(
        'large.bin',
        'application/octet-stream',
        fileSize,
        chunkSize,
        chunkInscriptions
      );

      assert.strictEqual(manifest.chunks.length, chunks.length);
      assert.strictEqual(manifest.chunks.length, chunkInscriptions.length);

      // Verify total size matches
      const totalChunkSize = manifest.chunks.reduce((sum, chunk) => sum + chunk.size, 0);
      assert.strictEqual(totalChunkSize, fileSize);
    });
  });

  describe('Progressive chunking for video files', () => {
    const MB = 1024 * 1024;

    it('should use progressive chunk sizes for video files', () => {
      const videoExtensions = ['.mp4', '.mov', '.webm', '.avi', '.mkv', '.m4v'];

      videoExtensions.forEach((ext) => {
        const buffer = Buffer.alloc(30 * MB); // 30MB video
        const chunks = splitFileIntoChunks(buffer, 10 * MB, `/video${ext}`);

        // Progressive pattern: 1 + 1 + 2 + 3 + 5 = 12MB, then 5MB chunks for remaining 18MB = 3.6 chunks (4 chunks)
        // Total: 1 + 1 + 2 + 3 + 5 + 5 + 5 + 5 + 3 = 30MB (9 chunks)
        assert.strictEqual(chunks.length, 9, `Should have 9 chunks for ${ext}`);
        assert.strictEqual(chunks[0].length, 1 * MB, `First chunk should be 1MB for ${ext}`);
        assert.strictEqual(chunks[1].length, 1 * MB, `Second chunk should be 1MB for ${ext}`);
        assert.strictEqual(chunks[2].length, 2 * MB, `Third chunk should be 2MB for ${ext}`);
        assert.strictEqual(chunks[3].length, 3 * MB, `Fourth chunk should be 3MB for ${ext}`);
        assert.strictEqual(chunks[4].length, 5 * MB, `Fifth chunk should be 5MB for ${ext}`);
        assert.strictEqual(chunks[5].length, 5 * MB, `Sixth chunk should be 5MB for ${ext}`);
        assert.strictEqual(chunks[6].length, 5 * MB, `Seventh chunk should be 5MB for ${ext}`);
        assert.strictEqual(chunks[7].length, 5 * MB, `Eighth chunk should be 5MB for ${ext}`);
        assert.strictEqual(
          chunks[8].length,
          3 * MB,
          `Ninth chunk should be 3MB (remaining) for ${ext}`
        );
      });
    });

    it('should use 5MB chunks after progressive pattern for large videos', () => {
      const buffer = Buffer.alloc(50 * MB); // 50MB video
      const chunks = splitFileIntoChunks(buffer, 10 * MB, '/video.mp4');

      // Calculate expected: 1 + 1 + 2 + 3 + 5 = 12MB for first 5 chunks
      // Remaining: 50 - 12 = 38MB should be 7x5MB + 3MB = 8 more chunks
      // Total: 13 chunks
      assert.strictEqual(chunks.length, 13);

      // Verify progressive sizes for first 5 chunks
      assert.strictEqual(chunks[0].length, 1 * MB);
      assert.strictEqual(chunks[1].length, 1 * MB);
      assert.strictEqual(chunks[2].length, 2 * MB);
      assert.strictEqual(chunks[3].length, 3 * MB);
      assert.strictEqual(chunks[4].length, 5 * MB); // Reached max

      // After progressive pattern, remaining chunks should be 5MB
      assert.strictEqual(chunks[5].length, 5 * MB);
      assert.strictEqual(chunks[6].length, 5 * MB);
      assert.strictEqual(chunks[7].length, 5 * MB);
      assert.strictEqual(chunks[8].length, 5 * MB);
      assert.strictEqual(chunks[9].length, 5 * MB);
      assert.strictEqual(chunks[10].length, 5 * MB);
      assert.strictEqual(chunks[11].length, 5 * MB);
      assert.strictEqual(chunks[12].length, 3 * MB); // Remaining
    });

    it('should handle small video files with progressive chunking', () => {
      // 2MB video - should fit in first two 1MB chunks
      const buffer = Buffer.alloc(2 * MB);
      const chunks = splitFileIntoChunks(buffer, 10 * MB, '/small-video.mp4');

      assert.strictEqual(chunks.length, 2);
      assert.strictEqual(chunks[0].length, 1 * MB);
      assert.strictEqual(chunks[1].length, 1 * MB);
    });

    it('should handle video files smaller than first chunk size', () => {
      const buffer = Buffer.alloc(512 * 1024); // 512KB
      const chunks = splitFileIntoChunks(buffer, 10 * MB, '/tiny-video.mp4');

      assert.strictEqual(chunks.length, 1);
      assert.strictEqual(chunks[0].length, 512 * 1024);
    });

    it('should use uniform chunking for non-video files', () => {
      const buffer = Buffer.alloc(30 * MB);
      const chunkSize = 10 * MB;
      const chunks = splitFileIntoChunks(buffer, chunkSize, '/large-image.png');

      // Should use uniform 10MB chunks
      assert.strictEqual(chunks.length, 3);
      assert.strictEqual(chunks[0].length, 10 * MB);
      assert.strictEqual(chunks[1].length, 10 * MB);
      assert.strictEqual(chunks[2].length, 10 * MB);
    });

    it('should preserve video data integrity with progressive chunking', () => {
      const originalData = Buffer.alloc(20 * MB);

      // Fill with test pattern
      for (let i = 0; i < originalData.length; i++) {
        originalData[i] = i % 256;
      }

      const chunks = splitFileIntoChunks(originalData, 10 * MB, '/test-video.mp4');
      const reassembled = Buffer.concat(chunks);

      assert.strictEqual(reassembled.length, originalData.length);
      assert.strictEqual(reassembled.equals(originalData), true);
    });

    it('should handle case-insensitive video file extensions', () => {
      const buffer = Buffer.alloc(5 * MB);

      const upperCaseChunks = splitFileIntoChunks(buffer, 10 * MB, '/VIDEO.MP4');
      const lowerCaseChunks = splitFileIntoChunks(buffer, 10 * MB, '/video.mp4');
      const mixedCaseChunks = splitFileIntoChunks(buffer, 10 * MB, '/Video.Mp4');

      // All should use progressive chunking
      assert.strictEqual(upperCaseChunks.length, lowerCaseChunks.length);
      assert.strictEqual(lowerCaseChunks.length, mixedCaseChunks.length);
      assert.strictEqual(upperCaseChunks[0].length, 1 * MB);
      assert.strictEqual(lowerCaseChunks[0].length, 1 * MB);
      assert.strictEqual(mixedCaseChunks[0].length, 1 * MB);
    });

    it('should handle undefined filePath gracefully', () => {
      const buffer = Buffer.alloc(10 * MB);
      const chunks = splitFileIntoChunks(buffer, 5 * MB, undefined);

      // Should use uniform chunking when filePath is undefined
      assert.strictEqual(chunks.length, 2);
      assert.strictEqual(chunks[0].length, 5 * MB);
      assert.strictEqual(chunks[1].length, 5 * MB);
    });

    it('should create correct manifest for progressive video chunks', () => {
      const buffer = Buffer.alloc(15 * MB);
      const chunks = splitFileIntoChunks(buffer, 10 * MB, '/video.mp4');

      // Simulate inscriptions with actual chunk sizes
      const chunkInscriptions: InscribedFile[] = chunks.map((chunk, index) => ({
        originalPath: `video.mp4.chunk${index}`,
        txid: `tx${index}`,
        vout: 0,
        urlPath: `/content/tx${index}_0`,
        size: chunk.length, // Actual chunk size (progressive)
        contentHash: `hash${index}`,
      }));

      const manifest = createChunkManifest(
        '/video.mp4',
        'video/mp4',
        15 * MB,
        10 * MB, // Max chunk size
        chunkInscriptions
      );

      // Verify manifest chunks have correct individual sizes
      assert.strictEqual(manifest.chunks[0].size, 1 * MB);
      assert.strictEqual(manifest.chunks[1].size, 1 * MB);
      assert.strictEqual(manifest.chunks[2].size, 2 * MB);
      assert.strictEqual(manifest.chunks[3].size, 3 * MB);
      assert.strictEqual(manifest.chunks[4].size, 5 * MB);
      assert.strictEqual(manifest.chunks[5].size, 3 * MB); // Remaining

      // Verify total size
      const totalSize = manifest.chunks.reduce((sum, chunk) => sum + chunk.size, 0);
      assert.strictEqual(totalSize, 15 * MB);
    });
  });

  describe('Edge cases', () => {
    it('should handle files just above threshold', () => {
      const threshold = 5 * 1024 * 1024;
      const fileSize = threshold + 1;

      assert.strictEqual(shouldChunkFile(fileSize, '/video.mp4', threshold), true);
    });

    it('should handle files just below threshold', () => {
      const threshold = 5 * 1024 * 1024;
      const fileSize = threshold - 1;

      assert.strictEqual(shouldChunkFile(fileSize, '/video.mp4', threshold), false);
    });

    it('should handle maximum safe integer file size', () => {
      const maxSize = Number.MAX_SAFE_INTEGER;

      // Should still chunk (though impractical)
      assert.strictEqual(shouldChunkFile(maxSize, '/huge.bin', 5 * 1024 * 1024), true);
    });

    it('should handle chunk size of 1 byte', () => {
      const buffer = Buffer.from('test');
      const chunks = splitFileIntoChunks(buffer, 1);

      assert.strictEqual(chunks.length, 4);
      assert.strictEqual(chunks[0].toString(), 't');
      assert.strictEqual(chunks[1].toString(), 'e');
      assert.strictEqual(chunks[2].toString(), 's');
      assert.strictEqual(chunks[3].toString(), 't');
    });

    it('should handle various index.html path formats', () => {
      const largeSize = 10 * 1024 * 1024;
      const threshold = 5 * 1024 * 1024;

      const indexPaths = [
        'index.html',
        '/index.html',
        './index.html',
        'public/index.html',
        '/public/index.html',
        'dist/index.html',
        '/dist/index.html',
      ];

      indexPaths.forEach((path) => {
        assert.strictEqual(shouldChunkFile(largeSize, path, threshold), false);
      });
    });
  });
});
