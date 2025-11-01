import { readFile } from 'fs/promises';
import {
  fromUtxo,
  OP,
  P2PKH,
  PrivateKey,
  SatoshisPerKilobyte,
  Script,
  Transaction,
  Utils,
} from '@bsv/sdk';
import { createOrdinals, B_PREFIX } from 'js-1sat-ord';
import type { Utxo } from 'js-1sat-ord';
import type { InscribedFile } from './types.js';
import { createHash } from 'crypto';
import { retryWithBackoff, shouldRetryError, isUtxoNotFoundError } from './utils/retry.js';
import type { IndexerService } from './services/IndexerService.js';
import { CONTENT_PATH } from './services/gorilla-pool/constants.js';
import { formatError } from './utils/errors.js';
import {
  INSCRIPTION_OUTPUT_SATS,
  TX_OVERHEAD_BYTES,
  UTXO_FETCH_BUFFER_SATS,
  DRY_RUN_DELAY_MS,
  RETRY_MAX_ATTEMPTS,
  RETRY_INITIAL_DELAY_MS,
  RETRY_MAX_DELAY_MS,
} from './utils/constants.js';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generates a mock transaction ID for dry-run mode
 */
function generateMockTxid(filePath: string): string {
  const hash = createHash('sha256').update(filePath).digest('hex');
  return hash.substring(0, 64);
}

/**
 * Loads file content from either a provided buffer or file path
 */
async function loadFileContent(filePath: string, content?: Buffer): Promise<Buffer> {
  if (content !== undefined) {
    return content;
  }
  return await readFile(filePath);
}

/**
 * Creates a dry-run result without broadcasting to the network
 */
function createDryRunResult(
  originalPath: string,
  fileSize: number
): { inscription: InscribedFile } {
  const mockTxid = generateMockTxid(originalPath);
  const vout = 0;
  const urlPath = `${CONTENT_PATH}/${mockTxid}_${vout}`;

  return {
    inscription: {
      originalPath,
      txid: mockTxid,
      vout,
      urlPath,
      size: fileSize,
    },
  };
}

/**
 * Fee estimation result
 */
interface FeeEstimate {
  estimatedTxSize: number;
  estimatedFee: number;
  requiredSats: number;
  feeRate: number;
}

/**
 * Estimates fees and required satoshis for a transaction
 */
function estimateFeeAndRequiredSats(fileSize: number, satsPerKb: number = 1): FeeEstimate {
  const estimatedTxSize = fileSize + TX_OVERHEAD_BYTES;
  const feeRate = satsPerKb;
  const estimatedFee = Math.ceil((estimatedTxSize / 1000) * feeRate);
  const requiredSats = estimatedFee + INSCRIPTION_OUTPUT_SATS;

  return {
    estimatedTxSize,
    estimatedFee,
    requiredSats,
    feeRate,
  };
}

/**
 * Creates a formatted broadcast error
 */
function createBroadcastError(originalPath: string, error: unknown, fileType: string): Error {
  const errorMsg = formatError(error);
  return new Error(`Failed to broadcast ${fileType} transaction for ${originalPath}: ${errorMsg}`);
}

/**
 * Helper function to fetch UTXOs from indexer
 */
async function fetchUtxosFromIndexer(
  indexer: IndexerService,
  paymentAddress: string,
  feeEstimate: FeeEstimate
): Promise<Utxo[]> {
  const indexerUtxos = await indexer.listUnspent(paymentAddress, {
    unspentValue: INSCRIPTION_OUTPUT_SATS,
    estimateSize: feeEstimate.estimatedTxSize,
    feePerKb: feeEstimate.feeRate,
    additional: UTXO_FETCH_BUFFER_SATS,
  });

  if (!indexerUtxos || indexerUtxos.length === 0) {
    throw new Error(`No UTXOs found for payment address ${paymentAddress}`);
  }

  return indexerUtxos;
}

/**
 * Parameters for UTXO selection
 */
interface UtxoSelectionParams {
  paymentUtxo?: Utxo;
  requiredSats: number;
  indexer: IndexerService;
  paymentAddress: string;
  feeEstimate: FeeEstimate;
}

/**
 * Selects UTXOs for a transaction, reusing change UTXO if available
 */
async function selectUtxosForTransaction(params: UtxoSelectionParams): Promise<Utxo[]> {
  const { paymentUtxo, requiredSats, indexer, paymentAddress, feeEstimate } = params;

  // No change UTXO provided - fetch fresh UTXOs
  if (!paymentUtxo) {
    return await fetchUtxosFromIndexer(indexer, paymentAddress, feeEstimate);
  }

  // Change UTXO has sufficient funds - use it alone
  if (paymentUtxo.satoshis >= requiredSats) {
    return [paymentUtxo];
  }

  // Change UTXO insufficient - combine with fresh UTXOs
  const additionalUtxos = await fetchUtxosFromIndexer(indexer, paymentAddress, feeEstimate);
  return [paymentUtxo, ...additionalUtxos];
}

/**
 * Finds the inscription output index (1-sat output)
 */
function findInscriptionOutputIndex(tx: Transaction): number {
  for (let i = 0; i < tx.outputs.length; i++) {
    if (tx.outputs[i].satoshis === INSCRIPTION_OUTPUT_SATS) {
      return i;
    }
  }
  return 0; // Default to first output if not found
}

/**
 * Inscribes a single file on-chain (or simulates in dry-run mode)
 */
export async function inscribeFile(
  filePath: string,
  originalPath: string,
  contentType: string,
  destinationAddress: string,
  paymentKey: PrivateKey,
  indexer: IndexerService,
  content?: Buffer,
  satsPerKb?: number,
  dryRun?: boolean,
  paymentUtxo?: Utxo
): Promise<{ inscription: InscribedFile; changeUtxo?: Utxo }> {
  const fileBuffer = await loadFileContent(filePath, content);
  const fileSize = fileBuffer.length;

  // DRY RUN MODE - Simulate without broadcasting
  if (dryRun) {
    await new Promise((resolve) => setTimeout(resolve, DRY_RUN_DELAY_MS));
    return createDryRunResult(originalPath, fileSize);
  }

  // REAL MODE - Actually inscribe on-chain
  const contentBase64 = fileBuffer.toString('base64');
  const feeEstimate = estimateFeeAndRequiredSats(fileSize, satsPerKb);
  const paymentAddress = paymentKey.toAddress().toString();

  // Select UTXOs for transaction
  let selectedUtxos = await selectUtxosForTransaction({
    paymentUtxo,
    requiredSats: feeEstimate.requiredSats,
    indexer,
    paymentAddress,
    feeEstimate,
  });

  // Build the inscription transaction
  let inscriptionResult = await createOrdinals({
    utxos: selectedUtxos,
    destinations: [
      {
        address: destinationAddress,
        inscription: {
          dataB64: contentBase64,
          contentType,
        },
      },
    ],
    paymentPk: paymentKey,
    satsPerKb,
  });

  // Broadcast with retry and UTXO error recovery
  const txid = await retryWithBackoff(
    async () => {
      try {
        return await indexer.broadcastTransaction(inscriptionResult.tx.toHex());
      } catch (error) {
        // If UTXO error and we're NOT using a provided paymentUtxo, rebuild transaction
        const isRecoverableUtxoError = !paymentUtxo && isUtxoNotFoundError(error as Error);

        if (isRecoverableUtxoError) {
          // Refetch UTXOs and rebuild transaction
          selectedUtxos = await fetchUtxosFromIndexer(indexer, paymentAddress, feeEstimate);

          inscriptionResult = await createOrdinals({
            utxos: selectedUtxos,
            destinations: [
              {
                address: destinationAddress,
                inscription: {
                  dataB64: contentBase64,
                  contentType,
                },
              },
            ],
            paymentPk: paymentKey,
            satsPerKb,
          });
        }

        throw createBroadcastError(originalPath, error, 'inscription');
      }
    },
    {
      maxAttempts: RETRY_MAX_ATTEMPTS,
      initialDelayMs: RETRY_INITIAL_DELAY_MS,
      maxDelayMs: RETRY_MAX_DELAY_MS,
    },
    shouldRetryError
  );

  const inscriptionTx = inscriptionResult.tx;
  const changeUtxo = inscriptionResult.payChange;
  const vout = findInscriptionOutputIndex(inscriptionTx);
  const urlPath = `${CONTENT_PATH}/${txid}_${vout}`;

  return {
    inscription: {
      originalPath,
      txid,
      vout,
      urlPath,
      size: fileSize,
    },
    changeUtxo,
  };
}

/**
 * Helper function to add a UTXO as a transaction input
 */
function addUtxoInput(tx: Transaction, utxo: Utxo, paymentKey: PrivateKey): void {
  const js1SatUtxo = {
    txid: utxo.txid,
    vout: utxo.vout,
    satoshis: utxo.satoshis,
    script: Utils.toHex(Utils.toArray(utxo.script, 'base64')),
  };
  tx.addInput(fromUtxo(js1SatUtxo, new P2PKH().unlock(paymentKey)));
}

/**
 * Helper function to build a B script
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

// ============================================================================
// Public Functions
// ============================================================================

export async function uploadBFile(
  filePath: string,
  originalPath: string,
  contentType: string,
  paymentKey: PrivateKey,
  indexer: IndexerService,
  content?: Buffer,
  satsPerKb?: number,
  dryRun?: boolean,
  paymentUtxo?: Utxo
): Promise<{ inscription: InscribedFile; changeUtxo?: Utxo }> {
  const fileBuffer = await loadFileContent(filePath, content);
  const fileSize = fileBuffer.length;

  // DRY RUN MODE - Simulate without broadcasting
  if (dryRun) {
    await new Promise((resolve) => setTimeout(resolve, DRY_RUN_DELAY_MS));
    return createDryRunResult(originalPath, fileSize);
  }

  // REAL MODE - Actually upload B file on-chain
  const feeEstimate = estimateFeeAndRequiredSats(fileSize, satsPerKb);
  const paymentAddress = paymentKey.toAddress().toString();

  // Helper to build a B file transaction from UTXOs
  const buildBFileTransaction = async (utxosToUse: Utxo[]) => {
    const tx = new Transaction();

    // Add all UTXOs as inputs
    utxosToUse.forEach((utxo) => addUtxoInput(tx, utxo, paymentKey));
    // Add B file output
    tx.addOutput({
      satoshis: 0,
      lockingScript: buildBScript(fileBuffer, contentType),
    });

    // Add change output
    tx.addOutput({
      change: true,
      lockingScript: new P2PKH().lock(paymentAddress),
    });

    await tx.fee(new SatoshisPerKilobyte(feeEstimate.feeRate));
    await tx.sign();

    return tx;
  };

  // Select UTXOs for transaction
  let selectedUtxos = await selectUtxosForTransaction({
    paymentUtxo,
    requiredSats: feeEstimate.requiredSats,
    indexer,
    paymentAddress,
    feeEstimate,
  });

  // Build the transaction
  let bFileTx = await buildBFileTransaction(selectedUtxos);

  // Broadcast with retry and UTXO error recovery
  const txid = await retryWithBackoff(
    async () => {
      try {
        return await indexer.broadcastTransaction(bFileTx.toHex());
      } catch (error) {
        // If UTXO error and we're NOT using a provided paymentUtxo, rebuild transaction
        const isRecoverableUtxoError = !paymentUtxo && isUtxoNotFoundError(error as Error);

        if (isRecoverableUtxoError) {
          // Refetch UTXOs and rebuild transaction
          selectedUtxos = await fetchUtxosFromIndexer(indexer, paymentAddress, feeEstimate);
          bFileTx = await buildBFileTransaction(selectedUtxos);
        }

        throw createBroadcastError(originalPath, error, 'B file');
      }
    },
    {
      maxAttempts: RETRY_MAX_ATTEMPTS,
      initialDelayMs: RETRY_INITIAL_DELAY_MS,
      maxDelayMs: RETRY_MAX_DELAY_MS,
    },
    shouldRetryError
  );

  const vout = 0; // B file output is always at index 0
  const urlPath = `${CONTENT_PATH}/${txid}_${vout}`;

  return {
    inscription: {
      originalPath,
      txid,
      vout,
      urlPath,
      size: fileSize,
    },
    changeUtxo: {
      txid,
      vout: 1,
      satoshis: bFileTx.outputs[1].satoshis || 0,
      script: Utils.toBase64(bFileTx.outputs[1].lockingScript.toBinary()),
    },
  };
}

/**
 * Estimates the cost of inscribing a file
 */
export function estimateInscriptionCost(fileSize: number, satsPerKb: number = 50): number {
  // Base transaction overhead (inputs, outputs, etc.) ~200 bytes
  const baseOverhead = 200;

  // The inscription data itself
  const inscriptionSize = fileSize;

  // Total size in bytes
  const totalSize = baseOverhead + inscriptionSize;

  // Convert to KB and calculate fee
  const sizeInKb = totalSize / 1000;
  const fee = Math.ceil(sizeInKb * satsPerKb);

  // Add the 1 satoshi for the inscription output
  return fee + 1;
}
