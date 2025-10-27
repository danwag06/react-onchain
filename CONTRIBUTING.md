# Contributing to React OnChain

Thank you for your interest in contributing to React OnChain! This document provides guidelines and instructions for contributing.

## Code of Conduct

Please be respectful and constructive in all interactions. We're building something cool together!

## Getting Started

### Prerequisites

- Node.js 18+ (required for native fetch support)
- npm or yarn
- Git

### Setup

1. Fork the repository on GitHub
2. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/react-onchain.git
   cd react-onchain
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Build the project:
   ```bash
   npm run build
   ```

## Development Workflow

### Making Changes

1. Create a new branch for your feature or fix:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. Make your changes in the `src/` directory
3. Format your code (required before committing):
   ```bash
   npm run format
   ```
4. Build and verify your changes compile:
   ```bash
   npm run build
   ```
5. Test your changes locally:
   ```bash
   # Test with dry-run mode
   node dist/cli.js deploy --build-dir ./test-app/dist --dry-run
   ```

### Code Formatting

This project uses **Prettier** for consistent code formatting across all contributors.

#### Before Committing

Always format your code before committing:

```bash
npm run format
```

#### Check Formatting

To verify code is properly formatted without changing files:

```bash
npm run format:check
```

#### Editor Integration

**VS Code** users: Format-on-save is automatically configured in `.vscode/settings.json`. Just save your files and Prettier will format them.

**Other Editors**: Install the Prettier plugin for your editor and enable format-on-save.

### Code Style Guidelines

- **TypeScript**: Use TypeScript for all new code
- **Naming**: Use descriptive, meaningful names for variables and functions
- **Functions**: Keep functions focused and single-purpose
- **Comments**: Add JSDoc comments for public APIs and complex logic
- **Imports**: Use ES6 imports with `.js` extensions for local files
- **Error Handling**: Use try-catch blocks and provide meaningful error messages
- **Async/Await**: Prefer async/await over promise chains

### Project Structure

```
react-onchain/
├── src/
│   ├── cli.ts                  # CLI entry point
│   ├── orchestrator.ts         # Main deployment orchestration
│   ├── inscriber.ts           # File inscription logic
│   ├── analyzer.ts            # Build directory analysis
│   ├── rewriter.ts            # URL rewriting for inscribed files
│   ├── retryUtils.ts          # Retry logic with exponential backoff
│   ├── config.ts              # Configuration and environment variables
│   ├── types.ts               # TypeScript type definitions
│   ├── versioningContractHandler.ts  # Smart contract interaction
│   └── contracts/             # sCrypt smart contracts
├── tests/                     # Test files
├── artifacts/                 # Compiled contract artifacts
└── dist/                      # Compiled JavaScript output
```

## Submitting Changes

### Pull Request Process

1. Ensure your code is formatted:
   ```bash
   npm run format
   ```
2. Verify the project builds successfully:
   ```bash
   npm run build
   ```
3. Commit your changes with a clear, descriptive message:
   ```bash
   git commit -m "feat: add exponential retry for UTXO errors"
   ```
4. Push to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```
5. Open a Pull Request on GitHub

### Commit Message Format

Use clear, descriptive commit messages:

- `feat: add new feature`
- `fix: resolve bug in inscriber`
- `docs: update README`
- `refactor: simplify retry logic`
- `test: add tests for analyzer`
- `chore: update dependencies`

### Pull Request Description

Include in your PR description:

- **What** changes you made
- **Why** you made them
- **How** to test the changes
- Any related issues (e.g., "Fixes #123")

## Testing

Currently, the project uses manual testing with dry-run mode:

```bash
node dist/cli.js deploy --build-dir ./test-app/dist --dry-run
```

If you're adding a major feature, consider adding test cases in the `tests/` directory.

## Questions or Issues?

- **Bug Reports**: Open an issue with detailed reproduction steps
- **Feature Requests**: Open an issue describing the feature and use case
- **Questions**: Open a discussion on GitHub

## License

By contributing, you agree that your contributions will be licensed under the ISC License.

---

Thank you for contributing to React OnChain! 🚀
