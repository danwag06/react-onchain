import { PrivateKey, Transaction, P2PKH, SatoshisPerKilobyte, Utils } from '@bsv/sdk';
import type { Utxo } from 'js-1sat-ord';
import type { IndexerService } from './service-providers/IndexerService.js';
import { retryWithBackoff } from './utils/retry.js';
import {
  INSCRIPTION_OUTPUT_SATS,
  TX_OVERHEAD_BYTES,
  UTXO_FETCH_BUFFER_SATS,
  RETRY_MAX_ATTEMPTS,
  RETRY_INITIAL_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  DRY_RUN_DELAY_MS,
  TX_BASE_SIZE,
  TX_INPUT_SIZE,
  TX_OUTPUT_SIZE,
} from './utils/constants.js';
import { createHash } from 'crypto';
import { addUtxoInput } from './utils/helpers.js';

/**
 * Result of UTXO splitting operation
 */
export interface UtxoSplitResult {
  /** Array of new UTXOs created from the split */
  utxos: Utxo[];
  /** Transaction ID of the split transaction */
  txid: string;
  /** Total satoshis used (including fees) */
  totalSats: number;
}

/**
 * Splits a single UTXO into multiple UTXOs for parallel inscription
 *
 * Creates a transaction that spends one large UTXO and outputs N UTXOs,
 * each with EXACT satoshis needed for its inscription (no change outputs).
 *
 * @param paymentKey - Private key for signing the split transaction
 * @param indexer - Indexer service for fetching UTXOs and broadcasting
 * @param outputCount - Number of UTXOs to create
 * @param satsPerOutput - Either a single number OR an array of exact satoshi amounts per output
 * @param satsPerKb - Fee rate for the split transaction
 * @param dryRun - If true, generates mock UTXOs without broadcasting
 * @param seedUtxo - Optional UTXO to use instead of fetching from indexer (avoids timing issues)
 * @param onProgress - Optional callback for progress updates
 * @returns Array of new UTXOs ready for parallel use
 */
export async function splitUtxoForParallelInscription(
  paymentKey: PrivateKey,
  indexer: IndexerService,
  outputCount: number,
  satsPerOutput: number | number[],
  satsPerKb: number = 1,
  dryRun: boolean = false,
  seedUtxo?: Utxo,
  onProgress?: (message: string) => void
): Promise<UtxoSplitResult> {
  const paymentAddress = paymentKey.toAddress().toString();

  // Handle both array and single value inputs
  const satAmounts = Array.isArray(satsPerOutput)
    ? satsPerOutput
    : Array(outputCount).fill(satsPerOutput);

  if (satAmounts.length !== outputCount) {
    throw new Error(
      `Mismatch: outputCount is ${outputCount} but satsPerOutput array has ${satAmounts.length} elements`
    );
  }

  // Calculate total satoshis needed
  const totalOutputSats = satAmounts.reduce((sum, sats) => sum + sats, 0);

  // Estimate split transaction fee
  // Each output is ~34 bytes, input is ~148 bytes, base tx is ~10 bytes
  const estimatedTxSize = TX_BASE_SIZE + TX_INPUT_SIZE + TX_OUTPUT_SIZE * outputCount;
  const estimatedFee = Math.ceil((estimatedTxSize / 1000) * satsPerKb);
  const totalRequired = totalOutputSats + estimatedFee + UTXO_FETCH_BUFFER_SATS;

  // Dry run mode - generate mock UTXOs
  if (dryRun) {
    await new Promise((resolve) => setTimeout(resolve, DRY_RUN_DELAY_MS));

    const mockTxid = createHash('sha256')
      .update(`split-${Date.now()}-${outputCount}`)
      .digest('hex');

    const mockUtxos: Utxo[] = Array.from({ length: outputCount }, (_, i) => ({
      satoshis: satAmounts[i],
      txid: mockTxid,
      vout: i,
      script: Utils.toBase64(new P2PKH().lock(paymentAddress).toBinary()),
    }));

    return {
      utxos: mockUtxos,
      txid: mockTxid,
      totalSats: totalRequired,
    };
  }

  // Use seed UTXO if provided (and sufficient), otherwise fetch from indexer
  let sourceUtxos: Utxo[];

  if (seedUtxo && seedUtxo.satoshis >= totalRequired) {
    // Seed UTXO has enough - use it exclusively
    onProgress?.(`Using seed UTXO (${seedUtxo.satoshis.toLocaleString()} sats)`);
    sourceUtxos = [seedUtxo];
  } else {
    // Fetch UTXOs from indexer
    onProgress?.(`Fetching UTXOs from indexer (need ${totalRequired.toLocaleString()} sats)...`);
    const fetchedUtxos = await indexer.listUnspent(paymentAddress, {
      unspentValue: totalOutputSats,
      estimateSize: estimatedTxSize,
      feePerKb: satsPerKb,
      additional: UTXO_FETCH_BUFFER_SATS,
    });
    onProgress?.(`Found ${fetchedUtxos?.length || 0} UTXO(s) from indexer`);

    if (!fetchedUtxos || fetchedUtxos.length === 0) {
      throw new Error(
        `No UTXOs found with sufficient balance. Need ${totalRequired} sats for ${outputCount} outputs.`
      );
    }

    // If we have a seed UTXO but it's insufficient, combine it with fetched UTXOs
    if (seedUtxo) {
      // Filter out any UTXOs with null satoshis (not fully indexed yet)
      const validFetchedUtxos = fetchedUtxos.filter(
        (utxo) => utxo && utxo.satoshis !== null && utxo.satoshis !== undefined
      );
      sourceUtxos = [seedUtxo, ...validFetchedUtxos];
    } else {
      sourceUtxos = fetchedUtxos;
    }
  }

  // Validate UTXOs have satoshis field (when no seed UTXO provided)
  if (!seedUtxo) {
    for (const utxo of sourceUtxos) {
      if (utxo.satoshis === null || utxo.satoshis === undefined) {
        throw new Error(
          `Invalid UTXO returned from indexer: ${utxo.txid}:${utxo.vout} has null/undefined satoshis. ` +
            `This may indicate the UTXO has been spent or the indexer is returning invalid data.`
        );
      }
    }
  }

  // Build split transaction
  onProgress?.(`Building split transaction with ${outputCount} output(s)...`);
  const tx = new Transaction();
  let totalInputSats = 0;

  // Add inputs
  for (const utxo of sourceUtxos) {
    addUtxoInput(tx, utxo, paymentKey);
    totalInputSats += utxo.satoshis;

    // Stop when we have enough
    if (totalInputSats >= totalRequired) {
      break;
    }
  }

  if (totalInputSats < totalRequired) {
    throw new Error(
      `Insufficient UTXO balance. Have ${totalInputSats} sats, need ${totalRequired} sats.`
    );
  }

  // Add outputs with exact satoshi amounts (one for each job)
  for (let i = 0; i < outputCount; i++) {
    tx.addOutput({
      satoshis: satAmounts[i],
      lockingScript: new P2PKH().lock(paymentAddress),
    });
  }

  // Add change output
  tx.addOutput({
    change: true,
    lockingScript: new P2PKH().lock(paymentAddress),
  });

  // Calculate fees and sign
  onProgress?.(`Signing split transaction...`);
  await tx.fee(new SatoshisPerKilobyte(satsPerKb));
  await tx.sign();

  // Broadcast with retry
  onProgress?.(`Preparing files and utxos...`);
  const broadcastTx = async () => {
    try {
      await indexer.broadcastTransaction(tx.toHex());
    } catch (error: any) {
      throw new Error(`Failed to broadcast UTXO split transaction: ${error.message}`);
    }
  };

  await retryWithBackoff(broadcastTx, {
    maxAttempts: RETRY_MAX_ATTEMPTS,
    initialDelayMs: RETRY_INITIAL_DELAY_MS,
    maxDelayMs: RETRY_MAX_DELAY_MS,
  });

  const txid = tx.id('hex') as string;
  onProgress?.(`Split transaction broadcast: ${txid.slice(0, 16)}...`);

  // Create UTXO objects for each output with exact amounts
  const newUtxos: Utxo[] = Array.from({ length: outputCount }, (_, i) => ({
    satoshis: satAmounts[i],
    txid,
    vout: i,
    script: Utils.toBase64(new P2PKH().lock(paymentAddress).toBinary()),
  }));

  return {
    utxos: newUtxos,
    txid,
    totalSats: totalInputSats,
  };
}

/**
 * Splits UTXOs for batch parallel inscription of chunks
 *
 * Calculates required satoshis per chunk and creates enough UTXOs
 * for the specified batch size.
 *
 * @param paymentKey - Private key for signing
 * @param indexer - Indexer service
 * @param totalChunkCount - Total number of chunks to inscribe
 * @param avgChunkSize - Average chunk size in bytes
 * @param batchSize - Number of chunks to inscribe in parallel
 * @param satsPerKb - Fee rate
 * @param dryRun - Dry run mode
 * @returns Array of UTXO batches, each batch ready for parallel inscription
 */
export async function splitUtxosForBatchChunking(
  paymentKey: PrivateKey,
  indexer: IndexerService,
  totalChunkCount: number,
  avgChunkSize: number,
  batchSize: number,
  satsPerKb: number = 1,
  dryRun: boolean = false
): Promise<Utxo[][]> {
  // Calculate sats needed per chunk
  const estimatedTxSize = avgChunkSize + TX_OVERHEAD_BYTES;
  const estimatedFee = Math.ceil((estimatedTxSize / 1000) * satsPerKb);
  const satsPerChunk = estimatedFee + INSCRIPTION_OUTPUT_SATS;

  // Calculate number of batches needed
  const batchCount = Math.ceil(totalChunkCount / batchSize);

  const allUtxoBatches: Utxo[][] = [];

  // Create UTXOs for each batch
  for (let batchIndex = 0; batchIndex < batchCount; batchIndex++) {
    const chunksInThisBatch = Math.min(batchSize, totalChunkCount - batchIndex * batchSize);

    const splitResult = await splitUtxoForParallelInscription(
      paymentKey,
      indexer,
      chunksInThisBatch,
      satsPerChunk,
      satsPerKb,
      dryRun
    );

    allUtxoBatches.push(splitResult.utxos);
  }

  return allUtxoBatches;
}
