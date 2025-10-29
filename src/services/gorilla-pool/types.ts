export type GorillaPoolUTXO = {
  txid: string;
  vout: number;
  outpoint: string;
  satoshis: number;
  accSats: string;
  height: number | null;
  idx: string;
  owner: string;
  spend: string;
  spend_height: number | null;
  spend_idx: number | null;
  origin: string | null;
  data: string | null;
  script?: string; // Base64 encoded script (when ?script=true is used)
};
