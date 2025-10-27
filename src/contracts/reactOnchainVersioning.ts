import {
  assert,
  ByteString,
  hash256,
  HashedMap,
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
 * This contract maintains an unlimited version history using HashedMap storage
 * with a rolling window of the last 10 versions for efficient history queries.
 *
 * Features:
 * - Unlimited version storage via HashedMap
 * - Last 10 versions in ordered history
 * - Per-version metadata (outpoint, description, timestamp)
 * - Immutable origin outpoint
 * - Single owner authorization
 */
export class ReactOnchainVersioning extends SmartContract {
  static readonly MAX_HISTORY = 10;

  @prop()
  readonly owner: PubKey;

  @prop(true)
  originOutpoint: ByteString;

  @prop()
  readonly appName: ByteString;

  // Unlimited version storage
  @prop(true)
  versionMap: HashedMap<ByteString, VersionData>;

  // Ordered history of last 10 versions (newest first)
  @prop(true)
  versionHistory: FixedArray<ByteString, typeof ReactOnchainVersioning.MAX_HISTORY>;

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
    versionMap: HashedMap<ByteString, VersionData>
  ) {
    super(...arguments);
    this.owner = owner;
    this.originOutpoint = originOutpoint;
    this.appName = appName;
    this.versionMap = versionMap;
    this.versionHistory = fill(toByteString(''), ReactOnchainVersioning.MAX_HISTORY);
    this.versionCount = 0n;
    this.latestVersion = toByteString('');
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

    // Version cannot already exist (prevent duplicate versions)
    assert(!this.versionMap.has(version), 'Version already exists');

    // Create version data
    const versionData: VersionData = {
      outpoint: outpoint,
      description: description,
      timestamp: this.ctx.locktime, // Use locktime as timestamp
    };

    // Add to version map
    this.versionMap.set(version, versionData);

    // Update latest version
    this.latestVersion = version;

    // Add to history (shift array right, insert at index 0)
    // Iterate through all positions and shift
    for (let i = 0; i < ReactOnchainVersioning.MAX_HISTORY; i++) {
      if (i < ReactOnchainVersioning.MAX_HISTORY - 1) {
        // Shift from end to beginning
        this.versionHistory[ReactOnchainVersioning.MAX_HISTORY - 1 - i] =
          this.versionHistory[ReactOnchainVersioning.MAX_HISTORY - 2 - i];
      }
    }
    this.versionHistory[0] = version;

    // Increment version count
    this.versionCount++;

    // Ensure contract state is properly propagated
    const amount: bigint = this.ctx.utxo.value;
    const outputs: ByteString = this.buildStateOutput(amount) + this.buildChangeOutput();
    assert(this.ctx.hashOutputs == hash256(outputs), 'hashOutputs mismatch');
  }

  /**
   * Verify a version exists in the history
   * Used for on-chain verification with expected data
   */
  @method()
  public verifyVersionExists(version: ByteString, expectedData: VersionData) {
    assert(this.versionMap.has(version), 'Version does not exist');
    assert(this.versionMap.canGet(version, expectedData), 'Version data mismatch');

    // Ensure state is maintained
    const amount: bigint = this.ctx.utxo.value;
    const outputs: ByteString = this.buildStateOutput(amount) + this.buildChangeOutput();
    assert(this.ctx.hashOutputs == hash256(outputs), 'hashOutputs mismatch');
  }

  /**
   * Update the origin outpoint (one-time only, if currently "pending")
   * @param ownerSig - Signature from the contract owner
   * @param newOrigin - The actual origin outpoint after inscription
   */
  @method()
  public updateOrigin(ownerSig: Sig, newOrigin: ByteString) {
    // Verify owner signature
    assert(this.checkSig(ownerSig, this.owner), 'Invalid owner signature');

    // Can only update if current origin is "pending"
    assert(
      this.originOutpoint == toByteString('pending', true),
      'Origin already set, cannot update'
    );

    // New origin cannot be empty or "pending"
    assert(newOrigin != toByteString(''), 'New origin cannot be empty');
    assert(newOrigin != toByteString('pending', true), 'New origin cannot be pending');

    // Update origin
    this.originOutpoint = newOrigin;

    // Ensure contract state is properly propagated
    const amount: bigint = this.ctx.utxo.value;
    const outputs: ByteString = this.buildStateOutput(amount) + this.buildChangeOutput();
    assert(this.ctx.hashOutputs == hash256(outputs), 'hashOutputs mismatch');
  }
}
