#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import fetch from 'node-fetch';
import Table from 'cli-table3';
import { createReadStream, writeFileSync } from 'fs';
import { pipeline } from 'stream/promises';
import path from 'path';

class TraversionCLI {
  constructor() {
    this.baseUrl = process.env.TRAVERSION_URL || 'http://localhost:3333';
    this.setupCommands();
  }
  
  setupCommands() {
    program
      .name('trav')
      .description('Traversion CLI - Time travel through your code versions')
      .version('1.0.0');
    
    // Timeline command
    program
      .command('timeline')
      .description('View the version timeline')
      .option('-f, --file <file>', 'Filter by file path')
      .option('-l, --limit <limit>', 'Limit number of versions', '20')
      .option('--json', 'Output as JSON')
      .action(async (options) => {
        await this.showTimeline(options);
      });
    
    // Stats command
    program
      .command('stats')
      .description('Show statistics about tracked versions')
      .option('--json', 'Output as JSON')
      .action(async (options) => {
        await this.showStats(options);
      });
    
    // Search command
    program
      .command('search <query>')
      .description('Search for versions by vibe/tags')
      .option('-l, --limit <limit>', 'Limit results', '10')
      .action(async (query, options) => {
        await this.searchVersions(query, options);
      });
    
    // Version details command
    program
      .command('show <versionId>')
      .description('Show details of a specific version')
      .option('--content', 'Include file content')
      .action(async (versionId, options) => {
        await this.showVersion(versionId, options);
      });
    
    // Compare command
    program
      .command('diff <versionA> <versionB>')
      .description('Compare two versions')
      .option('--unified', 'Show unified diff (default)', true)
      .option('--stats', 'Show only statistics')
      .action(async (versionA, versionB, options) => {
        await this.compareVersions(versionA, versionB, options);
      });
    
    // Export command
    program
      .command('export')
      .description('Export version history')
      .option('-f, --format <format>', 'Export format (json|csv)', 'json')
      .option('-o, --output <file>', 'Output file')
      .action(async (options) => {
        await this.exportData(options);
      });
    
    // Rollback command
    program
      .command('rollback <versionId>')
      .description('Rollback a file to a specific version')
      .option('--dry-run', 'Show what would be changed without applying')
      .action(async (versionId, options) => {
        await this.rollbackVersion(versionId, options);
      });
    
    // Git status command
    program
      .command('git-status')
      .description('Show git integration status')
      .action(async () => {
        await this.showGitStatus();
      });
    
    // Recent activity command
    program
      .command('recent')
      .description('Show recent file changes')
      .option('-l, --limit <limit>', 'Number of recent changes', '10')
      .action(async (options) => {
        await this.showRecent(options);
      });
    
    // Watch command (live updates)
    program
      .command('watch')
      .description('Watch for live updates')
      .action(async () => {
        await this.watchLive();
      });
    
    // Server status command
    program
      .command('status')
      .description('Check if Traversion server is running')
      .action(async () => {
        await this.checkStatus();
      });
  }
  
  async showTimeline(options) {
    const spinner = ora('Loading timeline...').start();
    
    try {
      const response = await fetch(`${this.baseUrl}/api/timeline`);
      const timeline = await response.json();
      
      let filtered = timeline;
      if (options.file) {
        filtered = timeline.filter(v => v.file_path.includes(options.file));
      }
      
      filtered = filtered.slice(-parseInt(options.limit));
      
      spinner.stop();
      
      if (options.json) {
        console.log(JSON.stringify(filtered, null, 2));
        return;
      }
      
      const table = new Table({
        head: ['ID', 'File', 'Time', 'Tags', 'Event'],
        colWidths: [6, 30, 20, 30, 10]
      });
      
      filtered.forEach(version => {
        const tags = JSON.parse(version.vibe_tags || '[]').slice(0, 3).join(', ');
        const time = new Date(version.timestamp).toLocaleString();
        table.push([
          version.id,
          this.truncate(version.file_path, 28),
          time,
          this.truncate(tags, 28),
          version.event_type
        ]);
      });
      
      console.log(chalk.cyan('\n📚 Version Timeline\n'));
      console.log(table.toString());
      
    } catch (error) {
      spinner.fail(chalk.red('Failed to load timeline: ' + error.message));
    }
  }
  
  async showStats(options) {
    const spinner = ora('Loading statistics...').start();
    
    try {
      const response = await fetch(`${this.baseUrl}/api/stats`);
      const stats = await response.json();
      
      spinner.stop();
      
      if (options.json) {
        console.log(JSON.stringify(stats, null, 2));
        return;
      }
      
      console.log(chalk.cyan('\n📊 Traversion Statistics\n'));
      console.log(chalk.white('Total Versions: ') + chalk.green(stats.totalVersions));
      console.log(chalk.white('Total Files: ') + chalk.green(stats.totalFiles));
      console.log(chalk.white('Sessions: ') + chalk.green(stats.sessionsCount));
      console.log(chalk.white('Avg Versions/File: ') + chalk.green(stats.averageVersionsPerFile.toFixed(2)));
      
      if (stats.timeRange) {
        console.log(chalk.white('\nTime Range:'));
        console.log('  Start: ' + chalk.gray(stats.timeRange.start));
        console.log('  End: ' + chalk.gray(stats.timeRange.end));
      }
      
      if (stats.vibeTags && Object.keys(stats.vibeTags).length > 0) {
        console.log(chalk.white('\nTop Tags:'));
        Object.entries(stats.vibeTags)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .forEach(([tag, count]) => {
            console.log(`  ${chalk.yellow(tag)}: ${count}`);
          });
      }
      
    } catch (error) {
      spinner.fail(chalk.red('Failed to load statistics: ' + error.message));
    }
  }
  
  async searchVersions(query, options) {
    const spinner = ora(`Searching for "${query}"...`).start();
    
    try {
      const response = await fetch(`${this.baseUrl}/api/search-vibe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vibe: query })
      });
      
      const results = await response.json();
      
      spinner.stop();
      
      if (results.length === 0) {
        console.log(chalk.yellow('No versions found matching your search.'));
        return;
      }
      
      console.log(chalk.cyan(`\n🔍 Found ${results.length} versions matching "${query}"\n`));
      
      const table = new Table({
        head: ['ID', 'File', 'Time', 'Tags'],
        colWidths: [6, 35, 20, 40]
      });
      
      results.slice(0, parseInt(options.limit)).forEach(version => {
        const tags = JSON.parse(version.vibe_tags || '[]').join(', ');
        const time = new Date(version.timestamp).toLocaleString();
        table.push([
          version.id,
          this.truncate(version.file_path, 33),
          time,
          this.truncate(tags, 38)
        ]);
      });
      
      console.log(table.toString());
      
    } catch (error) {
      spinner.fail(chalk.red('Search failed: ' + error.message));
    }
  }
  
  async showVersion(versionId, options) {
    const spinner = ora(`Loading version ${versionId}...`).start();
    
    try {
      const response = await fetch(`${this.baseUrl}/api/version/${versionId}`);
      const version = await response.json();
      
      spinner.stop();
      
      console.log(chalk.cyan(`\n📝 Version ${versionId} Details\n`));
      console.log(chalk.white('File: ') + chalk.green(version.file_path));
      console.log(chalk.white('Time: ') + chalk.gray(new Date(version.timestamp).toLocaleString()));
      console.log(chalk.white('Event: ') + chalk.yellow(version.event_type));
      console.log(chalk.white('Hash: ') + chalk.gray(version.content_hash.substring(0, 8)));
      
      const tags = JSON.parse(version.vibe_tags || '[]');
      if (tags.length > 0) {
        console.log(chalk.white('Tags: ') + tags.map(t => chalk.yellow(t)).join(', '));
      }
      
      if (options.content) {
        console.log(chalk.white('\nContent:\n'));
        console.log(chalk.gray('─'.repeat(60)));
        console.log(version.content);
        console.log(chalk.gray('─'.repeat(60)));
      }
      
    } catch (error) {
      spinner.fail(chalk.red('Failed to load version: ' + error.message));
    }
  }
  
  async compareVersions(versionA, versionB, options) {
    const spinner = ora(`Comparing versions ${versionA} and ${versionB}...`).start();
    
    try {
      const response = await fetch(`${this.baseUrl}/api/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          versionAId: parseInt(versionA),
          versionBId: parseInt(versionB)
        })
      });
      
      const comparison = await response.json();
      
      spinner.stop();
      
      console.log(chalk.cyan(`\n🔄 Comparing v${versionA} → v${versionB}\n`));
      console.log(chalk.white('File: ') + chalk.green(comparison.versionA.file_path));
      console.log(chalk.white('Similarity: ') + this.getSimilarityColor(comparison.similarity));
      
      if (options.stats) {
        const changes = comparison.changes;
        let added = 0, removed = 0;
        
        changes.forEach(change => {
          if (change.added) added += change.count || 1;
          if (change.removed) removed += change.count || 1;
        });
        
        console.log(chalk.green(`+${added} additions`));
        console.log(chalk.red(`-${removed} deletions`));
      } else {
        console.log(chalk.white('\nChanges:'));
        console.log(chalk.gray('─'.repeat(60)));
        
        comparison.changes.forEach(change => {
          if (change.added) {
            console.log(chalk.green('+ ' + change.value));
          } else if (change.removed) {
            console.log(chalk.red('- ' + change.value));
          } else {
            console.log(chalk.gray('  ' + change.value));
          }
        });
        
        console.log(chalk.gray('─'.repeat(60)));
      }
      
    } catch (error) {
      spinner.fail(chalk.red('Comparison failed: ' + error.message));
    }
  }
  
  async exportData(options) {
    const spinner = ora('Exporting data...').start();
    
    try {
      const endpoint = options.format === 'csv' ? '/api/export/csv' : '/api/export/json';
      const response = await fetch(`${this.baseUrl}${endpoint}`);
      const data = await response.text();
      
      if (options.output) {
        writeFileSync(options.output, data);
        spinner.succeed(chalk.green(`Data exported to ${options.output}`));
      } else {
        spinner.stop();
        console.log(data);
      }
      
    } catch (error) {
      spinner.fail(chalk.red('Export failed: ' + error.message));
    }
  }
  
  async rollbackVersion(versionId, options) {
    const spinner = ora(`Preparing rollback to version ${versionId}...`).start();
    
    try {
      // First get the version details
      const versionResponse = await fetch(`${this.baseUrl}/api/version/${versionId}`);
      const version = await versionResponse.json();
      
      spinner.stop();
      
      if (options.dryRun) {
        console.log(chalk.yellow('\n🔍 Dry Run - No changes will be made\n'));
        console.log(chalk.white('Would rollback: ') + chalk.green(version.file_path));
        console.log(chalk.white('To version: ') + chalk.cyan(versionId));
        console.log(chalk.white('From: ') + chalk.gray(new Date(version.timestamp).toLocaleString()));
        return;
      }
      
      // Confirm rollback
      console.log(chalk.yellow('\n⚠️  Warning: This will overwrite the current file!\n'));
      console.log(chalk.white('File: ') + chalk.green(version.file_path));
      console.log(chalk.white('Rolling back to version: ') + chalk.cyan(versionId));
      
      const rollbackSpinner = ora('Performing rollback...').start();
      
      const response = await fetch(`${this.baseUrl}/api/rollback/${versionId}`, {
        method: 'POST'
      });
      
      const result = await response.json();
      
      if (result.success) {
        rollbackSpinner.succeed(chalk.green(result.message));
      } else {
        rollbackSpinner.fail(chalk.red(result.error || 'Rollback failed'));
      }
      
    } catch (error) {
      spinner.fail(chalk.red('Rollback failed: ' + error.message));
    }
  }
  
  async showGitStatus() {
    const spinner = ora('Checking git status...').start();
    
    try {
      const response = await fetch(`${this.baseUrl}/api/git/status`);
      const status = await response.json();
      
      spinner.stop();
      
      console.log(chalk.cyan('\n🌿 Git Integration Status\n'));
      
      if (!status.isGitRepo) {
        console.log(chalk.yellow('Not a git repository'));
        return;
      }
      
      console.log(chalk.white('Branch: ') + chalk.green(status.branch));
      console.log(chalk.white('Commit: ') + chalk.gray(status.commit?.substring(0, 8) || 'none'));
      
      if (status.remoteUrl) {
        console.log(chalk.white('Remote: ') + chalk.blue(status.remoteUrl));
      }
      
      if (status.uncommittedFiles && status.uncommittedFiles.length > 0) {
        console.log(chalk.white('\nUncommitted Files:'));
        status.uncommittedFiles.forEach(file => {
          const icon = {
            'modified': '●',
            'added': '+',
            'deleted': '-',
            'untracked': '?'
          }[file.changeType] || '○';
          
          const color = {
            'modified': chalk.yellow,
            'added': chalk.green,
            'deleted': chalk.red,
            'untracked': chalk.gray
          }[file.changeType] || chalk.white;
          
          console.log(`  ${color(icon)} ${file.filePath}`);
        });
      }
      
    } catch (error) {
      spinner.fail(chalk.red('Failed to get git status: ' + error.message));
    }
  }
  
  async showRecent(options) {
    const spinner = ora('Loading recent activity...').start();
    
    try {
      const response = await fetch(`${this.baseUrl}/api/recent`);
      const recent = await response.json();
      
      spinner.stop();
      
      const limited = recent.slice(0, parseInt(options.limit));
      
      console.log(chalk.cyan('\n⏰ Recent Activity\n'));
      
      limited.forEach(version => {
        const time = new Date(version.timestamp).toLocaleTimeString();
        const tags = JSON.parse(version.vibe_tags || '[]').slice(0, 3).join(', ');
        
        console.log(`${chalk.gray(time)} ${chalk.green('v' + version.id)} ${chalk.white(version.file_path)}`);
        if (tags) {
          console.log(`   ${chalk.yellow(tags)}`);
        }
      });
      
    } catch (error) {
      spinner.fail(chalk.red('Failed to load recent activity: ' + error.message));
    }
  }
  
  async watchLive() {
    console.log(chalk.cyan('\n👀 Watching for live updates...\n'));
    console.log(chalk.gray('Press Ctrl+C to stop\n'));
    
    try {
      const WebSocket = (await import('ws')).default;
      const ws = new WebSocket(`ws://localhost:3334`);
      
      ws.on('open', () => {
        console.log(chalk.green('✓ Connected to Traversion\n'));
      });
      
      ws.on('message', (data) => {
        const message = JSON.parse(data);
        
        if (message.type === 'version') {
          const version = message.data;
          const time = new Date().toLocaleTimeString();
          const tags = JSON.parse(version.vibe_tags || '[]').slice(0, 3).join(', ');
          
          console.log(`${chalk.gray(time)} ${chalk.green('📸')} ${chalk.white(version.file_path)} ${chalk.cyan(`v${version.id}`)}`);
          if (tags) {
            console.log(`   ${chalk.yellow(tags)}`);
          }
        }
      });
      
      ws.on('error', (error) => {
        console.error(chalk.red('WebSocket error:', error.message));
      });
      
      ws.on('close', () => {
        console.log(chalk.yellow('\nDisconnected from Traversion'));
      });
      
    } catch (error) {
      console.error(chalk.red('Failed to connect:', error.message));
    }
  }
  
  async checkStatus() {
    const spinner = ora('Checking server status...').start();
    
    try {
      const response = await fetch(`${this.baseUrl}/api/timeline`, {
        signal: AbortSignal.timeout(3000)
      });
      
      if (response.ok) {
        spinner.succeed(chalk.green('✓ Traversion server is running at ' + this.baseUrl));
      } else {
        spinner.fail(chalk.red('Server responded with error: ' + response.status));
      }
      
    } catch (error) {
      spinner.fail(chalk.red('✗ Traversion server is not accessible at ' + this.baseUrl));
      console.log(chalk.gray('\nMake sure the server is running with: npm run dev'));
    }
  }
  
  // Helper methods
  truncate(str, length) {
    if (str.length <= length) return str;
    return str.substring(0, length - 3) + '...';
  }
  
  getSimilarityColor(similarity) {
    const percent = Math.round(similarity * 100);
    if (percent > 80) return chalk.green(`${percent}%`);
    if (percent > 50) return chalk.yellow(`${percent}%`);
    return chalk.red(`${percent}%`);
  }
  
  run() {
    program.parse();
  }
}

// Add global dependencies check
try {
  const cli = new TraversionCLI();
  cli.run();
} catch (error) {
  console.error(chalk.red('Error initializing CLI:', error.message));
  process.exit(1);
}