import {
  assert,
  ByteString,
  hash256,
  method,
  prop,
  PubKey,
  Sig,
  SmartContract,
  FixedArray,
  toByteString,
  fill,
} from 'scrypt-ts';

export type VersionData = {
  outpoint: ByteString;
  description: ByteString;
  timestamp: bigint;
};

/**
 * ReactOnchainVersioning - On-chain version tracking for React applications
 *
 * This contract maintains version history with full metadata storage
 * for up to 100 versions in a rolling window.
 *
 * Features:
 * - Up to 100 versions with full metadata
 * - Ordered history (newest first)
 * - Per-version metadata (outpoint, description, timestamp)
 * - Immutable origin outpoint (set at deployment)
 * - Single owner authorization
 * - Fully queryable off-chain
 */
export class ReactOnchainVersioning extends SmartContract {
  static readonly MAX_HISTORY = 100;

  @prop()
  readonly owner: PubKey;

  @prop()
  readonly originOutpoint: ByteString;

  @prop()
  readonly appName: ByteString;

  // Ordered history of last 100 versions (newest first)
  @prop(true)
  versionHistory: FixedArray<VersionData, typeof ReactOnchainVersioning.MAX_HISTORY>;

  // Version strings for quick lookup (newest first)
  @prop(true)
  versionStrings: FixedArray<ByteString, typeof ReactOnchainVersioning.MAX_HISTORY>;

  // Total number of versions ever added
  @prop(true)
  versionCount: bigint;

  // Latest version string for quick access
  @prop(true)
  latestVersion: ByteString;

  constructor(
    owner: PubKey,
    originOutpoint: ByteString,
    appName: ByteString,
    versionHistory: FixedArray<VersionData, typeof ReactOnchainVersioning.MAX_HISTORY>,
    versionStrings: FixedArray<ByteString, typeof ReactOnchainVersioning.MAX_HISTORY>,
    versionCount: bigint,
    latestVersion: ByteString
  ) {
    super(...arguments);
    this.owner = owner;
    this.originOutpoint = originOutpoint;
    this.appName = appName;
    this.versionHistory = versionHistory;
    this.versionStrings = versionStrings;
    this.versionCount = versionCount;
    this.latestVersion = latestVersion;
  }

  /**
   * Add a new version to the version history
   * @param ownerSig - Signature from the contract owner
   * @param version - Version string (e.g., "1.0.0")
   * @param outpoint - Location of deployed app (txid_vout format)
   * @param description - Changelog or release notes
   */
  @method()
  public addVersion(
    ownerSig: Sig,
    version: ByteString,
    outpoint: ByteString,
    description: ByteString
  ) {
    // Verify owner signature
    assert(this.checkSig(ownerSig, this.owner), 'Invalid owner signature');

    // Version cannot be empty
    assert(version != toByteString(''), 'Version cannot be empty');

    // Outpoint cannot be empty
    assert(outpoint != toByteString(''), 'Outpoint cannot be empty');

    // Check for duplicate versions by iterating versionStrings
    let isDuplicate = false;
    for (let i = 0; i < ReactOnchainVersioning.MAX_HISTORY; i++) {
      if (this.versionStrings[i] == version) {
        isDuplicate = true;
      }
    }
    assert(!isDuplicate, 'Version already exists');

    // Create version data
    const versionData: VersionData = {
      outpoint: outpoint,
      description: description,
      timestamp: this.ctx.locktime, // Use locktime as timestamp
    };

    // Update latest version
    this.latestVersion = version;

    // Add to history arrays (shift right, insert at index 0)
    for (let i = 0; i < ReactOnchainVersioning.MAX_HISTORY; i++) {
      if (i < ReactOnchainVersioning.MAX_HISTORY - 1) {
        // Shift from end to beginning
        this.versionHistory[ReactOnchainVersioning.MAX_HISTORY - 1 - i] =
          this.versionHistory[ReactOnchainVersioning.MAX_HISTORY - 2 - i];
        this.versionStrings[ReactOnchainVersioning.MAX_HISTORY - 1 - i] =
          this.versionStrings[ReactOnchainVersioning.MAX_HISTORY - 2 - i];
      }
    }
    this.versionHistory[0] = versionData;
    this.versionStrings[0] = version;

    // Increment version count
    this.versionCount++;

    // Ensure contract state is properly propagated
    const amount: bigint = this.ctx.utxo.value;
    const outputs: ByteString = this.buildStateOutput(amount) + this.buildChangeOutput();
    assert(this.ctx.hashOutputs == hash256(outputs), 'hashOutputs mismatch');
  }
}
