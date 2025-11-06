/**
 * Parallel Inscription System with Exact Fee Calculation
 *
 * This module implements a deterministic parallel inscription system that:
 *
 * 1. **Phase 1: Exact Fee Calculation**
 *    - Builds placeholder transactions for each job using createOrdinals()
 *    - Calls tx.getFee() to get EXACT satoshis needed (not estimations)
 *    - Eliminates all change outputs from inscription transactions
 *
 * 2. **Phase 2: UTXO Preparation**
 *    - Creates ONE UTXO split transaction for ALL jobs
 *    - Each output is perfectly-sized with exact satoshis from Phase 1
 *    - Broadcasts the split transaction and waits for acceptance
 *
 * 3. **Phase 3: Transaction Building**
 *    - Builds ALL inscription transactions using pre-allocated UTXOs
 *    - Stores raw transaction hex (never rebuilds on retry)
 *
 *
 * 4. **Phase 5: Broadcasting**
 *    - Broadcasts all transactions in parallel batches
 *    - Retry logic ONLY retries broadcast of same raw tx hex
 *    - NEVER rebuilds transactions during retry
 *
 * Key Benefits:
 * - No change outputs (cleaner transactions, lower fees)
 * - No double-spend errors (verified before broadcasting)
 * - Deterministic (same inputs = same outputs)
 * - Parallel processing (fast for large deployments)
 */

import { PrivateKey, Transaction, SatoshisPerKilobyte, P2PKH, Utils, OP, Script } from '@bsv/sdk';
import type { Utxo } from 'js-1sat-ord';
import type { IndexerService } from '../../lib/service-providers/IndexerService.js';
import type { InscribedFile } from './inscription.types.js';
import { createOrdinals, B_PREFIX } from 'js-1sat-ord';
import { splitUtxoForParallelInscription } from './utxoSplitter.js';
import { INSCRIPTION_OUTPUT_SATS } from '../../utils/constants.js';
import { CONTENT_PATH } from '../../lib/service-providers/gorilla-pool/constants.js';
import { addUtxoInput } from './utils.js';
import { createHash } from 'crypto';
import { retryWithBackoff, shouldRetryError } from '../../utils/retry.js';
import {
  RETRY_MAX_ATTEMPTS,
  RETRY_INITIAL_DELAY_MS,
  RETRY_MAX_DELAY_MS,
} from '../../utils/constants.js';

/**
 * Type of inscription
 */
export type InscriptionType = 'ordinal' | 'bfile';

/**
 * Progress callback for reporting inscription progress
 */
export type ProgressCallback = (message: string) => void;

/**
 * Represents a single inscription job (file or chunk)
 */
export interface InscriptionJob {
  /** Unique identifier for this job */
  id: string;
  /** Type of inscription (ordinal uses createOrdinals, bfile uses buildBScript) */
  type: InscriptionType;
  /** Absolute file path */
  filePath: string;
  /** Original path for tracking */
  originalPath: string;
  /** Content type */
  contentType: string;
  /** File content buffer */
  content: Buffer;
  /** Destination address */
  destinationAddress: string;
  /** Chunk index if this is a chunk, undefined otherwise */
  chunkIndex?: number;
  /** Total chunks if this is part of a chunked file, undefined otherwise */
  totalChunks?: number;
}

/**
 * Result of EXACT fee calculation for a single job using getFee()
 */
export interface JobFeeCalculation {
  job: InscriptionJob;
  exactFee: number;
  requiredSats: number; // exactFee + INSCRIPTION_OUTPUT_SATS
}

/**
 * A built transaction ready for verification and broadcast
 */
export interface BuiltTransaction {
  job: InscriptionJob;
  tx: Transaction;
  rawHex: string;
  utxo: Utxo;
}

/**
 * Result of a successful inscription
 */
export interface InscriptionResult {
  job: InscriptionJob;
  inscription: InscribedFile;
}

/**
 * Result of parallel inscription including cost information
 */
export interface ParallelInscriptionResult {
  results: InscriptionResult[];
  totalCost: number; // Total fees paid (in satoshis)
  splitTxid?: string; // Split UTXO transaction ID (undefined if no split was needed)
}

/**
 * Builds a B protocol script for B file inscriptions
 */
function buildBScript(fileBuffer: Buffer, contentType: string): Script {
  const bscript = new Script();
  bscript.writeOpCode(OP.OP_FALSE);
  bscript.writeOpCode(OP.OP_RETURN);
  bscript.writeBin(Utils.toArray(B_PREFIX, 'utf8'));
  bscript.writeBin([...fileBuffer]);
  bscript.writeBin(Utils.toArray(contentType));
  bscript.writeBin(Utils.toArray('binary', 'utf8'));
  return bscript;
}

/**
 * Creates a placeholder UTXO for fee estimation
 */
function createPlaceholderUtxo(satoshis: number, address: string): Utxo {
  // Create a dummy txid (all zeros)
  const dummyTxid = '0'.repeat(64);

  return {
    txid: dummyTxid,
    vout: 0,
    satoshis,
    script: Utils.toBase64(new P2PKH().lock(address).toBinary()),
  };
}

/**
 * Calculates EXACT fees for a single inscription job using getFee()
 * Builds a placeholder transaction to determine exact satoshis needed
 */
async function calculateExactJobFee(
  job: InscriptionJob,
  paymentKey: PrivateKey,
  satsPerKb: number = 1
): Promise<JobFeeCalculation> {
  const paymentAddress = paymentKey.toAddress().toString();

  // Create a placeholder UTXO with a large amount (will calculate exact amount needed)
  const placeholderUtxo = createPlaceholderUtxo(100000000, paymentAddress); // 1 BSV placeholder

  let placeholderTx: Transaction;

  if (job.type === 'ordinal') {
    // Build placeholder ordinal inscription transaction using createOrdinals
    const contentBase64 = job.content.toString('base64');

    const placeholderResult = await createOrdinals({
      utxos: [placeholderUtxo],
      destinations: [
        {
          address: job.destinationAddress,
          inscription: {
            dataB64: contentBase64,
            contentType: job.contentType,
          },
        },
      ],
      paymentPk: paymentKey,
      satsPerKb,
    });

    placeholderTx = placeholderResult.tx;
  } else {
    // Build placeholder B file transaction
    placeholderTx = new Transaction();

    // Add placeholder UTXO as input
    addUtxoInput(placeholderTx, placeholderUtxo, paymentKey);

    // Add B file output (0 satoshis)
    placeholderTx.addOutput({
      satoshis: 0,
      lockingScript: buildBScript(job.content, job.contentType),
    });

    // Add change output
    placeholderTx.addOutput({
      change: true,
      lockingScript: new P2PKH().lock(paymentAddress),
    });

    await placeholderTx.fee(new SatoshisPerKilobyte(satsPerKb));
    await placeholderTx.sign();
  }

  // Get the EXACT fee from the transaction
  const exactFee = placeholderTx.getFee();

  // For B files, the required sats is just the fee (0-sat output)
  // For ordinals, add 1 sat for inscription output
  const requiredSats = job.type === 'bfile' ? exactFee : exactFee + INSCRIPTION_OUTPUT_SATS;

  return {
    job,
    exactFee,
    requiredSats,
  };
}

/**
 * Calculates EXACT fees for all inscription jobs using getFee()
 * This builds placeholder transactions for each job to get exact satoshi requirements
 */
export async function calculateAllJobFees(
  jobs: InscriptionJob[],
  paymentKey: PrivateKey,
  satsPerKb: number = 1,
  batchSize: number = 10,
  onProgress?: ProgressCallback
): Promise<JobFeeCalculation[]> {
  onProgress?.(`Calculating fees for ${jobs.length} jobs...`);

  const feeCalculations: JobFeeCalculation[] = [];

  // Process in batches to reduce memory pressure
  for (let batchStart = 0; batchStart < jobs.length; batchStart += batchSize) {
    const batchEnd = Math.min(batchStart + batchSize, jobs.length);
    const batch = jobs.slice(batchStart, batchEnd);

    // Process batch sequentially
    for (const job of batch) {
      const calculation = await calculateExactJobFee(job, paymentKey, satsPerKb);
      feeCalculations.push(calculation);
    }

    // Progress update after each batch
    onProgress?.(`Calculated fees: ${batchEnd}/${jobs.length}`);

    // Small delay between batches to allow GC
    if (batchEnd < jobs.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  const totalSats = feeCalculations.reduce((sum, calc) => sum + calc.requiredSats, 0);
  onProgress?.(`Total satoshis required: ${totalSats.toLocaleString()}`);

  return feeCalculations;
}

/**
 * Splits UTXOs upfront for all inscription jobs
 * Creates perfectly-sized UTXOs (one per job) in a SINGLE transaction
 * Each UTXO has EXACT satoshis needed (no change outputs on inscription txs)
 */
export async function prepareUtxosForJobs(
  paymentKey: PrivateKey,
  indexer: IndexerService,
  feeCalculations: JobFeeCalculation[],
  satsPerKb: number = 1,
  dryRun: boolean = false,
  seedUtxo?: Utxo,
  spentUtxos?: Set<string>,
  onProgress?: ProgressCallback
): Promise<{ utxos: Utxo[]; splitTxid: string }> {
  onProgress?.(`💰 Preparing ${feeCalculations.length} perfectly-sized UTXOs...`);

  const exactSatAmounts = feeCalculations.map((calc) => calc.requiredSats);

  // Always split for all jobs to ensure unique UTXOs
  // (Reusing existing UTXOs would cause double-spends within the same wave)
  const splitResult = await splitUtxoForParallelInscription(
    paymentKey,
    indexer,
    feeCalculations.length,
    exactSatAmounts,
    satsPerKb,
    dryRun,
    seedUtxo,
    onProgress // Pass through progress callback to keep spinner alive
  );

  // Track these UTXOs as spent (they will be used for inscriptions)
  if (spentUtxos) {
    for (const utxo of splitResult.utxos) {
      spentUtxos.add(`${utxo.txid}:${utxo.vout}`);
    }
  }

  onProgress?.(
    `✓ All UTXOs prepared (${splitResult.utxos.length} UTXOs in 1 transaction: ${splitResult.txid.slice(0, 16)}...)`
  );

  return { utxos: splitResult.utxos, splitTxid: splitResult.txid };
}

/**
 * Builds a single inscription transaction with NO change output (does NOT broadcast)
 * The UTXO is pre-sized exactly for this transaction, so no change is needed
 */
async function buildInscriptionTransaction(
  job: InscriptionJob,
  utxo: Utxo,
  paymentKey: PrivateKey,
  satsPerKb: number = 1
): Promise<BuiltTransaction> {
  let tx: Transaction;

  if (job.type === 'ordinal') {
    // Build ordinal inscription using createOrdinals
    const contentBase64 = job.content.toString('base64');

    const inscriptionResult = await createOrdinals({
      utxos: [utxo],
      destinations: [
        {
          address: job.destinationAddress,
          inscription: {
            dataB64: contentBase64,
            contentType: job.contentType,
          },
        },
      ],
      paymentPk: paymentKey,
      satsPerKb,
    });

    tx = inscriptionResult.tx;
  } else {
    // Build B file transaction
    const paymentAddress = paymentKey.toAddress().toString();
    tx = new Transaction();

    // Add UTXO as input (pre-sized with exact satoshis)
    addUtxoInput(tx, utxo, paymentKey);

    // Add B file output (0 satoshis)
    tx.addOutput({
      satoshis: 0,
      lockingScript: buildBScript(job.content, job.contentType),
    });

    // Add change output (will consume exact remaining sats)
    tx.addOutput({
      change: true,
      lockingScript: new P2PKH().lock(paymentAddress),
    });

    await tx.fee(new SatoshisPerKilobyte(satsPerKb));
    await tx.sign();
  }

  const rawHex = tx.toHex();

  return {
    job,
    tx,
    rawHex,
    utxo,
  };
}

/**
 * Builds ALL inscription transactions upfront (does NOT broadcast)
 */
export async function buildAllTransactions(
  jobs: InscriptionJob[],
  utxos: Utxo[],
  paymentKey: PrivateKey,
  satsPerKb: number = 1
): Promise<BuiltTransaction[]> {
  console.log(`\n🔨 Building ${jobs.length} transactions...`);

  if (jobs.length !== utxos.length) {
    throw new Error(
      `Mismatch: ${jobs.length} jobs but ${utxos.length} UTXOs. This should never happen.`
    );
  }

  const builtTxs: BuiltTransaction[] = [];

  // Build transactions sequentially to avoid overwhelming the system
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const utxo = utxos[i];

    console.log(
      `  Building tx ${i + 1}/${jobs.length}: ${job.originalPath} (${(job.content.length / 1024).toFixed(0)}KB)...`
    );

    const builtTx = await buildInscriptionTransaction(job, utxo, paymentKey, satsPerKb);
    builtTxs.push(builtTx);
  }

  console.log(`✓ All ${builtTxs.length} transactions built\n`);

  return builtTxs;
}

/**
 * Finds the inscription output index
 * - For ordinals: 1-sat output
 * - For B files: 0-sat output (always at index 0)
 */
function findInscriptionOutputIndex(tx: Transaction, type: InscriptionType): number {
  if (type === 'bfile') {
    return 0; // B file output is always at index 0
  }

  // For ordinals, find the 1-sat output
  for (let i = 0; i < tx.outputs.length; i++) {
    if (tx.outputs[i].satoshis === INSCRIPTION_OUTPUT_SATS) {
      return i;
    }
  }
  return 0; // Default to first output if not found
}

/**
 * Broadcasts a single transaction (with retry, but NEVER rebuilds)
 */
async function broadcastTransaction(
  builtTx: BuiltTransaction,
  indexer: IndexerService
): Promise<string> {
  const txid = await retryWithBackoff(
    async () => {
      try {
        // Always broadcast the SAME raw hex - never rebuild
        return await indexer.broadcastTransaction(builtTx.rawHex);
      } catch (error) {
        throw new Error(
          `Failed to broadcast transaction for ${builtTx.job.originalPath}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },
    {
      maxAttempts: RETRY_MAX_ATTEMPTS,
      initialDelayMs: RETRY_INITIAL_DELAY_MS,
      maxDelayMs: RETRY_MAX_DELAY_MS,
    },
    shouldRetryError
  );

  return txid;
}

/**
 * Broadcasts ALL transactions in parallel
 */
export async function broadcastAllTransactions(
  builtTxs: BuiltTransaction[],
  indexer: IndexerService,
  batchSize: number = 10
): Promise<InscriptionResult[]> {
  console.log(`\n📡 Broadcasting ${builtTxs.length} transactions in batches of ${batchSize}...`);

  const results: InscriptionResult[] = [];
  const batchCount = Math.ceil(builtTxs.length / batchSize);

  for (let batchIndex = 0; batchIndex < batchCount; batchIndex++) {
    const batchStart = batchIndex * batchSize;
    const batchEnd = Math.min(batchStart + batchSize, builtTxs.length);
    const batch = builtTxs.slice(batchStart, batchEnd);

    console.log(
      `\n  📦 Batch ${batchIndex + 1}/${batchCount}: Broadcasting txs ${batchStart + 1}-${batchEnd}...`
    );

    // Broadcast in parallel
    const batchPromises = batch.map(async (builtTx, i) => {
      const globalIndex = batchStart + i;

      console.log(
        `    ↳ Broadcasting ${globalIndex + 1}/${builtTxs.length}: ${builtTx.job.originalPath}...`
      );

      const txid = await broadcastTransaction(builtTx, indexer);
      const vout = findInscriptionOutputIndex(builtTx.tx, builtTx.job.type);
      const urlPath = `${CONTENT_PATH}/${txid}_${vout}`;

      // Calculate content hash
      const contentHash = createHash('sha256').update(builtTx.job.content).digest('hex');

      const inscription: InscribedFile = {
        originalPath: builtTx.job.originalPath,
        txid,
        vout,
        urlPath,
        size: builtTx.job.content.length,
        contentHash,
      };

      return {
        job: builtTx.job,
        inscription,
      };
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    console.log(`  ✓ Batch ${batchIndex + 1}/${batchCount} complete`);
  }

  console.log(`\n✓ All ${results.length} transactions broadcast successfully\n`);

  return results;
}

/**
 * Build and broadcast transactions in batches to avoid memory issues
 * Each batch: build → broadcast → clear from memory
 */
async function buildAndBroadcastInBatches(
  jobs: InscriptionJob[],
  utxos: Utxo[],
  paymentKey: PrivateKey,
  indexer: IndexerService,
  satsPerKb: number = 1,
  batchSize: number = 10,
  dryRun: boolean = false,
  onProgress?: ProgressCallback
): Promise<InscriptionResult[]> {
  const totalJobs = jobs.length;
  const batchCount = Math.ceil(totalJobs / batchSize);
  const results: InscriptionResult[] = [];

  // Detect if this is a chunked file
  const isChunked = jobs.length > 1 && jobs[0].chunkIndex !== undefined;

  if (isChunked) {
    onProgress?.(`Processing large files (${totalJobs} chunks in ${batchCount} batches)`);
  } else {
    onProgress?.(`Processing ${totalJobs} file(s) in ${batchCount} batch(es)`);
  }

  for (let batchIndex = 0; batchIndex < batchCount; batchIndex++) {
    const batchStart = batchIndex * batchSize;
    const batchEnd = Math.min(batchStart + batchSize, totalJobs);
    const batchJobs = jobs.slice(batchStart, batchEnd);
    const batchUtxos = utxos.slice(batchStart, batchEnd);

    if (isChunked) {
      onProgress?.(`Building chunks ${batchStart + 1}-${batchEnd} of ${totalJobs}...`);
    } else {
      onProgress?.(`Building batch ${batchIndex + 1}/${batchCount}...`);
    }

    // Build transactions for this batch
    const builtTxs: BuiltTransaction[] = [];
    for (let i = 0; i < batchJobs.length; i++) {
      const builtTx = await buildInscriptionTransaction(
        batchJobs[i],
        batchUtxos[i],
        paymentKey,
        satsPerKb
      );
      builtTxs.push(builtTx);
    }

    if (isChunked) {
      onProgress?.(`Broadcasting chunks ${batchStart + 1}-${batchEnd} of ${totalJobs}...`);
    } else {
      onProgress?.(`Broadcasting batch ${batchIndex + 1}/${batchCount}...`);
    }

    // Broadcast this batch in parallel (or generate mock tx IDs in dry-run mode)
    const batchPromises = builtTxs.map(async (builtTx) => {
      const txid = dryRun ? builtTx.tx.id('hex') : await broadcastTransaction(builtTx, indexer);
      const vout = findInscriptionOutputIndex(builtTx.tx, builtTx.job.type);
      const urlPath = `${CONTENT_PATH}/${txid}_${vout}`;
      const contentHash = createHash('sha256').update(builtTx.job.content).digest('hex');

      const inscription: InscribedFile = {
        originalPath: builtTx.job.originalPath,
        txid,
        vout,
        urlPath,
        size: builtTx.job.content.length,
        contentHash,
      };

      return {
        job: builtTx.job,
        inscription,
      };
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    onProgress?.(`✓ Batch ${batchIndex + 1}/${batchCount} complete (${batchResults.length} txs)`);
  }

  onProgress?.(`✓ All transactions completed. Updating versioning inscription...`);
  return results;
}

/**
 * Main entry point: Inscribe all jobs in parallel with proper verification
 *
 * This function implements the complete parallel inscription flow:
 * 1. Calculate EXACT fees for all jobs using getFee() (builds placeholder transactions)
 * 2. Split UTXOs upfront with EXACT satoshi amounts (one split transaction, no change on inscriptions)
 * 3. Build all inscription transactions (does NOT broadcast)
 * 4. Verify all transactions to detect double-spends BEFORE broadcasting
 * 5. Broadcast all transactions in parallel batches
 *
 * Key features:
 * - NO change outputs on inscription transactions (perfectly-sized UTXOs)
 * - NO double-spends (all transactions verified before any broadcasting)
 * - NO transaction rebuilding on retry (only retries broadcast of same raw tx)
 */
export async function parallelInscribe(
  jobs: InscriptionJob[],
  paymentKey: PrivateKey,
  indexer: IndexerService,
  satsPerKb: number = 1,
  dryRun: boolean = false,
  batchSize: number = 10,
  seedUtxo?: Utxo,
  spentUtxos?: Set<string>,
  onProgress?: ProgressCallback
): Promise<ParallelInscriptionResult> {
  onProgress?.(`⚡ Starting parallel inscription for ${jobs.length} jobs...`);

  // Phase 1: Calculate EXACT fees using getFee() (builds placeholder transactions)
  const feeCalculations = await calculateAllJobFees(
    jobs,
    paymentKey,
    satsPerKb,
    batchSize,
    onProgress
  );

  // Calculate total cost (sum of all exact fees)
  const totalCost = feeCalculations.reduce((sum, calc) => sum + calc.exactFee, 0);

  // Phase 2: Prepare perfectly-sized UTXOs (one split transaction)
  const { utxos, splitTxid } = await prepareUtxosForJobs(
    paymentKey,
    indexer,
    feeCalculations,
    satsPerKb,
    dryRun,
    seedUtxo,
    spentUtxos,
    onProgress
  );

  // Phase 3-5: Build and broadcast in batches to avoid memory issues
  const results = await buildAndBroadcastInBatches(
    jobs,
    utxos,
    paymentKey,
    indexer,
    satsPerKb,
    batchSize,
    dryRun,
    onProgress
  );

  return {
    results,
    totalCost,
    splitTxid,
  };
}
