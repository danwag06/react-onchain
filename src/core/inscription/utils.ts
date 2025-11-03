/**
 * Inscription-specific utility functions
 */

import { createHash } from 'crypto';
import type { InscribedFile } from './inscription.types.js';
import { OUTPOINT_SEPARATOR } from '../../utils/constants.js';
import { fromUtxo, P2PKH, PrivateKey, Transaction, Utils } from '@bsv/sdk';
import { Utxo } from 'js-1sat-ord';

/**
 * Extracts outpoint (txid_vout) from inscribed file
 */
export function extractOutpointFromFile(file: InscribedFile): string {
  return file.urlPath.split('/').pop() || `${file.txid}${OUTPOINT_SEPARATOR}${file.vout}`;
}

/**
 * Calculates SHA256 hash of sorted dependency URLs
 */
export function calculateDependencyHash(
  dependencies: string[],
  urlMap: Map<string, string>
): string {
  const dependencyUrls = dependencies
    .map((dep) => urlMap.get(dep))
    .filter((url): url is string => url !== undefined)
    .sort();

  return createHash('sha256').update(dependencyUrls.join('|')).digest('hex');
}

/**
 * Suggests next version by incrementing the last number
 */
export function suggestNextVersion(version: string): string {
  const lastNumber = version.split('.').pop();
  const newLastNumber = Number(lastNumber) + 1;
  return `${version.split('.').slice(0, -1).join('.')}.${newLastNumber}`;
}

/**
 * Checks if a file path represents index.html
 */
export function isIndexHtmlFile(filePath: string): boolean {
  return filePath === 'index.html' || filePath.endsWith('/index.html');
}

/**
 * Helper function to add a UTXO as a transaction input
 */
export const addUtxoInput = (tx: Transaction, utxo: Utxo, paymentKey: PrivateKey): Transaction => {
  const js1SatUtxo = {
    txid: utxo.txid,
    vout: utxo.vout,
    satoshis: utxo.satoshis,
    script: Utils.toHex(Utils.toArray(utxo.script, 'base64')),
  };
  tx.addInput(fromUtxo(js1SatUtxo, new P2PKH().unlock(paymentKey)));
  return tx;
};
