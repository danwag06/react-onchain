#!/usr/bin/env node

import { Command } from 'commander';
import { registerDeployCommand } from './commands/deploy/index.js';
import { registerVersionCommands } from './commands/version/index.js';
import { registerManifestCommands } from './commands/manifest/index.js';
import { registerInscribeCommand } from './commands/inscribe/index.js';
import packageJson from '../../package.json' with { type: 'json' };

const program = new Command();

program
  .name('react-onchain')
  .description('Deploy React applications to BSV blockchain using 1Sat Ordinals')
  .version(packageJson.version);

// Register all commands
registerDeployCommand(program);
registerVersionCommands(program);
registerManifestCommands(program);
registerInscribeCommand(program);

program.parse();
