import { readFile } from 'fs/promises';
import { PrivateKey } from '@bsv/sdk';
import { createOrdinals } from 'js-1sat-ord';
import type { Utxo } from 'js-1sat-ord';
import type { InscribedFile } from './types.js';
import { createHash } from 'crypto';
import { retryWithBackoff, shouldRetryError, isUtxoNotFoundError } from './retryUtils.js';
import type { IndexerService, UTXO } from './services/IndexerService.js';
import { CONTENT_PATH } from './services/gorilla-pool/constants.js';

/**
 * Generates a mock transaction ID for dry-run mode
 */
function generateMockTxid(filePath: string): string {
  const hash = createHash('sha256').update(filePath).digest('hex');
  return hash.substring(0, 64);
}

/**
 * Convert IndexerService UTXO format to js-1sat-ord Utxo format
 * Note: js-1sat-ord expects base64 encoded scripts, IndexerService uses hex
 */
function convertToJsOrdUtxo(utxo: UTXO): Utxo {
  return {
    satoshis: utxo.satoshis,
    txid: utxo.txId,
    vout: utxo.outputIndex,
    script: Buffer.from(utxo.script, 'hex').toString('base64'),
  };
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
  content?: string,
  satsPerKb?: number,
  dryRun?: boolean,
  paymentUtxo?: Utxo
): Promise<{ inscription: InscribedFile; changeUtxo?: Utxo }> {
  // Read file content (use provided content if available, otherwise read from file)
  let fileContent: string;
  if (content !== undefined) {
    fileContent = content;
  } else {
    const buffer = await readFile(filePath);
    fileContent = buffer.toString('utf-8');
  }

  const fileSize = Buffer.from(fileContent).length;

  // DRY RUN MODE - Simulate without broadcasting
  if (dryRun) {
    const mockTxid = generateMockTxid(originalPath);
    const vout = 0;
    // Use relative URL path for maximum portability across service providers
    const urlPath = `${CONTENT_PATH}/${mockTxid}_${vout}`;

    // Small delay to simulate network activity
    await new Promise((resolve) => setTimeout(resolve, 100));

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

  // REAL MODE - Actually inscribe on-chain
  // Convert content to base64
  const dataB64 = Buffer.from(fileContent).toString('base64');

  // Estimate required funding
  // Rough estimate: inscription data + 500 bytes overhead (inputs, outputs, signatures)
  const estimatedTxSize = fileSize + 500;
  const feeRate = satsPerKb || 50;
  const estimatedFee = Math.ceil((estimatedTxSize / 1000) * feeRate);
  const requiredSats = estimatedFee + 1; // +1 for inscription output

  // Fetch UTXOs and build transaction ONCE (outside retry loop)
  let utxos: Utxo[];
  const paymentAddress = paymentKey.toAddress().toString();

  if (paymentUtxo) {
    // Check if the change UTXO has enough funds
    if (paymentUtxo.satoshis >= requiredSats) {
      // Use the provided UTXO (change from previous transaction)
      utxos = [paymentUtxo];
    } else {
      // Change UTXO is insufficient, fetch additional UTXOs
      const indexerUtxos = await indexer.listUnspent(paymentAddress, {
        unspentValue: 1, // 1 sat for inscription output
        estimateSize: estimatedTxSize,
        feePerKb: feeRate,
        additional: 100, // Small buffer
      });

      if (!indexerUtxos || indexerUtxos.length === 0) {
        throw new Error(`No additional UTXOs found for payment address ${paymentAddress}`);
      }

      // Convert IndexerService UTXOs to js-1sat-ord format
      const freshUtxos = indexerUtxos.map(convertToJsOrdUtxo);

      // Combine change UTXO with fresh UTXOs
      utxos = [paymentUtxo, ...freshUtxos];
    }
  } else {
    // No change UTXO, fetch UTXOs from indexer with funding requirements
    const indexerUtxos = await indexer.listUnspent(paymentAddress, {
      unspentValue: 1, // 1 sat for inscription output
      estimateSize: estimatedTxSize,
      feePerKb: feeRate,
      additional: 100, // Small buffer
    });

    if (!indexerUtxos || indexerUtxos.length === 0) {
      throw new Error(`No UTXOs found for payment address ${paymentAddress}`);
    }

    // Convert IndexerService UTXOs to js-1sat-ord format
    utxos = indexerUtxos.map(convertToJsOrdUtxo);
  }

  // Build the inscription transaction ONCE
  let result = await createOrdinals({
    utxos,
    destinations: [
      {
        address: destinationAddress,
        inscription: {
          dataB64,
          contentType,
        },
      },
    ],
    paymentPk: paymentKey,
    satsPerKb,
  });

  // Only retry the broadcast (transaction is already built)
  const txid = await retryWithBackoff(
    async () => {
      // Broadcast the transaction via IndexerService
      try {
        const txid = await indexer.broadcastTransaction(result.tx.toHex());
        return txid;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // If UTXO error and we're NOT using a provided paymentUtxo, try to rebuild transaction
        if (
          !paymentUtxo &&
          isUtxoNotFoundError(error instanceof Error ? error : new Error(errorMsg))
        ) {
          // Refetch UTXOs with funding requirements
          const indexerUtxos = await indexer.listUnspent(paymentAddress, {
            unspentValue: 1,
            estimateSize: estimatedTxSize,
            feePerKb: feeRate,
            additional: 100,
          });

          if (!indexerUtxos || indexerUtxos.length === 0) {
            throw new Error(`No UTXOs found for payment address ${paymentAddress}`);
          }

          // Convert and rebuild transaction with fresh UTXOs
          utxos = indexerUtxos.map(convertToJsOrdUtxo);

          result = await createOrdinals({
            utxos,
            destinations: [
              {
                address: destinationAddress,
                inscription: {
                  dataB64,
                  contentType,
                },
              },
            ],
            paymentPk: paymentKey,
            satsPerKb,
          });
        }

        throw new Error(
          `Failed to broadcast inscription transaction for ${originalPath}: ${errorMsg}`
        );
      }
    },
    {
      maxAttempts: 5,
      initialDelayMs: 2000,
      maxDelayMs: 30000,
    },
    shouldRetryError
  );

  const tx = result.tx;
  const payChange = result.payChange;

  // Find the inscription output - it's the 1-sat output to the destination address
  let vout = 0;

  for (let i = 0; i < tx.outputs.length; i++) {
    const output = tx.outputs[i];

    // The inscription output is always 1 satoshi
    if (output.satoshis === 1) {
      vout = i;
      break;
    }
  }

  // Use relative URL path for maximum portability across service providers
  const urlPath = `${CONTENT_PATH}/${txid}_${vout}`;

  return {
    inscription: {
      originalPath,
      txid,
      vout,
      urlPath,
      size: fileSize,
    },
    changeUtxo: payChange,
  };
}

/**
 * Inscribes multiple files in sequence
 */
export async function inscribeFiles(
  files: Array<{
    filePath: string;
    originalPath: string;
    contentType: string;
    content?: string;
  }>,
  destinationAddress: string,
  paymentKey: PrivateKey,
  indexer: IndexerService,
  satsPerKb?: number,
  onProgress?: (current: number, total: number, file: string) => void
): Promise<InscribedFile[]> {
  const inscriptions: InscribedFile[] = [];
  let changeUtxo: Utxo | undefined;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    if (onProgress) {
      onProgress(i + 1, files.length, file.originalPath);
    }

    const result = await inscribeFile(
      file.filePath,
      file.originalPath,
      file.contentType,
      destinationAddress,
      paymentKey,
      indexer,
      file.content,
      satsPerKb,
      false, // not dry-run
      changeUtxo
    );

    inscriptions.push(result.inscription);
    changeUtxo = result.changeUtxo;

    // Small delay between inscriptions (only if not using change UTXO)
    if (i < files.length - 1 && !changeUtxo) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return inscriptions;
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
