import { expect, use } from 'chai';
import { ReactOnchainVersioning, VersionData } from '../src/contracts/reactOnchainVersioning';
import { getDefaultSigner } from './utils/helper';
import {
  bsv,
  MethodCallOptions,
  PubKey,
  findSig,
  toByteString,
  HashedMap,
  ByteString,
} from 'scrypt-ts';
import chaiAsPromised from 'chai-as-promised';
import artifact from '../artifacts/reactOnchainVersioning.json';

use(chaiAsPromised);

describe('Test SmartContract `ReactOnchainVersioning`', () => {
  let ownerPrivKey: bsv.PrivateKey;
  let nonOwnerPrivKey: bsv.PrivateKey;
  let versioning: ReactOnchainVersioning;

  const originOutpoint = toByteString('abc123_0', true);
  const appName = toByteString('MyReactApp', true);

  before(async () => {
    // Generate keys
    ownerPrivKey = bsv.PrivateKey.fromRandom(bsv.Networks.testnet);
    nonOwnerPrivKey = bsv.PrivateKey.fromRandom(bsv.Networks.testnet);

    // Load contract artifact by importing the JSON
    await ReactOnchainVersioning.loadArtifact(artifact);
  });

  beforeEach(() => {
    // Create fresh instance for each test
    versioning = new ReactOnchainVersioning(
      PubKey(ownerPrivKey.publicKey.toByteString()),
      originOutpoint,
      appName,
      new HashedMap<ByteString, VersionData>()
    );
  });

  it('should deploy contract with initial state', async () => {
    await versioning.connect(getDefaultSigner(ownerPrivKey));
    await versioning.deploy(1);

    expect(versioning.versionCount).to.equal(0n);
    expect(versioning.latestVersion).to.equal(toByteString(''));
    expect(versioning.originOutpoint).to.equal(originOutpoint);
    expect(versioning.appName).to.equal(appName);
  });

  it('should add first version successfully', async () => {
    await versioning.connect(getDefaultSigner(ownerPrivKey));
    await versioning.deploy(1);

    const version = toByteString('1.0.0', true);
    const outpoint = toByteString('def456_0', true);
    const description = toByteString('Initial release', true);

    const nextInstance = versioning.next();
    nextInstance.versionCount = 1n;
    nextInstance.latestVersion = version;
    nextInstance.versionHistory[0] = version;
    nextInstance.versionMap.set(version, {
      outpoint,
      description,
      timestamp: 0n,
    });

    const callAddVersion = async () =>
      versioning.methods.addVersion(
        (sigResps) => findSig(sigResps, ownerPrivKey.publicKey),
        version,
        outpoint,
        description,
        {
          pubKeyOrAddrToSign: ownerPrivKey.publicKey,
          lockTime: 0,
          next: {
            instance: nextInstance,
            balance: 1,
          },
        } as MethodCallOptions<ReactOnchainVersioning>
      );

    await expect(callAddVersion()).not.to.be.rejected;
  });

  it('should add multiple versions in sequence', async () => {
    await versioning.connect(getDefaultSigner(ownerPrivKey));
    await versioning.deploy(1);

    const versions = [
      {
        version: toByteString('1.0.0', true),
        outpoint: toByteString('aaa111_0', true),
        description: toByteString('Initial release', true),
      },
      {
        version: toByteString('1.0.1', true),
        outpoint: toByteString('bbb222_0', true),
        description: toByteString('Bug fixes', true),
      },
      {
        version: toByteString('2.0.0', true),
        outpoint: toByteString('ccc333_0', true),
        description: toByteString('Major update', true),
      },
    ];

    let currentInstance = versioning;

    for (let i = 0; i < versions.length; i++) {
      const { version, outpoint, description } = versions[i];

      const nextInstance = currentInstance.next();
      nextInstance.versionCount = BigInt(i + 1);
      nextInstance.latestVersion = version;

      // Shift history and insert new version at index 0
      for (let j = ReactOnchainVersioning.MAX_HISTORY - 1; j > 0; j--) {
        nextInstance.versionHistory[j] = currentInstance.versionHistory[j - 1];
      }
      nextInstance.versionHistory[0] = version;

      nextInstance.versionMap.set(version, {
        outpoint,
        description,
        timestamp: BigInt(i),
      });

      const { nexts } = await currentInstance.methods.addVersion(
        (sigResps) => findSig(sigResps, ownerPrivKey.publicKey),
        version,
        outpoint,
        description,
        {
          pubKeyOrAddrToSign: ownerPrivKey.publicKey,
          lockTime: i,
          next: {
            instance: nextInstance,
            balance: 1,
          },
        } as MethodCallOptions<ReactOnchainVersioning>
      );

      currentInstance = nexts[0].instance as ReactOnchainVersioning;
    }

    // Verify final state
    expect(currentInstance.versionCount).to.equal(3n);
    expect(currentInstance.latestVersion).to.equal(toByteString('2.0.0', true));
    expect(currentInstance.versionHistory[0]).to.equal(toByteString('2.0.0', true));
    expect(currentInstance.versionHistory[1]).to.equal(toByteString('1.0.1', true));
    expect(currentInstance.versionHistory[2]).to.equal(toByteString('1.0.0', true));
  });

  it('should reject adding version with empty version string', async () => {
    await versioning.connect(getDefaultSigner(ownerPrivKey));
    await versioning.deploy(1);

    const emptyVersion = toByteString('');
    const outpoint = toByteString('xyz789_0', true);
    const description = toByteString('Test', true);

    const nextInstance = versioning.next();

    const callAddEmpty = async () =>
      versioning.methods.addVersion(
        (sigResps) => findSig(sigResps, ownerPrivKey.publicKey),
        emptyVersion,
        outpoint,
        description,
        {
          pubKeyOrAddrToSign: ownerPrivKey.publicKey,
          lockTime: 0,
          next: {
            instance: nextInstance,
            balance: 1,
          },
        } as MethodCallOptions<ReactOnchainVersioning>
      );

    await expect(callAddEmpty()).to.be.rejectedWith(/Version cannot be empty/);
  });

  it('should reject adding version with empty outpoint', async () => {
    await versioning.connect(getDefaultSigner(ownerPrivKey));
    await versioning.deploy(1);

    const version = toByteString('1.0.0', true);
    const emptyOutpoint = toByteString('');
    const description = toByteString('Test', true);

    const nextInstance = versioning.next();

    const callAddEmpty = async () =>
      versioning.methods.addVersion(
        (sigResps) => findSig(sigResps, ownerPrivKey.publicKey),
        version,
        emptyOutpoint,
        description,
        {
          pubKeyOrAddrToSign: ownerPrivKey.publicKey,
          lockTime: 0,
          next: {
            instance: nextInstance,
            balance: 1,
          },
        } as MethodCallOptions<ReactOnchainVersioning>
      );

    await expect(callAddEmpty()).to.be.rejectedWith(/Outpoint cannot be empty/);
  });

  it('should reject adding duplicate version', async () => {
    await versioning.connect(getDefaultSigner(ownerPrivKey));
    await versioning.deploy(1);

    const version = toByteString('1.0.0', true);
    const outpoint1 = toByteString('aaa111_0', true);
    const outpoint2 = toByteString('bbb222_0', true);
    const description = toByteString('Test', true);

    // Add first version
    const nextInstance1 = versioning.next();
    nextInstance1.versionCount = 1n;
    nextInstance1.latestVersion = version;
    nextInstance1.versionHistory[0] = version;
    nextInstance1.versionMap.set(version, {
      outpoint: outpoint1,
      description,
      timestamp: 0n,
    });

    const { nexts } = await versioning.methods.addVersion(
      (sigResps) => findSig(sigResps, ownerPrivKey.publicKey),
      version,
      outpoint1,
      description,
      {
        pubKeyOrAddrToSign: ownerPrivKey.publicKey,
        lockTime: 0,
        next: {
          instance: nextInstance1,
          balance: 1,
        },
      } as MethodCallOptions<ReactOnchainVersioning>
    );

    const currentInstance = nexts[0].instance as ReactOnchainVersioning;

    // Try to add same version again (should fail)
    const nextInstance2 = currentInstance.next();

    const callAddDuplicate = async () =>
      currentInstance.methods.addVersion(
        (sigResps) => findSig(sigResps, ownerPrivKey.publicKey),
        version,
        outpoint2,
        description,
        {
          pubKeyOrAddrToSign: ownerPrivKey.publicKey,
          lockTime: 0,
          next: {
            instance: nextInstance2,
            balance: 1,
          },
        } as MethodCallOptions<ReactOnchainVersioning>
      );

    await expect(callAddDuplicate()).to.be.rejectedWith(/Version already exists/);
  });

  it('should reject non-owner adding version', async () => {
    await versioning.connect(getDefaultSigner(nonOwnerPrivKey));
    await versioning.deploy(1);

    const version = toByteString('1.0.0', true);
    const outpoint = toByteString('xyz789_0', true);
    const description = toByteString('Unauthorized', true);

    const nextInstance = versioning.next();

    const callAddUnauthorized = async () =>
      versioning.methods.addVersion(
        (sigResps) => findSig(sigResps, nonOwnerPrivKey.publicKey),
        version,
        outpoint,
        description,
        {
          pubKeyOrAddrToSign: nonOwnerPrivKey.publicKey,
          lockTime: 0,
          next: {
            instance: nextInstance,
            balance: 1,
          },
        } as MethodCallOptions<ReactOnchainVersioning>
      );

    await expect(callAddUnauthorized()).to.be.rejectedWith(/signature check failed/);
  });

  it('should handle version history rolling window (1000+ versions)', async () => {
    await versioning.connect(getDefaultSigner(ownerPrivKey));
    await versioning.deploy(1);

    let currentInstance = versioning;

    // Add first version
    const version1 = toByteString('1.0.0', true);
    const outpoint1 = toByteString('first_0', true);
    const description1 = toByteString('First version', true);

    const nextInstance1 = currentInstance.next();
    nextInstance1.versionCount = 1n;
    nextInstance1.latestVersion = version1;
    nextInstance1.versionHistory[0] = version1;
    nextInstance1.versionMap.set(version1, {
      outpoint: outpoint1,
      description: description1,
      timestamp: 0n,
    });

    const { nexts: nexts1 } = await currentInstance.methods.addVersion(
      (sigResps) => findSig(sigResps, ownerPrivKey.publicKey),
      version1,
      outpoint1,
      description1,
      {
        pubKeyOrAddrToSign: ownerPrivKey.publicKey,
        lockTime: 0,
        next: {
          instance: nextInstance1,
          balance: 1,
        },
      } as MethodCallOptions<ReactOnchainVersioning>
    );

    currentInstance = nexts1[0].instance as ReactOnchainVersioning;

    // Add second version to test history ordering
    const version2 = toByteString('2.0.0', true);
    const outpoint2 = toByteString('second_0', true);
    const description2 = toByteString('Second version', true);

    const nextInstance2 = currentInstance.next();
    nextInstance2.versionCount = 2n;
    nextInstance2.latestVersion = version2;
    nextInstance2.versionHistory[1] = version1; // Shifted from index 0
    nextInstance2.versionHistory[0] = version2; // New at index 0
    nextInstance2.versionMap.set(version2, {
      outpoint: outpoint2,
      description: description2,
      timestamp: 1n,
    });

    const { nexts: nexts2 } = await currentInstance.methods.addVersion(
      (sigResps) => findSig(sigResps, ownerPrivKey.publicKey),
      version2,
      outpoint2,
      description2,
      {
        pubKeyOrAddrToSign: ownerPrivKey.publicKey,
        lockTime: 1,
        next: {
          instance: nextInstance2,
          balance: 1,
        },
      } as MethodCallOptions<ReactOnchainVersioning>
    );

    currentInstance = nexts2[0].instance as ReactOnchainVersioning;

    // Verify history order (newest first)
    expect(currentInstance.versionHistory[0]).to.equal(version2);
    expect(currentInstance.versionHistory[1]).to.equal(version1);
    expect(currentInstance.latestVersion).to.equal(version2);
    expect(currentInstance.versionCount).to.equal(2n);
  });
});
