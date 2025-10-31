# react-onchain

**Deploy React applications entirely on the BSV blockchain.**

## Overview

Your react application on-chain forever! No servers, no hosting fees, no downtime. Welcome to the decentralized web.

`react-onchain` makes this a reality. It's a CLI tool that inscribes your entire React application on-chain using the BSV blockchain and [1Sat Ordinals](https://docs.1satordinals.com/readme/introduction). Every file—HTML, CSS, JavaScript, images—becomes an immutable ordinal inscription.

**The best part?** Most apps deploy for less than a penny. Your React app becomes censorship-resistant, permanently accessible, and truly decentralized—all for the cost of a fraction of a cent.

<a href="https://ordfs.network/content/126e3a0245ebc1a3d490d4238b912c2d79184415375fa2d90bd45fc74d2c559d_0" target="_blank">
  <img src="https://img.shields.io/badge/🌐_View_App-0066ff?style=for-the-badge&labelColor=000000" alt="View App">
</a>

## Features

- **Complete On-Chain Deployment**: Entire React app lives on the blockchain
- **Automatic Dependency Resolution**: Analyzes your build and inscribes files in the correct order
- **Reference Rewriting**: Automatically updates all file references to use ordinals content URLs
- **Ordinal Inscription Versioning**: Unlimited version history tracked via lightweight inscription metadata
- **Decentralized & Extensible**: Open source architecture supports multiple indexer and content providers
- **Framework Agnostic**: Works with Vite, Create React App, Next.js (static export), or any React build tool
- **UTXO Chaining**: Efficiently chains UTXOs to avoid double-spend errors
- **Dry Run Mode**: Test deployments without spending satoshis
- **Deployment Manifest**: Generates a detailed JSON manifest of all inscribed files

## Decentralized Architecture

`react-onchain` is fully open source and decentralized. Anyone can add support for additional indexers and content providers by implementing the service interfaces in `src/services/`.

- **Pluggable Indexers**: Add new blockchain indexing services
- **Multiple Content Providers**: Support for multiple ordinals content delivery networks
- **Service Failover**: Automatic failover between available providers
- **Community Driven**: Contribute new providers via pull requests

See `src/services/IndexerService.ts` for the base interface and `src/services/gorilla-pool/` for a reference implementation.

## Installation

**For users:**

No installation needed! Just use `npx`:

```bash
npx react-onchain deploy --build-dir ./dist --payment-key <WIF>
```

**For developers/contributors:**

Clone and build from source:

```bash
git clone https://github.com/danwag06/react-onchain.git
cd react-onchain
npm install
npm run build
```

Or install globally for development:

```bash
npm install -g .
```

## Quick Start

### 1. Build your React app

```bash
# For Vite
npm run build

# For Create React App
npm run build

# For Next.js (static export)
npm run build && npm run export
```

### 2. Deploy to blockchain

**⚠️ Important:** Use a wallet that supports 1Sat Ordinals (we recommend [yours.org](https://yours.org)) to ensure your inscription UTXOs aren't accidentally spent. Regular wallets may not recognize 1-satoshi ordinal outputs and could spend them as regular funds.

```bash
npx react-onchain deploy \
  --build-dir ./dist \
  --payment-key <YOUR_WIF_PRIVATE_KEY>
```

The destination address is automatically derived from your payment key.

### 3. Visit your app

The CLI will output the entry point URL:

```
https://ordfs.network/content/<txid>_<vout>
```

After your first deployment, a `.env` file is automatically created with your configuration. This means subsequent deployments only need the version information:

```bash
npx react-onchain deploy \
  --version-tag "1.1.0" \
  --version-description "Bug fixes and improvements"
```

All other configuration (payment key, build directory, versioning contract) is automatically loaded from `.env` and `deployment-manifest.json`. The destination address is automatically derived from your payment key.

## CLI Usage

```bash
# Deploy application
npx react-onchain deploy [options]

# Query version history (on-chain)
npx react-onchain version:history <inscription>

# Get version details (on-chain)
npx react-onchain version:info <inscription> <version>

# Get inscription info (on-chain)
npx react-onchain version:summary <inscription>

# View deployment history (local)
npx react-onchain manifest:history
```

### Deploy Options

| Option                             | Alias | Description                                                  | Default  |
| ---------------------------------- | ----- | ------------------------------------------------------------ | -------- |
| `--build-dir <directory>`          | `-b`  | Build directory to deploy                                    | `./dist` |
| `--payment-key <wif>`              | `-p`  | Payment private key in WIF format (destination auto-derived) | Required |
| `--sats-per-kb <number>`           | `-s`  | Satoshis per KB for fees                                     | `1`      |
| `--dry-run`                        |       | Test deployment without broadcasting                         | `false`  |
| `--version-tag <string>`           |       | Version identifier (e.g., "1.0.0")                           | Optional |
| `--version-description <string>`   |       | Changelog or release notes                                   | Optional |
| `--versioning-contract <outpoint>` |       | Existing versioning inscription origin                       | Optional |
| `--app-name <string>`              |       | Application name for new versioning inscription              | Optional |

**Note:** After your first deployment, a `.env` file is auto-created with your configuration. Most options can then be omitted from the CLI and will be loaded automatically from `.env` and `deployment-manifest.json`.

### Examples

**Basic deployment:**

```bash
npx react-onchain deploy \
  --build-dir ./dist \
  --payment-key L1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v3w4x5y6z
```

**Dry run (test without spending):**

```bash
npx react-onchain deploy \
  --build-dir ./dist \
  --payment-key L1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v3w4x5y6z \
  --dry-run
```

**Custom fee rate:**

```bash
npx react-onchain deploy \
  --build-dir ./dist \
  --payment-key <YOUR_WIF> \
  --sats-per-kb 100
```

## Deployment Output

After successful deployment, you'll see:

```
📊 Deployment Summary:

──────────────────────────────────────────────────────────────────────
File                                    Size           TXID
──────────────────────────────────────────────────────────────────────
index.html                              2.45 KB        abc123def456...
assets/index-abc123.js                  145.23 KB      def456ghi789...
assets/index-def456.css                 12.34 KB       ghi789jkl012...
assets/logo.svg                         2.11 KB        jkl012mno345...
──────────────────────────────────────────────────────────────────────
TOTAL                                   162.13 KB      4 files
──────────────────────────────────────────────────────────────────────

✨ Deployment complete!
Entry point: https://ordfs.network/content/abc123def456_0

Manifest saved to: deployment-manifest.json
Configuration saved to: .env
```

## Custom Domains

Point your domain to your deployment using DNS redirects or URL rewrites. Each deployment is permanent and accessible at its unique URL—you control which version users see via DNS.

### Important: Version Redirect Behavior

**Key Point:** Accessing `/content/<origin>` directly does NOT automatically redirect to the latest version. The version redirect script only activates when `?version=` is present in the URL.

**URL Behavior:**

- `/content/<origin>` → Loads that specific deployment (no redirect)
- `/content/<origin>?version=latest` → Redirects to latest version
- `/content/<origin>?version=1.2.0` → Redirects to version 1.2.0

**For Always-Latest Deployments:**

If you want your domain to always serve the latest version, point your DNS to include the `?version=latest` parameter:

```
# Cloudflare redirect example
From: yourdomain.com
To: https://ordfs.network/content/<ORIGIN>?version=latest
```

This ensures users always get redirected to the most recent deployment while maintaining the ability to access specific versions when needed.

## On-Chain Versioning

Deploy your React app with on-chain version tracking using lightweight inscription metadata. Users can access specific versions via URL parameters, enabling safe rollbacks and version pinning.

### How It Works

1. **First Deployment**: Creates a versioning inscription with metadata containing version-to-outpoint mappings
2. **Subsequent Deployments**: Spends the previous inscription and merges metadata, creating an unlimited version history chain
3. **Version Redirect**: Injected script queries inscription metadata via `ordfs.network` to resolve version queries
4. **Built-in Latest**: Use `?seq=-1` to always access the latest version via ordfs.network's origin chain resolution

### First Deployment

Deploy your first version and create a versioning inscription:

```bash
npx react-onchain deploy \
  --build-dir ./dist \
  --payment-key <WIF> \
  --version-tag "1.0.0" \
  --version-description "Initial release" \
  --app-name "MyDApp"
```

After deployment, a `.env` file is automatically created containing all your configuration (payment key, build directory, and versioning contract). The destination address is automatically derived from your payment key. This file is in `.gitignore` to protect your private keys.

### Subsequent Deployments

After your first deployment, you only need to specify the new version information:

```bash
npx react-onchain deploy \
  --version-tag "1.1.0" \
  --version-description "Added dark mode and bug fixes"
```

All other configuration is automatically loaded from `.env` and `deployment-manifest.json`.

Version redirect script is automatically injected starting with the second deployment, enabling `?version=` URL parameters.

### Accessing Versions

- **Direct**: `<ENTRY_POINT_URL>` - loads current deployment
- **Latest via inscription**: `https://ordfs.network/content/<ORIGIN>?seq=-1` - always serves latest
- **Latest via redirect**: `<ENTRY_POINT_URL>?version=latest` - redirects to latest
- **Specific version**: `<ENTRY_POINT_URL>?version=1.0.0` - redirects to specific version

**Note:** Unlike the previous smart contract approach, inscription-based versioning has **unlimited** version history. All version metadata is stored in the inscription chain and automatically merges when spending.

### Custom Domains

Point your domain to always serve the latest version:

```
# DNS/CDN redirect to always get latest
https://ordfs.network/content/<ORIGIN>?seq=-1
```

Or point to the entry point and let users control versions via `?version=` parameter.

### Versioning CLI Options

| Option                             | Description                                      |
| ---------------------------------- | ------------------------------------------------ |
| `--version-tag <string>`           | Version identifier (e.g., "1.0.0")               |
| `--version-description <string>`   | Changelog or release notes                       |
| `--versioning-contract <outpoint>` | Existing inscription origin (subsequent deploys) |
| `--app-name <string>`              | Application name (for first deployment)          |

### Querying Version Information

```bash
# View all versions
npx react-onchain version:history <INSCRIPTION_ORIGIN>

# Get specific version details
npx react-onchain version:info <INSCRIPTION_ORIGIN> <VERSION>

# Get inscription information
npx react-onchain version:summary <INSCRIPTION_ORIGIN>
```

## Deployment Manifest

A JSON manifest is generated after deployment:

```json
{
  "timestamp": "2025-10-27T02:00:00.000Z",
  "entryPoint": "/content/abc123_0",
  "files": [
    {
      "originalPath": "index.html",
      "txid": "abc123...",
      "vout": 0,
      "urlPath": "/content/abc123_0",
      "size": 2450
    }
  ],
  "totalFiles": 4,
  "totalCost": 45678,
  "totalSize": 162130,
  "transactions": ["abc123...", "def456...", "ghi789...", "jkl012..."]
}
```

### Deployment History Tracking

The manifest file automatically maintains a complete history of all your deployments. Each new deployment is appended to the history, creating a permanent local record.

**View your deployment history:**

```bash
npx react-onchain manifest:history
```

The history includes:

- Deployment number and version
- Timestamp for each deployment
- File counts and sizes
- Total costs across all deployments
- Shared versioning inscription origin (if enabled)

**Benefits:**

- Complete audit trail of all deployments
- Track costs and sizes over time
- Easy reference to previous deployment details
- Automatic migration from old single-deployment format

**Note:** The manifest stores complete deployment history locally. This complements the on-chain inscription metadata which has unlimited version history. All deployments remain permanently on-chain.

## API Usage

You can use `react-onchain` programmatically:

```typescript
import { deployToChain } from 'react-onchain';

const config = {
  buildDir: './dist',
  paymentKey: 'your-wif-key',
  destinationAddress: 'your-ordinal-address',
  satsPerKb: 50,
  dryRun: false,
};

const result = await deployToChain(config);

console.log(`Entry point: ${result.entryPointUrl}`);
console.log(`Total files: ${result.inscriptions.length}`);
console.log(`Total size: ${result.totalSize} bytes`);
console.log(`Total cost: ${result.totalCost} satoshis`);
```

## Supported File Types

- **HTML**: `.html`, `.htm`
- **CSS**: `.css`
- **JavaScript**: `.js`, `.mjs`
- **JSON**: `.json`
- **Images**: `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`, `.ico`
- **Fonts**: `.woff`, `.woff2`, `.ttf`, `.eot`, `.otf`
- **Other**: `.txt`, `.xml`

## Cost Estimation

Inscription costs depend on:

- Number of files
- Total size of all files
- Fee rate (sats/KB)

Typical costs at 1 sat/KB:

| App Type    | Size   | Files  | Cost (sats) | Cost (USD)\* |
| ----------- | ------ | ------ | ----------- | ------------ |
| Simple SPA  | 200 KB | 5-10   | ~200        | ~$0.00008    |
| Medium App  | 500 KB | 20-30  | ~500        | ~$0.0002     |
| Large App   | 1 MB   | 50-100 | ~1,000      | ~$0.0004     |
| Complex App | 2 MB   | 100+   | ~2,000      | ~$0.0008     |

\*Based on $40 BSV price

## Optimization Tips

1. **Enable minification**: Ensure your build tool minifies code
2. **Optimize images**: Use WebP format, optimize SVGs
3. **Remove source maps**: Exclude `.map` files from deployment
4. **Tree shaking**: Remove unused code
5. **Code splitting**: Split large bundles into smaller chunks
6. **Compress assets**: Most bundlers gzip automatically

## Architecture

```
react-onchain/
├── src/
│   ├── services/
│   │   ├── gorilla-pool/                 # GorillaPool indexer implementation
│   │   │   ├── indexer.ts
│   │   │   ├── types.ts
│   │   │   ├── constants.ts
│   │   │   └── browserConfig.ts
│   │   ├── IndexerService.ts             # Indexer abstraction interface
│   │   └── index.ts                      # Service exports
│   ├── analyzer.ts                       # Build analysis & dependency graph
│   ├── cli.ts                            # Command-line interface
│   ├── config.ts                         # Configuration management
│   ├── inscriber.ts                      # Blockchain inscription handler
│   ├── orchestrator.ts                   # Deployment orchestration
│   ├── rewriter.ts                       # Reference rewriting (HTML/CSS/JS)
│   ├── retryUtils.ts                     # Retry logic with backoff
│   ├── types.ts                          # TypeScript type definitions
│   ├── versioningInscriptionHandler.ts   # Inscription-based versioning
│   ├── versionRedirect.template.js       # Client-side version redirect script
│   └── index.ts                          # Public API exports
├── tests/                                # Test suite
├── dist/                                 # Compiled JavaScript
└── package.json
```

## Requirements

- Node.js 18+
- BSV wallet with sufficient funds
- Built React application (from `npm run build`)

## Troubleshooting

### No UTXOs found

Ensure your payment address has sufficient BSV for inscriptions.

### index.html not found

Point to the correct build directory (usually `./dist` or `./build`).

### Broadcast failed

- Verify your WIF private key is valid
- Ensure payment address has funds
- Check network connectivity

### Files not loading on ordfs.network

- Wait a few minutes for indexing
- Verify transactions are confirmed on-chain
- Check console for CORS or network errors

## Limitations

- Build must contain `index.html` at the root
- External CDN references are not rewritten
- Dynamic imports must use relative paths
- ordfs.network may have indexing delays

## Contributing

Contributions are welcome! Please follow these guidelines:

### Code Formatting

This project uses [Prettier](https://prettier.io/) for consistent code formatting.

**Format code before committing:**

```bash
npm run format
```

**Check if code is formatted correctly:**

```bash
npm run format:check
```

**VS Code Setup:**

If you're using VS Code, formatting on save is already configured in `.vscode/settings.json`.

### Development Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Make your changes
4. Format your code: `npm run format`
5. Build and test: `npm run build`
6. Commit your changes with a descriptive message
7. Push to your fork and submit a pull request

### Code Style

- Use TypeScript for all new code
- Follow existing patterns and conventions
- Add JSDoc comments for public APIs
- Keep functions focused and single-purpose
- Use meaningful variable names

### Pull Request Guidelines

- Provide a clear description of the changes
- Reference any related issues
- Ensure code is formatted with Prettier
- Verify the project builds successfully
- Update documentation if needed

For questions or discussions, please open an issue on GitHub.

## License

ISC

## Built With

- [js-1sat-ord](https://github.com/BitcoinSchema/js-1sat-ord) - 1Sat Ordinals library
- [@bsv/sdk](https://github.com/bitcoin-sv/ts-sdk) - BSV TypeScript SDK
- [commander](https://github.com/tj/commander.js) - CLI framework
- [chalk](https://github.com/chalk/chalk) - Terminal styling
- [ora](https://github.com/sindresorhus/ora) - Terminal spinners

## Links

- [Documentation](https://github.com/danwag06/react-onchain)
- [Issues](https://github.com/danwag06/react-onchain/issues)
- [BSV Blockchain](https://bitcoinsv.com)
- [1Sat Ordinals](https://docs.1satordinals.com)
