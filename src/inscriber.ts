import { readFile } from 'fs/promises';
import { PrivateKey, type Transaction, type BroadcastResponse, type BroadcastFailure } from '@bsv/sdk';
import { createOrdinals, fetchPayUtxos } from 'js-1sat-ord';
import type { Utxo } from 'js-1sat-ord';
import type { InscribedFile } from './types.js';
import { createHash } from 'crypto';
import { retryWithBackoff, shouldRetryError } from './retryUtils.js';

/**
 * Generates a mock transaction ID for dry-run mode
 */
function generateMockTxid(filePath: string): string {
  const hash = createHash('sha256').update(filePath).digest('hex');
  return hash.substring(0, 64);
}

/**
 * Custom broadcaster for 1Sat Ordinals API
 * Uses native fetch (Node 18+) to broadcast transactions
 */
async function broadcast1Sat(tx: Transaction): Promise<BroadcastResponse | BroadcastFailure> {
  const url = 'https://ordinals.1sat.app/v5/tx';

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
      },
      body: Buffer.from(tx.toBinary()),
    });

    const body = await response.json() as {
      txid: string;
      success: boolean;
      error: string;
      status: number;
    };

    if (response.status !== 200) {
      return {
        status: 'error',
        code: response.status.toString(),
        description: body.error || 'Unknown error',
      } as BroadcastFailure;
    }

    return {
      status: 'success',
      txid: body.txid,
      message: 'Transaction broadcast successfully',
    } as BroadcastResponse;
  } catch (error) {
    return {
      status: 'error',
      code: '500',
      description: error instanceof Error ? error.message : 'Network error',
    } as BroadcastFailure;
  }
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
  content?: string,
  satsPerKb?: number,
  dryRun?: boolean,
  paymentUtxo?: Utxo,
  ordinalContentUrl?: string
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
    const contentUrl = ordinalContentUrl || 'https://ordfs.network/content';
    const url = `${contentUrl}/${mockTxid}_${vout}`;

    // Small delay to simulate network activity
    await new Promise(resolve => setTimeout(resolve, 100));

    return {
      inscription: {
        originalPath,
        txid: mockTxid,
        vout,
        url,
        size: fileSize,
      },
    };
  }

  // REAL MODE - Actually inscribe on-chain
  // Convert content to base64
  const dataB64 = Buffer.from(fileContent).toString('base64');

  // Wrap inscription and broadcast in retry logic
  const { txid, tx, payChange } = await retryWithBackoff(
    async () => {
      // Get UTXOs for payment (refetch on each retry unless specific UTXO provided)
      let utxos: Utxo[];

      if (paymentUtxo) {
        // Use the provided UTXO (change from previous transaction)
        console.log(`   Using change UTXO: ${paymentUtxo.txid}:${paymentUtxo.vout} (${paymentUtxo.satoshis} sats)`);
        utxos = [paymentUtxo];
      } else {
        // Fetch UTXOs from the network (refetches on each retry)
        const paymentAddress = paymentKey.toAddress().toString();
        utxos = await fetchPayUtxos(paymentAddress);

        if (!utxos || utxos.length === 0) {
          throw new Error(`No UTXOs found for payment address ${paymentAddress}`);
        }

        console.log(`   Found ${utxos.length} UTXO(s) for ${originalPath}`);
        utxos.forEach((u, i) => {
          console.log(`     [${i}] ${u.txid}:${u.vout} (${u.satoshis} sats)`);
        });
      }

      // Create the inscription
      const result = await createOrdinals({
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

      // Log which UTXOs are being spent
      console.log(`   Spending ${utxos.length} input(s):`);
      utxos.forEach((u, i) => {
        console.log(`     Input[${i}]: ${u.txid}:${u.vout} (${u.satoshis} sats)`);
      });

      // Broadcast the transaction to 1Sat Ordinals API
      console.log(`   Broadcasting transaction for ${originalPath}...`);
      const broadcastResult = await broadcast1Sat(result.tx);

      if (broadcastResult.status !== 'success') {
        const errorMsg = broadcastResult.description || 'Unknown error';
        console.log(`   ❌ Broadcast failed: ${errorMsg}`);

        throw new Error(
          `Failed to broadcast inscription transaction for ${originalPath}: ${errorMsg}`
        );
      }

      console.log(`   ✅ Broadcast successful: ${broadcastResult.txid}`);


      return {
        txid: broadcastResult.txid!,
        tx: result.tx,
        payChange: result.payChange,
      };
    },
    {
      maxAttempts: 5,
      initialDelayMs: 2000,
      maxDelayMs: 30000,
    },
    shouldRetryError
  );

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

  const contentUrl = ordinalContentUrl || 'https://ordfs.network/content';
  const url = `${contentUrl}/${txid}_${vout}`;

  return {
    inscription: {
      originalPath,
      txid,
      vout,
      url,
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
      file.content,
      satsPerKb,
      false, // not dry-run
      changeUtxo
    );

    inscriptions.push(result.inscription);
    changeUtxo = result.changeUtxo;

    // Small delay between inscriptions (only if not using change UTXO)
    if (i < files.length - 1 && !changeUtxo) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return inscriptions;
}

/**
 * Estimates the cost of inscribing a file
 */
export function estimateInscriptionCost(
  fileSize: number,
  satsPerKb: number = 50
): number {
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
