# react-onchain

**Deploy React applications entirely on the BSV blockchain.**

## Overview

Your react application on-chain forever! No servers, no hosting fees, no downtime. Welcome to the decentralized web.

`react-onchain` makes this a reality. It's a CLI tool that inscribes your entire React application on-chain using the BSV blockchain and [1Sat Ordinals](https://docs.1satordinals.com/readme/introduction). Every file—HTML, CSS, JavaScript, images—becomes an immutable ordinal inscription.

**The best part?** Most apps deploy for less than a penny. Your React app becomes censorship-resistant, permanently accessible, and truly decentralized—all for the cost of a fraction of a cent.

<a href="https://reactonchain.com" target="_blank">
  <img src="https://img.shields.io/badge/🌐_View_App-0066ff?style=for-the-badge&labelColor=000000" alt="View App">
</a>

## Features

- **Complete On-Chain Deployment**: Entire React app lives on the blockchain
- **Automatic Dependency Resolution**: Analyzes your build and inscribes files in the correct order
- **Reference Rewriting**: Automatically updates all file references to use ordinals content URLs
- **Built-in Versioning**: Every deployment is versioned with unlimited history tracked on-chain
- **Decentralized & Extensible**: Open source architecture supports multiple indexer and content providers
- **Framework Agnostic**: Works with Vite, Create React App, Next.js (static export), or any React build tool
- **React Router Support**: One-line setup for client-side routing (see below)
- **UTXO Chaining**: Efficiently chains UTXOs to avoid double-spend errors
- **Dry Run Mode**: Test deployments without spending satoshis
- **Smart Caching**: Reuses unchanged files from previous deployments to minimize costs

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
npx react-onchain deploy
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

### 1. React Router Setup (if using React Router)

If your app uses React Router for client-side routing, add this **one line** to your Router component:

```tsx
import { BrowserRouter as Router } from 'react-router-dom';

function App() {
  return (
    <Router basename={(window as any).__REACT_ONCHAIN_BASE__ || '/'}>{/* Your routes */}</Router>
  );
}
```

**That's it!** This single line makes your React Router app work with on-chain deployments AND locally with zero configuration.

- When deployed: `window.__REACT_ONCHAIN_BASE__` = `/content/{txid}_{vout}` (for content providers like ordfs.network)
- Locally: Falls back to `'/'`
- On custom domains: Automatically uses `'/'`

**Why is this needed?** React Router needs to know the base path when your app is deployed to a subpath (like `/content/{txid}_{vout}`). This one-liner automatically detects and configures it.

### 2. Build your React app

```bash
# For Vite
npm run build

# For Create React App
npm run build

# For Next.js (static export)
npm run build && npm run export
```

### 3. Deploy to blockchain

> **⚠️ Use an Ordinals-Compatible Wallet**
>
> Use a wallet that supports 1Sat Ordinals (we recommend [yours.org](https://yours.org)) to ensure your inscription UTXOs aren't accidentally spent. Regular wallets may not recognize 1-satoshi ordinal outputs and could spend them as regular funds, destroying your inscriptions permanently.

Simply run the deploy command - the CLI will guide you through an interactive setup:

```bash
npx react-onchain deploy
```

The interactive prompts will ask you for:

- **Build directory**: Automatically detects common directories (dist, build, out, etc.)
- **Payment key**: Your WIF private key for signing transactions
- **Version information**: Optional version tag and description for versioning

The destination address is automatically derived from your payment key.

### 4. Visit your app

The CLI will output the entry point URL. For example, using ordfs.network as a content provider:

```
https://ordfs.network/content/<txid>_<vout>
```

After your first deployment, a `.env` file is automatically created with your configuration. This means subsequent deployments are even simpler - just run:

```bash
npx react-onchain deploy
```

The CLI will:

- Auto-detect your previous build directory
- Load your payment key from `.env`
- Load versioning configuration from `deployment-manifest.json`
- Prompt you for the new version tag and description (optional)

All configuration is automatically managed for you!

## CLI Usage

### Commands

```bash
# Deploy application (interactive prompts)
npx react-onchain deploy

# Query version history (on-chain)
npx react-onchain version:history [versioningOriginInscription]

# Get version details (on-chain)
npx react-onchain version:info <version> [versioningOriginInscription]

# Get inscription info (on-chain)
npx react-onchain version:summary [versioningOriginInscription]

# View deployment history (local)
npx react-onchain manifest:history
```

### Interactive Deployment

The recommended way to deploy is using the interactive CLI, which guides you through the setup:

```bash
npx react-onchain deploy
```

The CLI will:

1. **Detect your build directory** - Automatically finds common directories (dist, build, out, etc.)
2. **Load saved configuration** - Reuses payment key and settings from `.env`
3. **Prompt for missing values** - Only asks for information that isn't already configured
4. **Show deployment preview** - Displays configuration before deploying
5. **Request confirmation** - Asks you to confirm before spending satoshis

**First deployment example:**

```
? Select build directory: ./dist
? Enter payment private key (WIF): **********************
? Enable versioning? Yes
? Enter version tag (e.g., 1.0.0): 1.0.0
? Enter version description: Initial release
? Enter application name: MyDApp

📋 Deployment Configuration
──────────────────────────────────────
  Build directory: ./dist
  Fee rate:        1 sats/KB
  Version:         1.0.0
  Description:     Initial release
  App name:        MyDApp (new versioning inscription)

⚠️  This will inscribe files to the blockchain and spend satoshis.
? Proceed with deployment? Yes

🚀 Deploying to BSV Blockchain...
```

**Subsequent deployments:**

```bash
npx react-onchain deploy
```

The CLI auto-loads everything from `.env` and only prompts for the new version information!

### Advanced: CLI Flags

For automation or CI/CD pipelines, you can bypass interactive prompts using flags:

| Flag                                         | Alias | Description                                                  | Default  |
| -------------------------------------------- | ----- | ------------------------------------------------------------ | -------- |
| `--build-dir <directory>`                    | `-b`  | Build directory to deploy                                    | `./dist` |
| `--payment-key <wif>`                        | `-p`  | Payment private key in WIF format (destination auto-derived) | Prompted |
| `--sats-per-kb <number>`                     | `-s`  | Satoshis per KB for fees                                     | `1`      |
| `--dry-run`                                  |       | Test deployment without broadcasting                         | `false`  |
| `--version-tag <string>`                     |       | Version identifier (e.g., "1.0.0")                           | Prompted |
| `--version-description <string>`             |       | Changelog or release notes                                   | Prompted |
| `--versioning-origin-inscription <outpoint>` |       | Existing versioning inscription origin                       | Auto     |
| `--app-name <string>`                        |       | Application name for new versioning inscription              | Prompted |

**Automated deployment example:**

```bash
# First deployment with flags (no prompts)
npx react-onchain deploy \
  --build-dir ./dist \
  --payment-key L1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v3w4x5y6z \
  --version-tag "1.0.0" \
  --version-description "Initial release" \
  --app-name "MyDApp"

# Subsequent deployment (config auto-loaded from .env)
npx react-onchain deploy \
  --version-tag "1.1.0" \
  --version-description "Bug fixes"

# Dry run (test without spending)
npx react-onchain deploy --dry-run

# Custom fee rate
npx react-onchain deploy --sats-per-kb 100
```

**Note:** When flags are provided, interactive prompts are automatically skipped. This is perfect for CI/CD automation.

## Deployment Output

After successful deployment, you'll see detailed information about inscribed files:

```
⚡ Inscribing to BSV Blockchain
──────────────────────────────────────────────────────────────────────
✓ assets/react-CHdo91hT.svg           → 494c43a6...
✓ vite.svg                            → 712d1b3c...
✓ assets/index-B7tBotfE.js            → 896b0d05...
✓ assets/index-COcDBgFa.css           → 58b02b11...
✓ index.html                          → f16f3780...
✓ versioning-metadata                 → 7b1c2bc4...
──────────────────────────────────────────────────────────────────────

╔═══════════════════════════════════════════════════════════════════╗
║                     Deployment Complete!                          ║
╚═══════════════════════════════════════════════════════════════════╝

📄 New Inscriptions
──────────────────────────────────────────────────────────────────────
 1. index.html                          6.03 KB    f16f3780...
 2. versioning-metadata                 1.25 KB    7b1c2bc4...
──────────────────────────────────────────────────────────────────────
  SUBTOTAL                               7.28 KB    2 files
──────────────────────────────────────────────────────────────────────

📦 Cached Files (Reused)
──────────────────────────────────────────────────────────────────────
 1. assets/react-CHdo91hT.svg           4.03 KB    494c43a6...
 2. vite.svg                            1.46 KB    712d1b3c...
 3. assets/index-B7tBotfE.js            223.33 KB  896b0d05...
 4. assets/index-COcDBgFa.css           1.35 KB    58b02b11...
──────────────────────────────────────────────────────────────────────
  SUBTOTAL                               230.17 KB  4 files
──────────────────────────────────────────────────────────────────────

📊 Total
──────────────────────────────────────────────────────────────────────
  TOTAL                                  237.45 KB  6 files
──────────────────────────────────────────────────────────────────────

📊 Deployment Stats
──────────────────────────────────────────────────────────────────────
  New files:        2 (7.28 KB)
  Cached files:     4
  Total files:      6 (237.45 KB)
  Inscription cost: ~8 satoshis
  Transactions:     2
──────────────────────────────────────────────────────────────────────

📦 Versioning
──────────────────────────────────────────────────────────────────────
  Origin Inscription: f852b8a7...
  Version:            1.0.1
  Version redirect:   ✓ Enabled
──────────────────────────────────────────────────────────────────────

✨ Entry Point (example using ordfs.network)
https://ordfs.network/content/f16f3780...

📁 Files Saved
  • deployment-manifest.json
  • .env (configuration for next deployment)
```

### Smart Caching

Notice the "Cached Files (Reused)" section? `react-onchain` intelligently reuses files from previous deployments when content hasn't changed. This dramatically reduces costs for subsequent deployments - you only pay to inscribe what actually changed!

In the example above:

- **New inscriptions**: 2 files (7.28 KB) - only index.html and versioning metadata changed
- **Cached files**: 4 files (230.17 KB) - assets remain unchanged and are reused
- **Cost savings**: ~97% reduction (inscribed 7.28 KB instead of 237.45 KB)

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

## Versioning

All deployments are automatically versioned with on-chain history tracking. Users can access specific versions via URL parameters, enabling safe rollbacks and version pinning.

### How It Works

1. **First Deployment**: Creates a versioning inscription origin with metadata containing version-to-outpoint mappings
2. **Subsequent Deployments**: Spends the previous inscription and adds new version metadata, creating an unlimited version history chain
3. **Version Redirect**: Automatically injected script queries inscription metadata to resolve version queries
4. **Always Latest**: Pointing to your origin html inscription will intelligently redirect to the latest deployed version of it.

### First Deployment

The interactive CLI guides you through deploying your first version:

```bash
npx react-onchain deploy
```

You'll be prompted for all necessary information:

```
? Select build directory: ./dist
? Payment key (WIF format): **********************
? App name (for versioning): MyDApp
? Version tag: 1.0.0
? Version description: Initial release
```

After deployment, a `.env` file is automatically created containing all your configuration (payment key, build directory, app name, and versioning inscription). The destination address is automatically derived from your payment key. This file is in `.gitignore` to protect your private keys.

**Or use flags for automation:**

```bash
npx react-onchain deploy \
  --build-dir ./dist \
  --payment-key <WIF> \
  --app-name "MyDApp" \
  --version-tag "1.0.0" \
  --version-description "Initial release"
```

### Subsequent Deployments

After your first deployment, subsequent versions are incredibly simple:

```bash
npx react-onchain deploy
```

The CLI will:

- Auto-load all configuration from `.env` and `deployment-manifest.json`
- Prompt you only for the new version information
- Automatically inject version redirect script

**Or with flags:**

```bash
npx react-onchain deploy \
  --version-tag "1.1.0" \
  --version-description "Added dark mode and bug fixes"
```

Version redirect script is automatically injected starting with the second deployment, enabling `?version=` URL parameters.

### Accessing Versions

- **Latest via inscription**: Access via content providers (e.g., `https://ordfs.network/content/<ORIGIN>`) - always serves latest location
- **Specific version**: `<ENTRY_POINT_URL>?version=1.0.0` - redirects to specific version

### Custom Domains

Point your domain to always serve the latest version via your chosen content provider:

```
# Example: DNS/CDN redirect to always get latest (using ordfs.network)
https://ordfs.network/content/<ORIGIN>
```

Or point to the entry point and let users control versions via `?version=` parameter.

### Querying Version Information

```bash
# View all versions (inscription auto-read from manifest if not provided)
npx react-onchain version:history [INSCRIPTION_ORIGIN]

# Get specific version details (inscription auto-read from manifest if not provided)
npx react-onchain version:info <VERSION> [INSCRIPTION_ORIGIN]

# Get inscription information (inscription auto-read from manifest if not provided)
npx react-onchain version:summary [INSCRIPTION_ORIGIN]
```

**Advanced: Versioning CLI flags** (for automation/CI-CD):

| Flag                                         | Description                                      |
| -------------------------------------------- | ------------------------------------------------ |
| `--version-tag <string>`                     | Version identifier (e.g., "1.0.0")               |
| `--version-description <string>`             | Changelog or release notes                       |
| `--versioning-origin-inscription <outpoint>` | Existing inscription origin (subsequent deploys) |
| `--app-name <string>`                        | Application name (for first deployment)          |

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
  paymentKey: 'your-wif-key', // Destination address is auto-derived from this key
  version: '1.0.0',
  versionDescription: 'Initial release',
  appName: 'MyApp',
  satsPerKb: 50,
  dryRun: false,
};

const result = await deployToChain(config);

console.log(`Entry point: ${result.entryPointUrl}`);
console.log(`Total files: ${result.inscriptions.length}`);
console.log(`Total size: ${result.totalSize} bytes`);
console.log(`Total cost: ${result.totalCost} satoshis`);
console.log(`Versioning origin: ${result.versioningOriginInscription}`);
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
│   │   │   └── constants.ts
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
│   ├── basePathFix.template.js           # React Router base path configuration
│   └── index.ts                          # Public API exports
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

### Files not loading

- Wait a few minutes for content provider indexing
- Verify transactions are confirmed on-chain
- Check console for CORS or network errors
- Try an alternative content provider if available

## Limitations

- Build must contain `index.html` at the root
- External CDN references are not rewritten
- Dynamic imports must use relative paths
- Content providers may have indexing delays

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
- [@inquirer/prompts](https://github.com/SBoudrias/Inquirer.js) - Interactive CLI prompts
- [chalk](https://github.com/chalk/chalk) - Terminal styling
- [ora](https://github.com/sindresorhus/ora) - Terminal spinners
- [axios](https://github.com/axios/axios) - HTTP client
- [dotenv](https://github.com/motdotla/dotenv) - Environment configuration

## Links

- [Documentation](https://github.com/danwag06/react-onchain)
- [Issues](https://github.com/danwag06/react-onchain/issues)
- [BSV Blockchain](https://bitcoinsv.com)
- [1Sat Ordinals](https://docs.1satordinals.com)
