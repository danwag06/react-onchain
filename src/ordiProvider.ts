import {
  bsv,
  Provider,
  TransactionResponse,
  TxHash,
  UtxoQueryOptions,
  AddressOption,
  UTXO,
  DefaultProvider,
} from 'scrypt-ts';
import { IndexerService } from './services/IndexerService.js';

/**
 * OrdiProvider - Custom Provider implementation for BSV ordinals
 *
 * Extends scrypt-ts Provider and uses an IndexerService for all blockchain operations.
 * The indexer service is swappable, allowing support for different API providers.
 */
export class OrdiProvider extends Provider {
  private network: bsv.Networks.Network = bsv.Networks.mainnet;
  private _provider: Provider;
  private indexer: IndexerService;
  private satsPerKb: number;

  constructor(network: bsv.Networks.Network, indexer: IndexerService, satsPerKb?: number) {
    super();
    this.network = network;
    this.indexer = indexer;
    this.satsPerKb = satsPerKb ?? 1; // Default to 1 sat/KB if not provided
    this._provider = new DefaultProvider({
      network: this.network,
    });
  }

  private _connected: boolean = false;

  isConnected(): boolean {
    return this._connected;
  }

  async connect(): Promise<this> {
    // We use IndexerService for all critical operations (broadcast, listUnspent, getTransaction)
    // so we don't need to connect to DefaultProvider (which would hit Whatsonchain rate limits)
    this._connected = true;
    this.emit('connected', true);
    return Promise.resolve(this);
  }

  updateNetwork(network: bsv.Networks.Network): void {
    this.network = network;
    this._provider.updateNetwork(network);
    this.emit('networkChange', network);
  }

  getNetwork(): bsv.Networks.Network {
    return this.network;
  }

  async sendRawTransaction(rawTxHex: string): Promise<TxHash> {
    try {
      const txid = await this.indexer.broadcastTransaction(rawTxHex);
      return txid;
    } catch (error) {
      throw new Error(`OrdProvider ERROR: ${error}`);
    }
  }

  async listUnspent(address: AddressOption, options?: UtxoQueryOptions): Promise<UTXO[]> {
    // Convert AddressOption to string (handle both string and Address object)
    const addressStr = typeof address === 'string' ? address : address.toString();
    return await this.indexer.listUnspent(addressStr, options);
  }

  async getBalance(address: AddressOption): Promise<{ confirmed: number; unconfirmed: number }> {
    // Convert AddressOption to string (handle both string and Address object)
    const addressStr = typeof address === 'string' ? address : address.toString();
    return await this.indexer.getBalance(addressStr);
  }

  getTransaction(txHash: string): Promise<TransactionResponse> {
    return this.indexer.getTransaction(txHash);
  }

  getFeePerKb(): Promise<number> {
    // Return configured fee rate instead of calling DefaultProvider (WhatsOnChain)
    return Promise.resolve(this.satsPerKb);
  }
}
