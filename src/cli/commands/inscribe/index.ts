/**
 * Inscribe Command
 * Inscribe individual files to the blockchain
 */

import { readFile } from 'fs/promises';
import { resolve, basename, extname } from 'path';
import { existsSync, statSync } from 'fs';
import chalk from 'chalk';
import type { Command } from 'commander';
import { PrivateKey } from '@bsv/sdk';
import { parallelInscribe } from '../../../core/inscription/index.js';
import type { InscriptionJob } from '../../../core/inscription/index.js';
import { config as envConfig, createIndexer } from '../../../lib/config.js';
import { formatError } from '../../../utils/errors.js';
import { CONTENT_TYPE_MAP } from '../../../core/analysis/analyzer.js';

interface InscribeOptions {
  paymentKey?: string;
  protocol: '1sat' | 'bfile';
  destination?: string;
  satsPerKb: string;
  contentType?: string;
}

/**
 * Register the inscribe command with the CLI program
 */
export function registerInscribeCommand(program: Command): void {
  program
    .command('inscribe <file>')
    .description('Inscribe a single file to the blockchain')
    .option('-p, --payment-key <wif>', 'Payment private key (WIF format)', envConfig.paymentKey)
    .option(
      '--protocol <type>',
      'Inscription protocol: 1sat (1Sat Ordinals) or bfile (B:// protocol)',
      '1sat'
    )
    .option('-d, --destination <address>', 'Destination address (defaults to payment key address)')
    .option('-s, --sats-per-kb <number>', 'Satoshis per KB for fees', String(envConfig.satsPerKb))
    .option('-t, --content-type <type>', 'Content type (auto-detected if not specified)')
    .action(async (filePath: string, options: InscribeOptions) => {
      try {
        // Validate file exists
        const absolutePath = resolve(filePath);
        if (!existsSync(absolutePath)) {
          console.error(chalk.red(`\n❌ File not found: ${filePath}\n`));
          process.exit(1);
        }

        const stats = statSync(absolutePath);
        if (!stats.isFile()) {
          console.error(chalk.red(`\n❌ Path is not a file: ${filePath}\n`));
          process.exit(1);
        }

        // Validate payment key
        if (!options.paymentKey) {
          console.error(chalk.red('\n❌ Payment key required'));
          console.error(chalk.yellow('Provide via --payment-key flag or PAYMENT_KEY in .env\n'));
          process.exit(1);
        }

        // Validate protocol
        if (options.protocol !== '1sat' && options.protocol !== 'bfile') {
          console.error(chalk.red(`\n❌ Invalid protocol: ${options.protocol}`));
          console.error(chalk.yellow('Must be either "1sat" or "bfile"\n'));
          process.exit(1);
        }

        // Setup keys and addresses
        const paymentKey = PrivateKey.fromWif(options.paymentKey);
        const destinationAddress = options.destination || paymentKey.toAddress().toString();

        // Read file content
        const content = await readFile(absolutePath);
        const fileName = basename(absolutePath);
        const ext = extname(fileName);

        // Determine content type
        const contentType =
          options.contentType || CONTENT_TYPE_MAP[ext] || 'application/octet-stream';

        // Display inscription details
        console.log(chalk.cyan('\n📄 File Inscription Details\n'));
        console.log(chalk.white('File:'), chalk.green(fileName));
        console.log(chalk.white('Path:'), chalk.dim(absolutePath));
        console.log(chalk.white('Size:'), chalk.green(`${(content.length / 1024).toFixed(2)} KB`));
        console.log(chalk.white('Content Type:'), chalk.green(contentType));
        console.log(chalk.white('Protocol:'), chalk.green(options.protocol.toUpperCase()));
        console.log(chalk.white('Destination:'), chalk.green(destinationAddress));
        console.log(chalk.white('Fee Rate:'), chalk.green(`${options.satsPerKb} sats/KB`));
        console.log('');

        // Create inscription job
        const job: InscriptionJob = {
          id: fileName,
          type: options.protocol === '1sat' ? 'ordinal' : 'bfile',
          filePath: absolutePath,
          originalPath: fileName,
          content,
          contentType,
          destinationAddress,
        };

        // Create indexer
        const indexer = createIndexer();

        // Inscribe the file
        console.log(chalk.cyan('🔨 Inscribing file...\n'));

        const satsPerKb = parseInt(options.satsPerKb, 10);
        const result = await parallelInscribe([job], paymentKey, indexer, satsPerKb);

        // Display results
        if (result.results.length > 0) {
          const inscription = result.results[0].inscription;
          const outpoint = `${inscription.txid}_${inscription.vout}`;

          console.log(chalk.green('\n✅ Inscription Complete!\n'));
          console.log(chalk.white('Transaction ID:'), chalk.cyan(inscription.txid));
          console.log(chalk.white('Outpoint:'), chalk.cyan(outpoint));
          console.log(chalk.white('URL:'), chalk.cyan(`https://ordfs.network/content/${outpoint}`));
          console.log(chalk.white('Total Cost:'), chalk.green(`${result.totalCost} satoshis`));
          console.log('');
        } else {
          console.error(chalk.red('\n❌ Inscription failed: No results returned\n'));
          process.exit(1);
        }
      } catch (error) {
        console.error(chalk.red('\n❌ Inscription failed:\n'));
        console.error(chalk.red(formatError(error)));
        process.exit(1);
      }
    });
}
