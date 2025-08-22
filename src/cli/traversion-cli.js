#!/usr/bin/env node

import { program } from 'commander';
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
      
      console.log(chalk.red('🚨 INCIDENT FORENSICS REPORT'));
      console.log(chalk.gray('═'.repeat(60)));
      console.log(`🕐 Incident Time: ${chalk.yellow(analysis.incidentTime.toISOString())}`);
      console.log(`📅 Analysis Window: ${chalk.gray(lookbackHours)} hours`);
      console.log(`🔍 Suspicious Commits: ${chalk.red(analysis.suspiciousCommits.length)}`);
      
      if (analysis.suspiciousCommits.length === 0) {
        console.log(chalk.yellow('\\n✨ No suspicious commits found in the timeframe.'));\n        return;\n      }
      
      console.log('\\n🎯 TOP SUSPECTS:');\n      
      analysis.suspiciousCommits.slice(0, 5).forEach((commit, index) => {\n        const riskEmoji = commit.riskScore > 0.7 ? '🚨' : commit.riskScore > 0.4 ? '⚠️' : '🟡';\n        console.log(`${index + 1}. ${riskEmoji} ${chalk.red(commit.shortHash)} ${chalk.white(commit.message)}`);\n        console.log(`   👤 ${chalk.gray(commit.author)} | ⏰ ${chalk.gray(commit.date.toLocaleString())}`);\n        console.log(`   📊 Risk: ${chalk.yellow((commit.riskScore * 100).toFixed(0))}% | Files: ${commit.filesChanged.length} | +${commit.linesChanged.additions}/-${commit.linesChanged.deletions}`);\n        if (commit.riskFactors.length > 0) {\n          console.log(`   🏷️ ${chalk.red(commit.riskFactors.join(', '))}`);\n        }\n        console.log('');\n      });\n      \n      console.log('📈 IMPACT ANALYSIS:');\n      console.log(`   🔢 Total Suspicious: ${analysis.impactAnalysis.totalSuspiciousCommits}`);\n      console.log(`   🚨 High Risk: ${analysis.impactAnalysis.highRiskCommits}`);\n      console.log(`   👥 Authors Involved: ${analysis.impactAnalysis.authorsInvolved}`);\n      console.log(`   📁 Files Impacted: ${analysis.impactAnalysis.filesImpacted.size}`);\n      \n      if (Object.keys(analysis.impactAnalysis.commonPatterns).length > 0) {\n        console.log('\\n🔍 COMMON PATTERNS:');\n        Object.entries(analysis.impactAnalysis.commonPatterns)\n          .sort(([,a], [,b]) => b - a)\n          .forEach(([pattern, count]) => {\n            console.log(`   • ${chalk.yellow(pattern)}: ${count} commits`);\n          });\n      }\n      \n      console.log('\\n💡 RECOMMENDATIONS:');\n      analysis.recommendations.forEach(rec => {\n        const emoji = rec.priority === 'high' ? '🔴' : rec.priority === 'medium' ? '🟡' : '🔵';\n        console.log(`${emoji} ${chalk.white.bold(rec.category.toUpperCase())}: ${rec.message}`);\n      });\n      \n    } catch (error) {\n      spinner.fail(chalk.red('Incident analysis failed: ' + error.message));\n    }\n  }\n  \n  async analyzePR(prSpec, options) {\n    const [owner, repo, number] = prSpec.split('/');\n    const integration = new GitHubIntegration();\n    \n    const spinner = ora(`🔍 Analyzing PR #${number}...`).start();\n    \n    try {\n      const analysis = await integration.analyzePullRequest(owner, repo, parseInt(number));\n      spinner.stop();\n      \n      const riskEmoji = analysis.riskScore > 0.7 ? '🚨' : analysis.riskScore > 0.4 ? '⚠️' : '✅';\n      \n      console.log(chalk.cyan('\\n📋 PULL REQUEST ANALYSIS'));\n      console.log(chalk.gray('═'.repeat(60)));\n      console.log(`${riskEmoji} ${chalk.white.bold(`PR #${analysis.pr.number}: ${analysis.pr.title}`)}`);\n      console.log(`👤 Author: ${chalk.gray(analysis.pr.author)}`);\n      console.log(`📊 Risk Score: ${chalk.yellow((analysis.riskScore * 100).toFixed(0))}%`);\n      console.log(`📈 Changes: +${chalk.green(analysis.pr.additions)} -${chalk.red(analysis.pr.deletions)} (${analysis.pr.changedFiles} files)`);\n      \n      console.log('\\n📊 IMPACT ASSESSMENT:');\n      console.log(`   Scope: ${analysis.impactAssessment.scope}`);\n      console.log(`   Complexity: ${analysis.impactAssessment.complexity}`);\n      \n      if (analysis.impactAssessment.riskAreas.length > 0) {\n        console.log(`   Risk Areas: ${chalk.red(analysis.impactAssessment.riskAreas.join(', '))}`);\n      }\n      \n      console.log('\\n🧪 TESTING RECOMMENDATIONS:');\n      analysis.impactAssessment.testingNeeds.forEach(need => {\n        console.log(`   • ${need}`);\n      });\n      \n      if (analysis.recommendations.length > 0) {\n        console.log('\\n💡 RECOMMENDATIONS:');\n        analysis.recommendations.forEach(rec => {\n          const emoji = rec.priority === 'high' ? '🔴' : rec.priority === 'medium' ? '🟡' : '🔵';\n          console.log(`${emoji} ${chalk.white.bold(rec.category.toUpperCase())}: ${rec.message}`);\n        });\n      }\n      \n      if (analysis.reviewSuggestions.length > 0) {\n        console.log('\\n👀 REVIEW SUGGESTIONS:');\n        analysis.reviewSuggestions.forEach(suggestion => {\n          console.log(`   • ${chalk.white.bold(suggestion.category.toUpperCase())}: ${suggestion.message}`);\n        });\n      }\n      \n      if (options.comment) {\n        const commentSpinner = ora('📝 Posting analysis as PR comment...').start();\n        try {\n          const comment = integration.formatAnalysisComment(analysis);\n          await integration.addPRComment(owner, repo, parseInt(number), comment);\n          commentSpinner.succeed(chalk.green('✅ Analysis posted as PR comment'));\n        } catch (error) {\n          commentSpinner.fail(chalk.red('Failed to post comment: ' + error.message));\n        }\n      }\n      \n    } catch (error) {\n      spinner.fail(chalk.red('PR analysis failed: ' + error.message));\n    }\n  }\n  \n  async runForensics() {\n    console.log(chalk.cyan.bold('\\n🕵️ TRAVERSION INCIDENT FORENSICS'));\n    console.log(chalk.gray('Interactive investigation mode'));\n    console.log(chalk.gray('═'.repeat(60)));\n    \n    // Simple prompts without readline\n    console.log('\\n📝 Please provide incident details:\\n');\n    console.log('Example usage:');\n    console.log('  trav incident --time \"2 hours ago\" --hours 48');\n    console.log('  trav incident --time \"2023-12-01T15:30:00Z\" --files \"server.js,config.yml\"');\n    console.log('  trav pr owner/repo/123 --comment');\n    console.log('');\n    console.log('For immediate analysis, try:');\n    console.log(chalk.yellow('  trav incident --time \"1 hour ago\" --hours 24'));\n  }\n  \n  async analyzeChanges(options) {\n    const analyzer = new IncidentAnalyzer();\n    const spinner = ora('🔍 Analyzing changes...').start();\n    \n    try {\n      if (options.commits) {\n        const commits = options.commits.split(',').map(c => c.trim());\n        spinner.text = `Analyzing ${commits.length} commits...`;\n        \n        for (const commitHash of commits) {\n          try {\n            const commitAnalysis = await analyzer.analyzeCommit({hash: commitHash}, []);\n            console.log(`\\n🔍 ${chalk.yellow(commitHash.substring(0, 8))}: ${commitAnalysis.message}`);\n            console.log(`   Risk: ${chalk.red((commitAnalysis.riskScore * 100).toFixed(0))}% | Files: ${commitAnalysis.filesChanged.length}`);\n            if (commitAnalysis.riskFactors.length > 0) {\n              console.log(`   Factors: ${chalk.yellow(commitAnalysis.riskFactors.join(', '))}`);\n            }\n          } catch (error) {\n            console.log(`\\n❌ Error analyzing ${commitHash}: ${error.message}`);\n          }\n        }\n      } else if (options.since) {\n        const since = new Date(options.since);\n        const commits = await analyzer.getCommitsInTimeframe(since, new Date());\n        console.log(`\\n📅 Found ${commits.length} commits since ${since.toISOString()}`);\n        \n        const analyses = [];\n        for (const commit of commits.slice(0, 20)) { // Limit to recent 20\n          const analysis = await analyzer.analyzeCommit(commit, []);\n          if (analysis.riskScore > 0.2) {\n            analyses.push(analysis);\n          }\n        }\n        \n        analyses.sort((a, b) => b.riskScore - a.riskScore);\n        console.log(`\\n🎯 ${analyses.length} commits with notable risk:`);\n        \n        analyses.slice(0, 10).forEach(commit => {\n          const riskEmoji = commit.riskScore > 0.7 ? '🚨' : commit.riskScore > 0.4 ? '⚠️' : '🟡';\n          console.log(`${riskEmoji} ${chalk.red(commit.shortHash)} ${chalk.white(commit.message)}`);\n          console.log(`   Risk: ${chalk.yellow((commit.riskScore * 100).toFixed(0))}% | ${chalk.gray(commit.author)}`);\n        });\n      }\n      \n      spinner.stop();\n      \n    } catch (error) {\n      spinner.fail(chalk.red('Analysis failed: ' + error.message));\n    }\n  }\n\n  async runTraining(options) {\n    if (options.list) {\n      const simulator = new IncidentSimulator();\n      const scenarios = simulator.getAvailableScenarios();\n      \n      console.log(chalk.cyan.bold('\\n🎓 Available Training Scenarios\\n'));\n      \n      const table = new Table({\n        head: ['ID', 'Name', 'Severity', 'Duration', 'Description'],\n        colWidths: [15, 25, 10, 10, 40]\n      });\n      \n      scenarios.forEach(scenario => {\n        table.push([\n          scenario.id,\n          scenario.name,\n          scenario.severity.toUpperCase(),\n          `${scenario.duration}m`,\n          this.truncate(scenario.description, 38)\n        ]);\n      });\n      \n      console.log(table.toString());\n      console.log('\\nUsage: trav train --scenario <id> --mode <mode>');\n      console.log('Modes: guided (default), challenge, assessment\\n');\n      return;\n    }\n\n    if (!options.scenario) {\n      console.log(chalk.yellow('Please specify a scenario with --scenario or use --list to see available scenarios'));\n      return;\n    }\n\n    const simulator = new IncidentSimulator();\n    const spinner = ora(`🎓 Starting ${options.mode} training session...`).start();\n    \n    try {\n      spinner.stop();\n      await simulator.runTrainingSession(options.scenario, {\n        mode: options.mode,\n        participantId: options.participant\n      });\n    } catch (error) {\n      spinner.fail(chalk.red('Training session failed: ' + error.message));\n    }\n  }\n\n  async runPatternLearning(options) {\n    const learner = new PatternLearner();\n    \n    if (options.stats) {\n      const spinner = ora('📊 Loading pattern statistics...').start();\n      \n      try {\n        const summary = learner.getPatternSummary();\n        spinner.stop();\n        \n        console.log(chalk.cyan.bold('\\n🧠 Pattern Learning Statistics\\n'));\n        console.log(`Total Incidents Analyzed: ${chalk.green(summary.totalIncidents)}`);\n        console.log(`Last Updated: ${chalk.gray(new Date(summary.lastUpdated).toLocaleString())}\\n`);\n        \n        if (summary.topRiskFiles.length > 0) {\n          console.log(chalk.white.bold('🔥 Top Risk Files:'));\n          summary.topRiskFiles.forEach(file => {\n            console.log(`   • ${chalk.red(file.file)} - ${file.incidentCount} incidents (${(file.confidence * 100).toFixed(0)}% confidence)`);\n          });\n          console.log('');\n        }\n        \n        if (summary.riskiestHours.length > 0) {\n          console.log(chalk.white.bold('⏰ Riskiest Hours:'));\n          summary.riskiestHours.forEach(hour => {\n            console.log(`   • ${hour.hour}:00 - ${hour.incidentCount} incidents (avg severity: ${hour.avgSeverity.toFixed(1)})`);\n          });\n          console.log('');\n        }\n        \n        if (summary.commonPatterns.length > 0) {\n          console.log(chalk.white.bold('📈 Common Risk Patterns:'));\n          summary.commonPatterns.forEach(pattern => {\n            console.log(`   • ${chalk.yellow(pattern.factor)} - ${pattern.incidentCount} incidents`);\n          });\n        }\n        \n      } catch (error) {\n        spinner.fail(chalk.red('Failed to load pattern statistics: ' + error.message));\n      }\n      return;\n    }\n\n    if (options.from) {\n      const spinner = ora('🧠 Learning from incident data...').start();\n      \n      try {\n        // Parse incident data (could be JSON file or incident ID)\n        let incidentData;\n        \n        try {\n          incidentData = JSON.parse(options.from);\n        } catch {\n          // Try to load as file or fetch from API\n          console.log('Loading incident data from:', options.from);\n          // Implementation would depend on data source\n          spinner.fail(chalk.yellow('Incident data loading not yet implemented'));\n          return;\n        }\n        \n        await learner.learnFromIncident(incidentData);\n        spinner.succeed(chalk.green('✅ Successfully learned from incident data'));\n        \n        console.log(chalk.white('\\nUpdated patterns will be applied to future analyses.'));\n        \n      } catch (error) {\n        spinner.fail(chalk.red('Failed to learn from incident: ' + error.message));\n      }\n      return;\n    }\n\n    // Default: show learning help\n    console.log(chalk.cyan.bold('\\n🧠 Pattern Learning Help\\n'));\n    console.log('Commands:');\n    console.log('  --stats           Show pattern learning statistics');\n    console.log('  --from <data>     Learn from incident data (JSON)');\n    console.log('\\nExamples:');\n    console.log('  trav learn --stats');\n    console.log('  trav learn --from \\'{\"id\":\"inc-123\", \"severity\":\"high\"}\\' ');\n  }\n\n  run() {\n    program.parse();\n  }\n}

// Add global dependencies check
try {
  const cli = new TraversionCLI();
  cli.run();
} catch (error) {
  console.error(chalk.red('Error initializing CLI:', error.message));
  process.exit(1);
}