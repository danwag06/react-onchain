/**
 * Versioning Inscription Orchestration
 *
 * Handles the inscription of versioning metadata using 1-sat ordinals.
 * Extracted from orchestrator.ts for better maintainability.
 */

import { PrivateKey } from '@bsv/sdk';
import type { Utxo } from 'js-1sat-ord';
import {
  deployVersioningInscription,
  updateVersioningInscription,
  VERSIONING_ENABLED,
} from './versioningHandler.js';
import { extractOutpointFromFile } from '../inscription/utils.js';
import type { InscribedFile } from '../inscription/inscription.types.js';
import type { OrchestratorCallbacks } from '../orchestration/orchestration.types.js';
import { formatError } from '../../utils/errors.js';
import {
  VERSIONING_ORIGIN_TYPE,
  VERSIONING_METADATA_TYPE,
  CONTENT_PATH_PREFIX,
  OUTPOINT_SEPARATOR,
  MOCK_VERSIONING_TXID,
  DEFAULT_INSCRIPTION_VOUT,
} from '../../utils/constants.js';

/**
 * Result of versioning origin inscription deployment
 */
export interface VersioningOriginResult {
  finalVersioningOriginInscription: string;
  seedUtxo?: Utxo;
  txid?: string;
}

/**
 * Handles versioning origin inscription for first-time deployments
 *
 * @param versioningOriginInscription - Existing origin inscription (undefined for first deployment)
 * @param dryRun - Whether this is a dry run (no actual inscription)
 * @param paymentPk - Private key for payment
 * @param appName - Application name for the inscription
 * @param destinationAddress - Destination address for the inscription
 * @param satsPerKb - Satoshis per KB for fees
 * @param callbacks - Optional progress callbacks
 * @param totalFiles - Total number of files for progress tracking
 * @returns Versioning origin result with inscription details
 */
export async function handleVersioningOriginInscription(
  versioningOriginInscription: string | undefined,
  dryRun: boolean,
  paymentPk: PrivateKey,
  appName: string,
  destinationAddress: string,
  satsPerKb: number | undefined,
  callbacks: OrchestratorCallbacks | undefined,
  totalFiles: number
): Promise<VersioningOriginResult> {
  let finalVersioningOriginInscription = versioningOriginInscription;
  let seedUtxo: Utxo | undefined = undefined;
  let txid: string | undefined = undefined;

  if (!versioningOriginInscription && !dryRun && VERSIONING_ENABLED) {
    callbacks?.onInscriptionStart?.(VERSIONING_ORIGIN_TYPE, 1, totalFiles);
    try {
      const versioningResult = await deployVersioningInscription(
        paymentPk,
        appName || 'ReactApp',
        destinationAddress,
        satsPerKb
      );
      finalVersioningOriginInscription = versioningResult.outpoint;
      seedUtxo = versioningResult.changeUtxo; // Capture change UTXO to avoid indexer timing issues

      const originTxid = finalVersioningOriginInscription.split(OUTPOINT_SEPARATOR)[0];
      txid = originTxid;
      callbacks?.onInscriptionComplete?.(
        VERSIONING_ORIGIN_TYPE,
        `${CONTENT_PATH_PREFIX}${finalVersioningOriginInscription}`
      );

      if (seedUtxo) {
        callbacks?.onProgress?.(
          `  ✓ Change UTXO captured: ${seedUtxo.txid}:${seedUtxo.vout} (${seedUtxo.satoshis} sats)`
        );
      }
    } catch (error) {
      throw new Error(`Failed to deploy versioning inscription: ${formatError(error)}`);
    }
  } else if (dryRun && !versioningOriginInscription) {
    finalVersioningOriginInscription = `${MOCK_VERSIONING_TXID}${OUTPOINT_SEPARATOR}${DEFAULT_INSCRIPTION_VOUT}`;
  }

  if (!finalVersioningOriginInscription) {
    throw new Error('Versioning inscription origin was not set');
  }

  return {
    finalVersioningOriginInscription,
    seedUtxo,
    txid,
  };
}

/**
 * Handles versioning metadata update inscription for subsequent deployments
 *
 * @param finalVersioningOriginInscription - The final versioning origin inscription outpoint
 * @param versioningOriginInscription - Original versioning origin (may be undefined)
 * @param entryPoint - The HTML entry point inscription
 * @param paymentPk - Private key for payment
 * @param version - Version string (e.g., "1.0.0")
 * @param versionDescription - Description of this version
 * @param destinationAddress - Destination address for the inscription
 * @param satsPerKb - Satoshis per KB for fees
 * @param dryRun - Whether this is a dry run
 * @param callbacks - Optional progress callbacks
 * @returns Latest versioning inscription outpoint and txid (if created)
 */
export async function handleVersioningMetadataUpdate(
  finalVersioningOriginInscription: string | undefined,
  versioningOriginInscription: string | undefined,
  entryPoint: InscribedFile,
  paymentPk: PrivateKey,
  version: string,
  versionDescription: string | undefined,
  destinationAddress: string,
  satsPerKb: number | undefined,
  dryRun: boolean,
  callbacks: OrchestratorCallbacks | undefined
): Promise<{ latestVersioningInscription?: string; txid?: string }> {
  let latestVersioningInscription: string | undefined;
  let txid: string | undefined;

  if (finalVersioningOriginInscription && VERSIONING_ENABLED && !dryRun) {
    try {
      const entryPointOutpoint = extractOutpointFromFile(entryPoint);
      latestVersioningInscription = await updateVersioningInscription(
        versioningOriginInscription || finalVersioningOriginInscription,
        paymentPk,
        paymentPk,
        version,
        entryPointOutpoint,
        versionDescription || `Version ${version}`,
        destinationAddress,
        satsPerKb
      );
      const metadataTxid = latestVersioningInscription.split(OUTPOINT_SEPARATOR)[0];
      txid = metadataTxid;
      callbacks?.onInscriptionComplete?.(
        VERSIONING_METADATA_TYPE,
        `${CONTENT_PATH_PREFIX}${latestVersioningInscription}`
      );
    } catch (error) {
      console.error('❌ Failed to update versioning inscription');
      throw error;
    }
  }

  return { latestVersioningInscription, txid };
}
