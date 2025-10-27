# react-onchain

**Deploy React applications entirely on the BSV blockchain.**

## Overview

Your react application on-chain foreve! No servers, no hosting fees, no downtime. Welcome to the decentralized web.

`react-onchain` makes this a reality. It's a CLI tool that inscribes your entire React application on-chain using the BSV blockchain and [1Sat Ordinals](https://docs.1satordinals.com/readme/introduction). Every file—HTML, CSS, JavaScript, images—becomes an immutable ordinal inscription.

**The best part?** Most apps deploy for less than a penny. Your React app becomes censorship-resistant, permanently accessible, and truly decentralized—all for the cost of a fraction of a cent.

<a href="https://ordfs.network/content/126e3a0245ebc1a3d490d4238b912c2d79184415375fa2d90bd45fc74d2c559d_0" target="_blank">
  <img src="https://img.shields.io/badge/🌐_View_App-0066ff?style=for-the-badge&labelColor=000000" alt="View App">
</a>

## Features

- **Complete On-Chain Deployment**: Entire React app lives on the blockchain
- **Automatic Dependency Resolution**: Analyzes your build and inscribes files in the correct order
- **Reference Rewriting**: Automatically updates all file references to use [ordfs.network](https://ordfs.network) URLs
- **Framework Agnostic**: Works with Vite, Create React App, Next.js (static export), or any React build tool
- **UTXO Chaining**: Efficiently chains UTXOs to avoid double-spend errors
- **File Size Tracking**: Displays detailed summary of inscribed files and total size
- **Dry Run Mode**: Test deployments without spending satoshis
- **Deployment Manifest**: Generates a detailed JSON manifest of all inscribed files

## Installation

**For users:**

No installation needed! Just use `npx`:

```bash
npx react-onchain deploy --build-dir ./dist --payment-key <WIF> --destination <ORD_ADDRESS>
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

```bash
npx react-onchain deploy \
  --build-dir ./dist \
  --payment-key <YOUR_WIF_PRIVATE_KEY> \
  --destination <YOUR_ORDINAL_ADDRESS>
```

### 3. Visit your app

The CLI will output the entry point URL:

```
https://ordfs.network/<txid>_<vout>
```

## CLI Usage

### Commands

```bash
# Deploy application
react-onchain deploy [options]

# Query version history
react-onchain version:history <contract>

# Get version details
react-onchain version:info <contract> <version>

# Get contract info
react-onchain contract:info <contract>
```

**Note:** For local development/testing, you can run commands directly with node:

```bash
node dist/cli.js deploy [options]
node dist/cli.js version:history <contract>
node dist/cli.js version:info <contract> <version>
node dist/cli.js contract:info <contract>
```

### Deploy Options

| Option                             | Alias | Description                                  | Default  |
| ---------------------------------- | ----- | -------------------------------------------- | -------- |
| `--build-dir <directory>`          | `-b`  | Build directory to deploy                    | `./dist` |
| `--payment-key <wif>`              | `-p`  | Payment private key in WIF format            | Required |
| `--destination <ordAddress>`       | `-d`  | Destination ord address for inscriptions     | Required |
| `--sats-per-kb <number>`           | `-s`  | Satoshis per KB for fees                     | `1`      |
| `--dry-run`                        |       | Test deployment without broadcasting         | `false`  |
| `--version-tag <string>`           |       | Version identifier (e.g., "1.0.0")           | Optional |
| `--version-description <string>`   |       | Changelog or release notes                   | Optional |
| `--versioning-contract <outpoint>` |       | Existing versioning contract                 | Optional |
| `--app-name <string>`              |       | Application name for new versioning contract | Optional |

### Examples

**Basic deployment:**

```bash
npx react-onchain deploy \
  --build-dir ./dist \
  --payment-key L1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v3w4x5y6z \
  --destination 1YourBSVAddressHere
```

**Dry run (test without spending):**

```bash
npx react-onchain deploy \
  --build-dir ./dist \
  --payment-key L1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v3w4x5y6z \
  --destination 1YourOrdAddressHere \
  --dry-run
```

**Custom fee rate:**

```bash
npx react-onchain deploy \
  --build-dir ./dist \
  --payment-key <YOUR_WIF> \
  --destination <YOUR_ORDINAL_ADDRESS> \
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
Entry point: https://ordfs.network/abc123def456_0

Manifest saved to: deployment-manifest.json
```

## Custom Domains

Your app gets an `ordfs.network` URL by default. To use a custom domain, point your DNS to the deployment URL.

**Setup:**

1. Deploy your app, note the entry point URL
2. Add a CNAME record: `app.yourdomain.com` → `ordfs.network`
3. Add a path redirect/rewrite to append the txid_vout

**Updating:**
When you redeploy, you get a new URL. Update your DNS or redirect rules to point to the latest version.

**Examples:**

- Cloudflare: Use Page Rules or Workers to redirect
- Vercel/Netlify: Use `_redirects` or `vercel.json`
- Traditional hosting: Standard DNS + web server redirect

Each deployment is permanent and accessible at its unique URL—you control which version users see via DNS.

## On-Chain Versioning

Deploy your React app with on-chain version tracking. Users can access specific versions via URL parameters, enabling safe rollbacks and version pinning.

### Features

- **Unlimited Versions**: All versions stored permanently on-chain via smart contract
- **Version History**: Last 10 versions easily queryable
- **Version Metadata**: Store changelog/release notes with each version
- **URL-Based Access**: Simple `?version=X` parameter to access any version
- **Custom Domains**: Works seamlessly with permanent 301 redirects

### How It Works

1. **First Deployment**: Creates a versioning smart contract on-chain
2. **Version Script**: Injects a redirect script into your `index.html`
3. **Version Resolution**: Script queries the contract and redirects to requested version
4. **Permanent Access**: All versions remain accessible forever

### First Deployment

Deploy your first version and create a versioning contract:

```bash
npx react-onchain deploy \
  --build-dir ./dist \
  --payment-key <WIF> \
  --destination <ORD_ADDRESS> \
  --version-tag "1.0.0" \
  --version-description "Initial release" \
  --app-name "MyDApp"
```

**Important**: Save the `versioningContract` value from the deployment manifest—you'll need it for future deployments.

### Subsequent Deployments

Deploy new versions using the existing versioning contract:

```bash
npx react-onchain deploy \
  --build-dir ./dist \
  --payment-key <WIF> \
  --destination <ORD_ADDRESS> \
  --version-tag "1.1.0" \
  --version-description "Added dark mode and bug fixes" \
  --versioning-contract <CONTRACT_OUTPOINT>
```

The `<CONTRACT_OUTPOINT>` is the `versioningContract` value from your first deployment's manifest.

### Accessing Versions

Once deployed with versioning enabled:

- **Origin (latest)**: `https://yourdomain.com` or `https://ordfs.network/content/<ORIGIN>`
- **Latest version**: `https://yourdomain.com?version=latest`
- **Specific version**: `https://yourdomain.com?version=1.0.0`

### Custom Domain Setup with Versioning

1. Deploy your app with versioning enabled
2. Note the entry point URL from the deployment manifest
3. Set up a permanent redirect:

**Cloudflare Example**:

```
Type: 301 Permanent Redirect
From: yourdomain.com
To: https://ordfs.network/content/<ENTRY_POINT_OUTPOINT>
```

The entry point URL never changes. The injected version script handles routing to specific versions automatically.

### Version Manifest Example

With versioning enabled, your deployment manifest includes versioning information:

```json
{
  "timestamp": "2025-10-27T02:00:00.000Z",
  "entryPoint": "https://ordfs.network/abc123_0",
  "versioningContract": "xyz789_0",
  "version": "1.1.0",
  "files": [...],
  "totalFiles": 4,
  "totalCost": 45678,
  "totalSize": 162130,
  "transactions": [...]
}
```

### Versioning CLI Options

| Option                             | Description                                         | Required |
| ---------------------------------- | --------------------------------------------------- | -------- |
| `--version-tag <string>`           | Version identifier (e.g., "1.0.0", "v2.1.3-beta")   | No       |
| `--version-description <string>`   | Changelog or release notes for this version         | No       |
| `--versioning-contract <outpoint>` | Existing contract outpoint (for subsequent deploys) | No       |
| `--app-name <string>`              | Application name (for first deployment)             | No       |

### Best Practices

1. **Semantic Versioning**: Use meaningful version tags like `1.0.0`, `1.1.0`, `2.0.0`
2. **Descriptive Changelogs**: Include clear version descriptions for users
3. **Keep Contract Outpoint**: Always save the versioning contract outpoint from your first deployment
4. **Test Versions**: Deploy to testnet first to verify version switching works correctly
5. **Document Versions**: Maintain a changelog linking to on-chain versions

### Use Cases

- **Safe Updates**: Deploy new versions without breaking existing integrations
- **Version Pinning**: Let users lock to specific versions via URL parameters
- **Rollback Support**: Instantly roll back by updating DNS to point to previous version
- **Beta Testing**: Deploy beta versions alongside production
- **Compliance**: Maintain permanent audit trail of all deployed versions

### Querying Version Information

Once you have a versioning contract deployed, you can query version history and details:

**Show version history:**

```bash
npx react-onchain version:history <CONTRACT_OUTPOINT>
```

Displays all deployed versions (newest first, up to last 10) with latest version marked.

**Get specific version details:**

```bash
npx react-onchain version:info <CONTRACT_OUTPOINT> <VERSION>
```

Shows detailed information for a specific version:
- Version identifier
- Outpoint (txid_vout)
- Full URL to access that version
- Description/changelog
- Deployment timestamp

**Get contract information:**

```bash
npx react-onchain contract:info <CONTRACT_OUTPOINT>
```

Shows contract details:
- Contract outpoint
- Application name
- Origin outpoint
- Total versions deployed
- Latest version

**Example:**

```bash
# View all versions
npx react-onchain version:history d8912072...7badf745_0

# Output:
# 📚 Version History
#
# ──────────────────────────────────────────────────────────────────────
# Version              Status
# ──────────────────────────────────────────────────────────────────────
# 2.0.0                (latest)
# 1.1.0
# 1.0.0
# ──────────────────────────────────────────────────────────────────────

# Get details for specific version
npx react-onchain version:info d8912072...7badf745_0 1.1.0

# Get contract summary
npx react-onchain contract:info d8912072...7badf745_0
```

## Deployment Manifest

A JSON manifest is generated after deployment:

```json
{
  "timestamp": "2025-10-27T02:00:00.000Z",
  "entryPoint": "https://ordfs.network/abc123_0",
  "files": [
    {
      "originalPath": "index.html",
      "txid": "abc123...",
      "vout": 0,
      "url": "https://ordfs.network/abc123_0",
      "size": 2450
    }
  ],
  "totalFiles": 4,
  "totalCost": 45678,
  "totalSize": 162130,
  "transactions": ["abc123...", "def456...", "ghi789...", "jkl012..."]
}
```

## API Usage

You can use `react-onchain` programmatically:

```typescript
import { deployToChain } from "react-onchain";

const config = {
  buildDir: "./dist",
  paymentKey: "your-wif-key",
  destinationAddress: "your-ordinal-address",
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
│   ├── analyzer.ts       # Scans build directory, extracts dependencies
│   ├── rewriter.ts       # Rewrites HTML/CSS/JS references
│   ├── inscriber.ts      # Inscribes files using js-1sat-ord
│   ├── orchestrator.ts   # Coordinates deployment process
│   ├── cli.ts           # CLI interface
│   ├── types.ts         # TypeScript type definitions
│   └── index.ts         # Public API exports
├── test-app/            # Example application
├── dist/                # Compiled JavaScript
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

Contributions welcome! Please open an issue or PR on GitHub.

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
