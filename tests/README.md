# Reference Tests

This directory contains reference examples of the versioning smart contract and its tests.

## Contract

- **reactOnchainVersioning.ts** - The on-chain versioning contract source code
- Located at: `src/contracts/reactOnchainVersioning.ts`

## Running Tests

These tests are meant to be run in a scrypt-ts development environment with the full testing infrastructure.

To run tests, copy the contract and test files to a scrypt-ts boilerplate project:

```bash
# From a scrypt-ts boilerplate directory
npm test
```

Or run specific tests:

```bash
NETWORK="testnet" npx mocha --no-config --require ts-node/register tests/reactOnchainVersioning.test.ts --timeout 60000
```

## Purpose

These files are included as reference examples to help users understand:

1. How the versioning contract works
2. How to test stateful smart contracts
3. The updateOrigin pattern for one-time initialization
4. Version management with HashedMap and rolling history

For actual development and testing, use a proper scrypt-ts development environment.
