#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read package.json for version
const packageJson = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));

program
  .name('traversion')
  .description('Time machine for vibe coders - traverse through your code versions')
  .version(packageJson.version);

program
  .command('watch [path]')
  .description('Start watching a directory for changes')
  .option('-p, --port <port>', 'Port for the UI server', '3333')
  .option('-e, --extensions <exts>', 'File extensions to watch (comma-separated)', '.js,.jsx,.ts,.tsx,.py,.go,.rs,.css,.html')
  .action((path = '.', options) => {
    console.log(chalk.cyan.bold('\n⚡ TRAVERSION ⚡'));
    console.log(chalk.gray('Time Machine for Vibe Coders\n'));
    
    const watcherProcess = spawn('node', [
      join(__dirname, 'src/watcher/index.js'),
      path
    ], {
      stdio: 'inherit',
      env: {
        ...process.env,
        TRAVERSION_PORT: options.port,
        TRAVERSION_EXTENSIONS: options.extensions
      }
    });

    watcherProcess.on('error', (err) => {
      console.error(chalk.red('Failed to start watcher:', err));
      process.exit(1);
    });

    process.on('SIGINT', () => {
      watcherProcess.kill('SIGINT');
      process.exit(0);
    });
  });

program
  .command('ui')
  .description('Start only the UI server')
  .option('-p, --port <port>', 'Port for the UI server', '3000')
  .action((options) => {
    console.log(chalk.cyan('Starting Traversion UI...'));
    
    const uiProcess = spawn('npm', ['run', 'ui:dev'], {
      stdio: 'inherit',
      cwd: __dirname
    });

    uiProcess.on('error', (err) => {
      console.error(chalk.red('Failed to start UI:', err));
      process.exit(1);
    });
  });

program
  .command('init')
  .description('Initialize Traversion in the current directory')
  .action(() => {
    console.log(chalk.cyan('Initializing Traversion...'));
    console.log(chalk.green('✨ Traversion is ready!'));
    console.log(chalk.gray('\nRun `traversion watch` to start tracking your code journey'));
  });

program.parse();