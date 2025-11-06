/**
 * HTML Inscription Orchestration
 *
 * Handles the inscription of index.html as a 1-sat ordinal chain,
 * similar to the versioning inscription pattern.
 *
 * Key features:
 * - First deployment: Creates initial HTML ordinal using createOrdinals
 * - Subsequent deployments: Spends previous HTML UTXO using sendOrdinals
 * - Supports :-1 resolution for always fetching latest HTML
 *
 * Extracted from orchestrator.ts for better maintainability.
 */

import { readFile } from 'fs/promises';
import { createHash } from 'crypto';
import { PrivateKey } from '@bsv/sdk';
import { createOrdinals, sendOrdinals, type SendOrdinalsConfig } from 'js-1sat-ord';
import type { FileReference, DependencyNode } from '../analysis/index.js';
import type { IndexerService } from '../../lib/service-providers/IndexerService.js';
import type { InscribedFile } from '../inscription/inscription.types.js';
import type { OrchestratorCallbacks } from '../orchestration/orchestration.types.js';
import {
  rewriteFile,
  injectVersionScript,
  injectBasePathFix,
  injectWebpackPublicPathFix,
  injectBannerComment,
  minifyScript,
} from '../rewriting/index.js';
import { generateServiceWorkerRegistration } from '../service-worker/generator.js';
import { isIndexHtmlFile, extractOutpointFromFile } from '../inscription/utils.js';
import { retryWithBackoff, shouldRetryError } from '../../utils/retry.js';
import { formatError } from '../../utils/errors.js';
import { CONTENT_PATH } from '../../lib/service-providers/gorilla-pool/constants.js';
import { DEFAULT_SATS_PER_KB, CONTENT_PATH_PREFIX } from '../../utils/constants.js';

/**
 * Result of HTML inscription
 */
export interface HtmlInscriptionResult {
  entryPoint: InscribedFile;
  finalHtmlOriginInscription: string;
  txid?: string;
}

/**
 * Prepares HTML content with all necessary rewrites and script injections
 *
 * @param fileRef - File reference from analysis
 * @param filePath - Relative file path
 * @param buildDir - Build directory
 * @param urlMap - URL mapping for dependencies
 * @param versioningOriginInscription - Optional versioning origin for version script
 * @param serviceWorkerUrl - Optional service worker URL for SW registration
 * @returns Prepared HTML content as Buffer
 */
export async function prepareHtmlContent(
  fileRef: FileReference,
  filePath: string,
  buildDir: string,
  urlMap: Map<string, string>,
  versioningOriginInscription?: string,
  serviceWorkerUrl?: string
): Promise<Buffer> {
  let content: Buffer;

  // Check if file has dependencies that need rewriting
  if (fileRef.dependencies.length > 0) {
    content = await rewriteFile(
      fileRef.absolutePath,
      buildDir,
      filePath,
      fileRef.contentType,
      urlMap
    );
  } else {
    content = await readFile(fileRef.absolutePath);
  }

  // Special handling for index.html
  if (isIndexHtmlFile(filePath)) {
    let htmlContent = content.toString('utf-8');

    // Inject banner comment (at the very top)
    htmlContent = injectBannerComment(htmlContent);

    // Inject webpack public path fix (MUST run FIRST, before any webpack bundles load)
    htmlContent = await injectWebpackPublicPathFix(htmlContent);

    // Inject base path fix script (MUST run before React loads)
    htmlContent = await injectBasePathFix(htmlContent);

    // Inject version script if inscription origin is known
    if (versioningOriginInscription) {
      htmlContent = await injectVersionScript(htmlContent, versioningOriginInscription);
    }

    // Inject Service Worker registration if SW URL is provided
    // Must be in <head> so window.swReady is available before body scripts execute
    if (serviceWorkerUrl) {
      const swRegistration = generateServiceWorkerRegistration(serviceWorkerUrl);

      // Extract script content (between <script> tags) and minify it
      const scriptMatch = swRegistration.match(/<script>([\s\S]*)<\/script>/);
      if (scriptMatch) {
        const scriptContent = scriptMatch[1];
        const minified = minifyScript(scriptContent);
        const minifiedScript = `\n<script>${minified}</script>\n`;

        // Inject before closing </head> tag, or before </body> if no head
        if (htmlContent.includes('</head>')) {
          htmlContent = htmlContent.replace('</head>', `${minifiedScript}</head>`);
        } else if (htmlContent.includes('</body>')) {
          htmlContent = htmlContent.replace('</body>', `${minifiedScript}</body>`);
        } else if (htmlContent.includes('</html>')) {
          htmlContent = htmlContent.replace('</html>', `${minifiedScript}</html>`);
        } else {
          // Fallback: append at end
          htmlContent += minifiedScript;
        }
      }
    }

    content = Buffer.from(htmlContent, 'utf-8');
  }

  return content;
}

/**
 * Creates the initial HTML ordinal inscription (first deployment)
 *
 * @param htmlContent - Prepared HTML content
 * @param paymentKey - Private key for paying transaction fees
 * @param indexer - Indexer service for broadcasting transaction
 * @param destinationAddress - Destination address for the inscription
 * @param satsPerKb - Satoshis per KB for fees
 * @returns Inscribed file with origin outpoint
 */
export async function createInitialHtmlOrdinal(
  htmlContent: Buffer,
  paymentKey: PrivateKey,
  indexer: IndexerService,
  destinationAddress: string,
  satsPerKb: number
): Promise<InscribedFile> {
  try {
    const result = await retryWithBackoff(
      async () => {
        // Get payment address from key
        const paymentAddress = paymentKey.toAddress().toString();

        // Fetch payment UTXOs
        const paymentUtxos = await indexer.listUnspentPaymentUtxos(paymentAddress);

        if (paymentUtxos.length === 0) {
          throw new Error(
            `No spendable UTXOs found for payment address: ${paymentAddress}. Fund this address first.`
          );
        }

        // Create the inscription transaction
        const ordResult = await createOrdinals({
          utxos: paymentUtxos,
          destinations: [
            {
              address: destinationAddress,
              inscription: {
                dataB64: htmlContent.toString('base64'),
                contentType: 'text/html',
              },
            },
          ],
          paymentPk: paymentKey,
          changeAddress: paymentAddress,
          satsPerKb,
        });

        // Broadcast the transaction
        const txid = await indexer.broadcastTransaction(ordResult.tx.toHex());

        // Calculate content hash
        const contentHash = createHash('sha256').update(htmlContent).digest('hex');

        // Return the inscription details
        return {
          originalPath: 'index.html',
          txid,
          vout: 0,
          urlPath: `${CONTENT_PATH}/${txid}_0`,
          size: htmlContent.length,
          contentHash,
        };
      },
      {
        maxAttempts: 5,
        initialDelayMs: 3000,
        maxDelayMs: 60000,
      },
      shouldRetryError
    );

    return result;
  } catch (error) {
    console.error('❌ Failed to create initial HTML ordinal:', error);
    throw new Error(`Initial HTML ordinal creation failed: ${formatError(error)}`);
  }
}

/**
 * Updates the HTML ordinal by spending the previous HTML UTXO (subsequent deployments)
 *
 * @param htmlOriginInscription - The origin outpoint of the HTML inscription chain
 * @param htmlContent - Prepared HTML content for this deployment
 * @param paymentKey - Private key for paying transaction fees
 * @param ordPk - Private key that owns the HTML ordinal (usually same as paymentKey)
 * @param indexer - Indexer service for fetching UTXO and broadcasting
 * @param destinationAddress - Destination address for the inscription
 * @param satsPerKb - Satoshis per KB for fees
 * @returns Inscribed file with new outpoint
 */
export async function updateHtmlOrdinal(
  htmlOriginInscription: string,
  htmlContent: Buffer,
  paymentKey: PrivateKey,
  ordPk: PrivateKey,
  indexer: IndexerService,
  destinationAddress: string,
  satsPerKb: number
): Promise<InscribedFile> {
  try {
    const result = await retryWithBackoff(
      async () => {
        // Fetch the latest HTML UTXO from the chain
        const { utxo } = await indexer.fetchLatestFromOrigin(htmlOriginInscription, {
          includeUtxo: true,
          includeMap: false, // HTML doesn't have metadata
        });

        if (!utxo) {
          throw new Error(
            `Could not find HTML inscription UTXO at origin: ${htmlOriginInscription}`
          );
        }

        // Get payment address
        const paymentAddress = paymentKey.toAddress().toString();

        // Validate that ordPk can unlock the HTML inscription
        const ordinalAddress = ordPk.toAddress().toString();
        if (ordinalAddress !== destinationAddress) {
          throw new Error(
            `Cannot update HTML inscription: ordinal key mismatch.\n` +
              `  The HTML inscription is controlled by: ${destinationAddress}\n` +
              `  Your payment key address is: ${ordinalAddress}\n` +
              `  Solution: Use the same payment key as the original deployment.`
          );
        }

        // Fetch payment UTXOs
        const paymentUtxos = await indexer.listUnspentPaymentUtxos(paymentAddress);

        if (paymentUtxos.length === 0) {
          throw new Error(
            `No spendable UTXOs found for payment address: ${paymentAddress}. Fund this address first.`
          );
        }

        // Prepare sendOrdinals configuration
        const ordData: SendOrdinalsConfig = {
          ordinals: [utxo], // Spend the previous HTML inscription
          destinations: [
            {
              address: destinationAddress,
              inscription: {
                dataB64: htmlContent.toString('base64'),
                contentType: 'text/html',
              },
            },
          ],
          paymentPk: paymentKey,
          ordPk: ordPk,
          paymentUtxos,
          changeAddress: paymentAddress,
          satsPerKb,
        };

        // Create transaction spending the previous inscription
        const ordResult = await sendOrdinals(ordData);

        // Broadcast transaction
        const txid = await indexer.broadcastTransaction(ordResult.tx.toHex());

        // Calculate content hash
        const contentHash = createHash('sha256').update(htmlContent).digest('hex');

        // Return new inscription outpoint
        return {
          originalPath: 'index.html',
          txid,
          vout: 0,
          urlPath: `${CONTENT_PATH}/${txid}_0`,
          size: htmlContent.length,
          contentHash,
        };
      },
      {
        maxAttempts: 5,
        initialDelayMs: 3000,
        maxDelayMs: 60000,
      },
      shouldRetryError
    );

    return result;
  } catch (error) {
    console.error('❌ Failed to update HTML ordinal:', error);
    throw new Error(`HTML ordinal update failed: ${formatError(error)}`);
  }
}

/**
 * Handles HTML inscription orchestration
 *
 * Determines whether to create a new HTML origin or update an existing one,
 * prepares the content, and performs the inscription.
 *
 * @param htmlFiles - List of HTML file paths (should contain only index.html)
 * @param graph - Dependency graph
 * @param buildDir - Build directory
 * @param urlMap - URL mapping for dependencies
 * @param finalVersioningOriginInscription - Versioning origin inscription
 * @param serviceWorkerUrl - Optional service worker URL
 * @param htmlOriginInscription - Existing HTML origin (undefined for first deployment)
 * @param paymentPk - Private key for payment
 * @param indexer - Indexer service
 * @param destinationAddress - Destination address
 * @param satsPerKb - Satoshis per KB for fees
 * @param dryRun - Whether this is a dry run
 * @param version - Version string (for dry run mock txid)
 * @param callbacks - Optional progress callbacks
 * @returns HTML inscription result
 */
export async function handleHtmlInscription(
  htmlFiles: string[],
  graph: Map<string, DependencyNode>,
  buildDir: string,
  urlMap: Map<string, string>,
  finalVersioningOriginInscription: string | undefined,
  serviceWorkerUrl: string | undefined,
  htmlOriginInscription: string | undefined,
  paymentPk: PrivateKey,
  indexer: IndexerService,
  destinationAddress: string,
  satsPerKb: number | undefined,
  dryRun: boolean,
  version: string,
  callbacks?: OrchestratorCallbacks
): Promise<HtmlInscriptionResult> {
  if (htmlFiles.length === 0) {
    throw new Error('No index.html found in build directory');
  }

  const htmlFilePath = htmlFiles[0]; // Should only be one index.html
  const htmlNode = graph.get(htmlFilePath);
  if (!htmlNode) {
    throw new Error(`Could not find HTML file in graph: ${htmlFilePath}`);
  }

  callbacks?.onProgress?.(`\n🌐 Inscribing HTML as 1-sat ordinal...`);

  // Prepare HTML content with all rewrites and script injections
  const htmlContentBuffer = await prepareHtmlContent(
    htmlNode.file,
    htmlFilePath,
    buildDir,
    urlMap,
    finalVersioningOriginInscription,
    serviceWorkerUrl
  );

  let entryPoint: InscribedFile;
  let finalHtmlOriginInscription: string;
  let txid: string | undefined;

  if (!htmlOriginInscription && !dryRun) {
    // First deployment: Create initial HTML ordinal
    callbacks?.onInscriptionStart?.('index.html (origin)', 0, 0);

    entryPoint = await createInitialHtmlOrdinal(
      htmlContentBuffer,
      paymentPk,
      indexer,
      destinationAddress,
      satsPerKb || DEFAULT_SATS_PER_KB
    );

    finalHtmlOriginInscription = extractOutpointFromFile(entryPoint);
    txid = entryPoint.txid;

    callbacks?.onInscriptionComplete?.('index.html (origin)', entryPoint.urlPath);
  } else if (htmlOriginInscription && !dryRun) {
    // Subsequent deployment: Spend previous HTML ordinal
    callbacks?.onInscriptionStart?.('index.html', 0, 0);

    entryPoint = await updateHtmlOrdinal(
      htmlOriginInscription,
      htmlContentBuffer,
      paymentPk,
      paymentPk, // Use same key as payment key
      indexer,
      destinationAddress,
      satsPerKb || DEFAULT_SATS_PER_KB
    );

    finalHtmlOriginInscription = htmlOriginInscription; // Origin doesn't change
    txid = entryPoint.txid;

    callbacks?.onInscriptionComplete?.('index.html', entryPoint.urlPath);
  } else {
    // Dry run: Mock HTML inscription
    const contentHash = createHash('sha256').update(htmlContentBuffer).digest('hex');
    const mockTxid = createHash('sha256').update(`html-${version}-${Date.now()}`).digest('hex');

    entryPoint = {
      originalPath: 'index.html',
      txid: mockTxid,
      vout: 0,
      urlPath: `${CONTENT_PATH_PREFIX}${mockTxid}_0`,
      size: htmlContentBuffer.length,
      contentHash,
    };

    finalHtmlOriginInscription = htmlOriginInscription || `${mockTxid}_0`;
    callbacks?.onInscriptionComplete?.('index.html (dry-run)', entryPoint.urlPath);
  }

  callbacks?.onProgress?.(`  ✓ HTML inscribed: ${entryPoint.urlPath}`);

  return {
    entryPoint,
    finalHtmlOriginInscription,
    txid,
  };
}
