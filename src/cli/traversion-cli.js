#!/usr/bin/env node

import { program } from 'commander';
import { logger } from '../utils/logger.js';
import chalk from 'chalk';
import ora from 'ora';
import fetch from 'node-fetch';
import Table from 'cli-table3';
import { createReadStream, writeFileSync } from 'fs';
import { pipeline } from 'stream/promises';
import path from 'path';
import { IncidentAnalyzer } from '../forensics/incidentAnalyzer.js';
import { GitHubIntegration } from '../integrations/githubIntegration.js';
import { IncidentSimulator } from '../training/incidentSimulator.js';
import { PatternLearner } from '../learning/patternLearner.js';

class TraversionCLI {
  constructor() {
    this.baseUrl = process.env.TRAVERSION_URL || 'http://localhost:3333';
    this.setupCommands();
  }
  
  setupCommands() {
    program
      .name('trav')
      .description('Traversion CLI - Post-incident forensics and code review analysis')
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
    
    // Incident forensics command
    program
      .command('incident')
      .description('Analyze an incident using git history')
      .option('-t, --time <time>', 'Incident time (ISO string or relative like "2 hours ago")')
      .option('-h, --hours <hours>', 'Hours to look back', '24')
      .option('-f, --files <files>', 'Comma-separated list of affected files')
      .action(async (options) => {
        await this.analyzeIncident(options);
      });
    
    // PR analysis command
    program
      .command('pr <owner>/<repo>/<number>')
      .description('Analyze a GitHub Pull Request for risk and impact')
      .option('--comment', 'Post analysis as PR comment')
      .action(async (prSpec, options) => {
        await this.analyzePR(prSpec, options);
      });
    
    // Quick forensics command
    program
      .command('forensics')
      .description('Interactive incident analysis')
      .action(async () => {
        await this.runForensics();
      });
    
    // Analyze command for specific files/commits
    program
      .command('analyze')
      .description('Analyze specific commits or file changes')
      .option('-c, --commits <commits>', 'Comma-separated commit hashes')
      .option('-f, --files <files>', 'Comma-separated file paths')
      .option('--since <since>', 'Analyze commits since date/time')
      .action(async (options) => {
        await this.analyzeChanges(options);
      });
    
    // Training command
    program
      .command('train')
      .description('Start incident response training')
      .option('-s, --scenario <scenario>', 'Scenario ID (config-error, database-migration, etc.)')
      .option('-m, --mode <mode>', 'Training mode (guided, challenge, assessment)', 'guided')
      .option('-p, --participant <id>', 'Participant ID for tracking')
      .option('-l, --list', 'List available scenarios')
      .action(async (options) => {
        await this.runTraining(options);
      });
    
    // Pattern learning command
    program
      .command('learn')
      .description('Analyze patterns from historical incidents')
      .option('--from <incident>', 'Learn from specific incident data')
      .option('--stats', 'Show pattern learning statistics')
      .action(async (options) => {
        await this.runPatternLearning(options);
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
        logger.info(JSON.stringify(filtered, null, 2));
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
      
      logger.info(chalk.cyan('\n📚 Version Timeline\n'));
      logger.info(table.toString());
      
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
        logger.info(JSON.stringify(stats, null, 2));
        return;
      }
      
      logger.info(chalk.cyan('\n📊 Traversion Statistics\n'));
      logger.info(chalk.white('Total Versions: ') + chalk.green(stats.totalVersions));
      logger.info(chalk.white('Total Files: ') + chalk.green(stats.totalFiles));
      logger.info(chalk.white('Sessions: ') + chalk.green(stats.sessionsCount));
      logger.info(chalk.white('Avg Versions/File: ') + chalk.green(stats.averageVersionsPerFile.toFixed(2)));
      
      if (stats.timeRange) {
        logger.info(chalk.white('\nTime Range:'));
        logger.info('  Start: ' + chalk.gray(stats.timeRange.start));
        logger.info('  End: ' + chalk.gray(stats.timeRange.end));
      }
      
      if (stats.vibeTags && Object.keys(stats.vibeTags).length > 0) {
        logger.info(chalk.white('\nTop Tags:'));
        Object.entries(stats.vibeTags)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .forEach(([tag, count]) => {
            logger.info(`  ${chalk.yellow(tag)}: ${count}`);
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
        logger.info(chalk.yellow('No versions found matching your search.'));
        return;
      }
      
      logger.info(chalk.cyan(`\n🔍 Found ${results.length} versions matching "${query}"\n`));
      
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
      
      logger.info(table.toString());
      
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
      
      logger.info(chalk.cyan(`\n📝 Version ${versionId} Details\n`));
      logger.info(chalk.white('File: ') + chalk.green(version.file_path));
      logger.info(chalk.white('Time: ') + chalk.gray(new Date(version.timestamp).toLocaleString()));
      logger.info(chalk.white('Event: ') + chalk.yellow(version.event_type));
      logger.info(chalk.white('Hash: ') + chalk.gray(version.content_hash.substring(0, 8)));
      
      const tags = JSON.parse(version.vibe_tags || '[]');
      if (tags.length > 0) {
        logger.info(chalk.white('Tags: ') + tags.map(t => chalk.yellow(t)).join(', '));
      }
      
      if (options.content) {
        logger.info(chalk.white('\nContent:\n'));
        logger.info(chalk.gray('─'.repeat(60)));
        logger.info(version.content);
        logger.info(chalk.gray('─'.repeat(60)));
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
      
      logger.info(chalk.cyan(`\n🔄 Comparing v${versionA} → v${versionB}\n`));
      logger.info(chalk.white('File: ') + chalk.green(comparison.versionA.file_path));
      logger.info(chalk.white('Similarity: ') + this.getSimilarityColor(comparison.similarity));
      
      if (options.stats) {
        const changes = comparison.changes;
        let added = 0, removed = 0;
        
        changes.forEach(change => {
          if (change.added) added += change.count || 1;
          if (change.removed) removed += change.count || 1;
        });
        
        logger.info(chalk.green(`+${added} additions`));
        logger.info(chalk.red(`-${removed} deletions`));
      } else {
        logger.info(chalk.white('\nChanges:'));
        logger.info(chalk.gray('─'.repeat(60)));
        
        comparison.changes.forEach(change => {
          if (change.added) {
            logger.info(chalk.green('+ ' + change.value));
          } else if (change.removed) {
            logger.info(chalk.red('- ' + change.value));
          } else {
            logger.info(chalk.gray('  ' + change.value));
          }
        });
        
        logger.info(chalk.gray('─'.repeat(60)));
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
        logger.info(data);
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
        logger.info(chalk.yellow('\n🔍 Dry Run - No changes will be made\n'));
        logger.info(chalk.white('Would rollback: ') + chalk.green(version.file_path));
        logger.info(chalk.white('To version: ') + chalk.cyan(versionId));
        logger.info(chalk.white('From: ') + chalk.gray(new Date(version.timestamp).toLocaleString()));
        return;
      }
      
      // Confirm rollback
      logger.info(chalk.yellow('\n⚠️  Warning: This will overwrite the current file!\n'));
      logger.info(chalk.white('File: ') + chalk.green(version.file_path));
      logger.info(chalk.white('Rolling back to version: ') + chalk.cyan(versionId));
      
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
      
      logger.info(chalk.cyan('\n🌿 Git Integration Status\n'));
      
      if (!status.isGitRepo) {
        logger.info(chalk.yellow('Not a git repository'));
        return;
      }
      
      logger.info(chalk.white('Branch: ') + chalk.green(status.branch));
      logger.info(chalk.white('Commit: ') + chalk.gray(status.commit?.substring(0, 8) || 'none'));
      
      if (status.remoteUrl) {
        logger.info(chalk.white('Remote: ') + chalk.blue(status.remoteUrl));
      }
      
      if (status.uncommittedFiles && status.uncommittedFiles.length > 0) {
        logger.info(chalk.white('\nUncommitted Files:'));
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
          
          logger.info(`  ${color(icon)} ${file.filePath}`);
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
      
      logger.info(chalk.cyan('\n⏰ Recent Activity\n'));
      
      limited.forEach(version => {
        const time = new Date(version.timestamp).toLocaleTimeString();
        const tags = JSON.parse(version.vibe_tags || '[]').slice(0, 3).join(', ');
        
        logger.info(`${chalk.gray(time)} ${chalk.green('v' + version.id)} ${chalk.white(version.file_path)}`);
        if (tags) {
          logger.info(`   ${chalk.yellow(tags)}`);
        }
      });
      
    } catch (error) {
      spinner.fail(chalk.red('Failed to load recent activity: ' + error.message));
    }
  }
  
  async watchLive() {
    logger.info(chalk.cyan('\n👀 Watching for live updates...\n'));
    logger.info(chalk.gray('Press Ctrl+C to stop\n'));
    
    try {
      const WebSocket = (await import('ws')).default;
      const ws = new WebSocket(`ws://localhost:3334`);
      
      ws.on('open', () => {
        logger.info(chalk.green('✓ Connected to Traversion\n'));
      });
      
      ws.on('message', (data) => {
        const message = JSON.parse(data);
        
        if (message.type === 'version') {
          const version = message.data;
          const time = new Date().toLocaleTimeString();
          const tags = JSON.parse(version.vibe_tags || '[]').slice(0, 3).join(', ');
          
          logger.info(`${chalk.gray(time)} ${chalk.green('📸')} ${chalk.white(version.file_path)} ${chalk.cyan(`v${version.id}`)}`);
          if (tags) {
            logger.info(`   ${chalk.yellow(tags)}`);
          }
        }
      });
      
      ws.on('error', (error) => {
        logger.error(chalk.red('WebSocket error:', error.message));
      });
      
      ws.on('close', () => {
        logger.info(chalk.yellow('\nDisconnected from Traversion'));
      });
      
    } catch (error) {
      logger.error(chalk.red('Failed to connect:', error.message));
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
      logger.info(chalk.gray('\nMake sure the server is running with: npm run dev'));
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
  
  async analyzeIncident(options) {
    const analyzer = new IncidentAnalyzer();
    
    let incidentTime;
    if (options.time) {
      if (options.time.includes('ago')) {
        // Handle relative time like "2 hours ago"
        const match = options.time.match(/(\d+)\s*(hour|day|minute)s?\s*ago/);
        if (match) {
          const [, amount, unit] = match;
          const now = new Date();
          const multiplier = unit === 'hour' ? 60 * 60 * 1000 : 
                           unit === 'day' ? 24 * 60 * 60 * 1000 : 
                           60 * 1000; // minutes
          incidentTime = new Date(now.getTime() - (parseInt(amount) * multiplier));
        } else {
          incidentTime = new Date();
        }
      } else {
        incidentTime = new Date(options.time);
      }
    } else {
      incidentTime = new Date();
    }
    
    const affectedFiles = options.files ? options.files.split(',').map(f => f.trim()) : [];
    const lookbackHours = parseInt(options.hours);
    
    const spinner = ora('🔍 Analyzing incident...').start();
    
    try {
      const analysis = await analyzer.analyzeIncident(incidentTime, lookbackHours, affectedFiles);
      spinner.stop();
      
      logger.info(chalk.red('🚨 INCIDENT FORENSICS REPORT'));
      logger.info(chalk.gray('═'.repeat(60)));
      logger.info(`🕐 Incident Time: ${chalk.yellow(analysis.incidentTime.toISOString())}`);
      logger.info(`📅 Analysis Window: ${chalk.gray(lookbackHours)} hours`);
      logger.info(`🔍 Suspicious Commits: ${chalk.red(analysis.suspiciousCommits.length)}`);
      
      if (analysis.suspiciousCommits.length === 0) {
        logger.info(chalk.yellow('\n✨ No suspicious commits found in the timeframe.'));
        return;
      }
      
      logger.info('\n🎯 TOP SUSPECTS:');
      
      analysis.suspiciousCommits.slice(0, 5).forEach((commit, index) => {
        const riskEmoji = commit.riskScore > 0.7 ? '🚨' : commit.riskScore > 0.4 ? '⚠️' : '🟡';
        logger.info(`${index + 1}. ${riskEmoji} ${chalk.red(commit.shortHash)} ${chalk.white(commit.message)}`);
        logger.info(`   👤 ${chalk.gray(commit.author)} | ⏰ ${chalk.gray(commit.date.toLocaleString())}`);
        logger.info(`   📊 Risk: ${chalk.yellow((commit.riskScore * 100).toFixed(0))}% | Files: ${commit.filesChanged.length} | +${commit.linesChanged.additions}/-${commit.linesChanged.deletions}`);
        if (commit.riskFactors.length > 0) {
          logger.info(`   🏷️ ${chalk.red(commit.riskFactors.join(', '))}`);
        }
        logger.info('');
      });
      
      logger.info('📈 IMPACT ANALYSIS:');
      logger.info(`   🔢 Total Suspicious: ${analysis.impactAnalysis.totalSuspiciousCommits}`);
      logger.info(`   🚨 High Risk: ${analysis.impactAnalysis.highRiskCommits}`);
      logger.info(`   👥 Authors Involved: ${analysis.impactAnalysis.authorsInvolved}`);
      logger.info(`   📁 Files Impacted: ${analysis.impactAnalysis.filesImpacted.size}`);
      
      if (Object.keys(analysis.impactAnalysis.commonPatterns).length > 0) {
        logger.info('\n🔍 COMMON PATTERNS:');
        Object.entries(analysis.impactAnalysis.commonPatterns)
          .sort(([,a], [,b]) => b - a)
          .forEach(([pattern, count]) => {
            logger.info(`   • ${chalk.yellow(pattern)}: ${count} commits`);
          });
      }
      
      logger.info('\n💡 RECOMMENDATIONS:');
      analysis.recommendations.forEach(rec => {
        const emoji = rec.priority === 'high' ? '🔴' : rec.priority === 'medium' ? '🟡' : '🔵';
        logger.info(`${emoji} ${chalk.white.bold(rec.category.toUpperCase())}: ${rec.message}`);
      });
      
    } catch (error) {
      spinner.fail(chalk.red('Incident analysis failed: ' + error.message));
    }
  }
  
  async analyzePR(prSpec, options) {
    const [owner, repo, number] = prSpec.split('/');
    const integration = new GitHubIntegration();
    
    const spinner = ora(`🔍 Analyzing PR #${number}...`).start();
    
    try {
      const analysis = await integration.analyzePullRequest(owner, repo, parseInt(number));
      spinner.stop();
      
      const riskEmoji = analysis.riskScore > 0.7 ? '🚨' : analysis.riskScore > 0.4 ? '⚠️' : '✅';
      
      logger.info(chalk.cyan('\n📋 PULL REQUEST ANALYSIS'));
      logger.info(chalk.gray('═'.repeat(60)));
      logger.info(`${riskEmoji} ${chalk.white.bold(`PR #${analysis.pr.number}: ${analysis.pr.title}`)}`);
      logger.info(`👤 Author: ${chalk.gray(analysis.pr.author)}`);
      logger.info(`📊 Risk Score: ${chalk.yellow((analysis.riskScore * 100).toFixed(0))}%`);
      logger.info(`📈 Changes: +${chalk.green(analysis.pr.additions)} -${chalk.red(analysis.pr.deletions)} (${analysis.pr.changedFiles} files)`);
      
      logger.info('\n📊 IMPACT ASSESSMENT:');
      logger.info(`   Scope: ${analysis.impactAssessment.scope}`);
      logger.info(`   Complexity: ${analysis.impactAssessment.complexity}`);
      
      if (analysis.impactAssessment.riskAreas.length > 0) {
        logger.info(`   Risk Areas: ${chalk.red(analysis.impactAssessment.riskAreas.join(', '))}`);
      }
      
      logger.info('\n🧪 TESTING RECOMMENDATIONS:');
      analysis.impactAssessment.testingNeeds.forEach(need => {
        logger.info(`   • ${need}`);
      });
      
      if (analysis.recommendations.length > 0) {
        logger.info('\n💡 RECOMMENDATIONS:');
        analysis.recommendations.forEach(rec => {
          const emoji = rec.priority === 'high' ? '🔴' : rec.priority === 'medium' ? '🟡' : '🔵';
          logger.info(`${emoji} ${chalk.white.bold(rec.category.toUpperCase())}: ${rec.message}`);
        });
      }
      
      if (analysis.reviewSuggestions.length > 0) {
        logger.info('\n👀 REVIEW SUGGESTIONS:');
        analysis.reviewSuggestions.forEach(suggestion => {
          logger.info(`   • ${chalk.white.bold(suggestion.category.toUpperCase())}: ${suggestion.message}`);
        });
      }
      
      if (options.comment) {
        const commentSpinner = ora('📝 Posting analysis as PR comment...').start();
        try {
          const comment = integration.formatAnalysisComment(analysis);
          await integration.addPRComment(owner, repo, parseInt(number), comment);
          commentSpinner.succeed(chalk.green('✅ Analysis posted as PR comment'));
        } catch (error) {
          commentSpinner.fail(chalk.red('Failed to post comment: ' + error.message));
        }
      }
      
    } catch (error) {
      spinner.fail(chalk.red('PR analysis failed: ' + error.message));
    }
  }
  
  async runForensics() {
    logger.info(chalk.cyan.bold('\n🕵️ TRAVERSION INCIDENT FORENSICS'));
    logger.info(chalk.gray('Interactive investigation mode'));
    logger.info(chalk.gray('═'.repeat(60)));
    
    // Simple prompts without readline
    logger.info('\n📝 Please provide incident details:\n');
    logger.info('Example usage:');
    logger.info('  trav incident --time "2 hours ago" --hours 48');
    logger.info('  trav incident --time "2023-12-01T15:30:00Z" --files "server.js,config.yml"');
    logger.info('  trav pr owner/repo/123 --comment');
    logger.info('');
    logger.info('For immediate analysis, try:');
    logger.info(chalk.yellow('  trav incident --time "1 hour ago" --hours 24'));
  }
  
  async analyzeChanges(options) {
    const analyzer = new IncidentAnalyzer();
    const spinner = ora('🔍 Analyzing changes...').start();
    
    try {
      if (options.commits) {
        const commits = options.commits.split(',').map(c => c.trim());
        spinner.text = `Analyzing ${commits.length} commits...`;
        
        for (const commitHash of commits) {
          try {
            const commitAnalysis = await analyzer.analyzeCommit({hash: commitHash}, []);
            logger.info(`\n🔍 ${chalk.yellow(commitHash.substring(0, 8))}: ${commitAnalysis.message}`);
            logger.info(`   Risk: ${chalk.red((commitAnalysis.riskScore * 100).toFixed(0))}% | Files: ${commitAnalysis.filesChanged.length}`);
            if (commitAnalysis.riskFactors.length > 0) {
              logger.info(`   Factors: ${chalk.yellow(commitAnalysis.riskFactors.join(', '))}`);
            }
          } catch (error) {
            logger.info(`\n❌ Error analyzing ${commitHash}: ${error.message}`);
          }
        }
      } else if (options.since) {
        const since = new Date(options.since);
        const commits = await analyzer.getCommitsInTimeframe(since, new Date());
        logger.info(`\n📅 Found ${commits.length} commits since ${since.toISOString()}`);
        
        const analyses = [];
        for (const commit of commits.slice(0, 20)) { // Limit to recent 20
          const analysis = await analyzer.analyzeCommit(commit, []);
          if (analysis.riskScore > 0.2) {
            analyses.push(analysis);
          }
        }
        
        analyses.sort((a, b) => b.riskScore - a.riskScore);
        logger.info(`\n🎯 ${analyses.length} commits with notable risk:`);
        
        analyses.slice(0, 10).forEach(commit => {
          const riskEmoji = commit.riskScore > 0.7 ? '🚨' : commit.riskScore > 0.4 ? '⚠️' : '🟡';
          logger.info(`${riskEmoji} ${chalk.red(commit.shortHash)} ${chalk.white(commit.message)}`);
          logger.info(`   Risk: ${chalk.yellow((commit.riskScore * 100).toFixed(0))}% | ${chalk.gray(commit.author)}`);
        });
      }
      
      spinner.stop();
      
    } catch (error) {
      spinner.fail(chalk.red('Analysis failed: ' + error.message));
    }
  }

  async runTraining(options) {
    if (options.list) {
      const simulator = new IncidentSimulator();
      const scenarios = simulator.getAvailableScenarios();
      
      logger.info(chalk.cyan.bold('\n🎓 Available Training Scenarios\n'));
      
      const table = new Table({
        head: ['ID', 'Name', 'Severity', 'Duration', 'Description'],
        colWidths: [15, 25, 10, 10, 40]
      });
      
      scenarios.forEach(scenario => {
        table.push([
          scenario.id,
          scenario.name,
          scenario.severity.toUpperCase(),
          `${scenario.duration}m`,
          this.truncate(scenario.description, 38)
        ]);
      });
      
      logger.info(table.toString());
      logger.info('\nUsage: trav train --scenario <id> --mode <mode>');
      logger.info('Modes: guided (default), challenge, assessment\n');
      return;
    }

    if (!options.scenario) {
      logger.info(chalk.yellow('Please specify a scenario with --scenario or use --list to see available scenarios'));
      return;
    }

    const simulator = new IncidentSimulator();
    const spinner = ora(`🎓 Starting ${options.mode} training session...`).start();
    
    try {
      spinner.stop();
      await simulator.runTrainingSession(options.scenario, {
        mode: options.mode,
        participantId: options.participant
      });
    } catch (error) {
      spinner.fail(chalk.red('Training session failed: ' + error.message));
    }
  }

  async runPatternLearning(options) {
    const learner = new PatternLearner();
    
    if (options.stats) {
      const spinner = ora('📊 Loading pattern statistics...').start();
      
      try {
        const summary = learner.getPatternSummary();
        spinner.stop();
        
        logger.info(chalk.cyan.bold('\n🧠 Pattern Learning Statistics\n'));
        logger.info(`Total Incidents Analyzed: ${chalk.green(summary.totalIncidents)}`);
        logger.info(`Last Updated: ${chalk.gray(new Date(summary.lastUpdated).toLocaleString())}\n`);
        
        if (summary.topRiskFiles.length > 0) {
          logger.info(chalk.white.bold('🔥 Top Risk Files:'));
          summary.topRiskFiles.forEach(file => {
            logger.info(`   • ${chalk.red(file.file)} - ${file.incidentCount} incidents (${(file.confidence * 100).toFixed(0)}% confidence)`);
          });
          logger.info('');
        }
        
        if (summary.riskiestHours.length > 0) {
          logger.info(chalk.white.bold('⏰ Riskiest Hours:'));
          summary.riskiestHours.forEach(hour => {
            logger.info(`   • ${hour.hour}:00 - ${hour.incidentCount} incidents (avg severity: ${hour.avgSeverity.toFixed(1)})`);
          });
          logger.info('');
        }
        
        if (summary.commonPatterns.length > 0) {
          logger.info(chalk.white.bold('📈 Common Risk Patterns:'));
          summary.commonPatterns.forEach(pattern => {
            logger.info(`   • ${chalk.yellow(pattern.factor)} - ${pattern.incidentCount} incidents`);
          });
        }
        
      } catch (error) {
        spinner.fail(chalk.red('Failed to load pattern statistics: ' + error.message));
      }
      return;
    }

    if (options.from) {
      const spinner = ora('🧠 Learning from incident data...').start();
      
      try {
        // Parse incident data (could be JSON file or incident ID)
        let incidentData;
        
        try {
          incidentData = JSON.parse(options.from);
        } catch {
          // Try to load as file or fetch from API
          logger.info('Loading incident data from:', options.from);
          // Implementation would depend on data source
          spinner.fail(chalk.yellow('Incident data loading not yet implemented'));
          return;
        }
        
        await learner.learnFromIncident(incidentData);
        spinner.succeed(chalk.green('✅ Successfully learned from incident data'));
        
        logger.info(chalk.white('\nUpdated patterns will be applied to future analyses.'));
        
      } catch (error) {
        spinner.fail(chalk.red('Failed to learn from incident: ' + error.message));
      }
      return;
    }

    // Default: show learning help
    logger.info(chalk.cyan.bold('\n🧠 Pattern Learning Help\n'));
    logger.info('Commands:');
    logger.info('  --stats           Show pattern learning statistics');
    logger.info('  --from <data>     Learn from incident data (JSON)');
    logger.info('\nExamples:');
    logger.info('  trav learn --stats');
    logger.info('  trav learn --from \'{"id":"inc-123", "severity":"high"}\' ');
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
  logger.error(chalk.red('Error initializing CLI:', error.message));
  process.exit(1);
}