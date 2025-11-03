import { fromUtxo, P2PKH, PrivateKey, Transaction, Utils } from '@bsv/sdk';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { Utxo } from 'js-1sat-ord';

export const getManifestLatestVersion = async (manifest: any) => {
  let manifestLatestVersion: string | null = null;
  if (existsSync(manifest)) {
    const manifestJson = await readFile(manifest, 'utf-8');
    const manifestData = JSON.parse(manifestJson);
    if ('manifestVersion' in manifestData && 'deployments' in manifestData) {
      const latestDeployment = manifestData.deployments[manifestData.deployments.length - 1];
      manifestLatestVersion = latestDeployment?.version;
    }
  }
  return manifestLatestVersion;
};

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
