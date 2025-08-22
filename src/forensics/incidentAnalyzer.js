import { simpleGit } from 'simple-git';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { diffLines } from 'diff';

export class IncidentAnalyzer {
  constructor(repoPath = process.cwd()) {
    this.repoPath = repoPath;
    this.git = simpleGit(repoPath);
  }

  async analyzeIncident(incidentTime, lookbackHours = 24, affectedFiles = []) {
    const endTime = new Date(incidentTime);
    const startTime = new Date(endTime.getTime() - (lookbackHours * 60 * 60 * 1000));
    
    console.log(`🔍 Analyzing incident at ${endTime.toISOString()}`);
    console.log(`📅 Looking back ${lookbackHours} hours to ${startTime.toISOString()}`);

    const analysis = {
      incidentTime: endTime,
      lookbackPeriod: { start: startTime, end: endTime },
      suspiciousCommits: [],
      impactAnalysis: {},
      recommendations: []
    };

    // Get commits in the timeframe
    const commits = await this.getCommitsInTimeframe(startTime, endTime);
    console.log(`📝 Found ${commits.length} commits in timeframe`);

    // Analyze each commit for risk indicators
    for (const commit of commits) {
      const commitAnalysis = await this.analyzeCommit(commit, affectedFiles);
      if (commitAnalysis.riskScore > 0.3) {
        analysis.suspiciousCommits.push(commitAnalysis);
      }
    }

    // Sort by risk score
    analysis.suspiciousCommits.sort((a, b) => b.riskScore - a.riskScore);

    // Generate impact analysis
    analysis.impactAnalysis = await this.generateImpactAnalysis(analysis.suspiciousCommits, affectedFiles);

    // Generate recommendations
    analysis.recommendations = this.generateRecommendations(analysis);

    return analysis;
  }

  async getCommitsInTimeframe(startTime, endTime) {
    const since = startTime.toISOString();
    const until = endTime.toISOString();
    
    const log = await this.git.log({
      since,
      until,
      format: {
        hash: '%H',
        date: '%ai',
        message: '%s',
        author_name: '%an',
        author_email: '%ae'
      }
    });

    return log.all;
  }

  async analyzeCommit(commit, affectedFiles = []) {
    const analysis = {
      hash: commit.hash,
      shortHash: commit.hash.substring(0, 8),
      message: commit.message,
      author: commit.author_name,
      date: new Date(commit.date),
      riskScore: 0,
      riskFactors: [],
      filesChanged: [],
      linesChanged: { additions: 0, deletions: 0 }
    };

    try {
      // Get files changed in this commit
      const diffSummary = await this.git.diffSummary([`${commit.hash}^`, commit.hash]);
      analysis.filesChanged = diffSummary.files;
      analysis.linesChanged.additions = diffSummary.insertions;
      analysis.linesChanged.deletions = diffSummary.deletions;

      // Calculate risk score based on various factors
      analysis.riskScore = this.calculateRiskScore(analysis, affectedFiles);
      analysis.riskFactors = this.identifyRiskFactors(analysis, affectedFiles);

    } catch (error) {
      console.warn(`Warning: Could not analyze commit ${commit.hash}: ${error.message}`);
    }

    return analysis;
  }

  calculateRiskScore(analysis, affectedFiles) {
    let score = 0;

    // High-risk file patterns
    const highRiskPatterns = [
      /config|env|secret|key|password/i,
      /database|migration|schema/i,
      /auth|security|login/i,
      /server|deploy|production/i,
      /package\.json|requirements|Gemfile|pom\.xml/i
    ];

    // Weekend/off-hours deployments are riskier
    const commitHour = analysis.date.getHours();
    const commitDay = analysis.date.getDay();
    if (commitDay === 0 || commitDay === 6 || commitHour < 9 || commitHour > 17) {
      score += 0.2;
    }

    // Large changes are riskier
    const totalChanges = analysis.linesChanged.additions + analysis.linesChanged.deletions;
    if (totalChanges > 500) score += 0.3;
    else if (totalChanges > 100) score += 0.1;

    // Multiple files changed
    if (analysis.filesChanged.length > 10) score += 0.2;
    else if (analysis.filesChanged.length > 5) score += 0.1;

    // Check for high-risk files
    for (const file of analysis.filesChanged) {
      for (const pattern of highRiskPatterns) {
        if (pattern.test(file.file)) {
          score += 0.3;
          break;
        }
      }
    }

    // If specific affected files are mentioned, boost score for commits touching them
    if (affectedFiles.length > 0) {
      const touchesAffectedFile = analysis.filesChanged.some(file => 
        affectedFiles.some(affected => file.file.includes(affected))
      );
      if (touchesAffectedFile) score += 0.4;
    }

    // Urgent/hotfix commits
    const urgentKeywords = /urgent|hotfix|critical|emergency|fix|bug/i;
    if (urgentKeywords.test(analysis.message)) {
      score += 0.2;
    }

    // Vague commit messages are suspicious
    const vaguePattern = /^(fix|update|change|modify).{0,10}$/i;
    if (vaguePattern.test(analysis.message)) {
      score += 0.1;
    }

    return Math.min(score, 1.0);
  }

  identifyRiskFactors(analysis, affectedFiles) {
    const factors = [];

    const commitHour = analysis.date.getHours();
    const commitDay = analysis.date.getDay();
    if (commitDay === 0 || commitDay === 6 || commitHour < 9 || commitHour > 17) {
      factors.push('Off-hours deployment');
    }

    const totalChanges = analysis.linesChanged.additions + analysis.linesChanged.deletions;
    if (totalChanges > 500) factors.push('Large code changes');
    if (analysis.filesChanged.length > 10) factors.push('Many files modified');

    const highRiskPatterns = {
      'Configuration changes': /config|env|secret|key|password/i,
      'Database changes': /database|migration|schema/i,
      'Security changes': /auth|security|login/i,
      'Infrastructure changes': /server|deploy|production/i,
      'Dependency changes': /package\.json|requirements|Gemfile|pom\.xml/i
    };

    for (const [factor, pattern] of Object.entries(highRiskPatterns)) {
      if (analysis.filesChanged.some(file => pattern.test(file.file))) {
        factors.push(factor);
      }
    }

    if (affectedFiles.length > 0) {
      const touchesAffectedFile = analysis.filesChanged.some(file => 
        affectedFiles.some(affected => file.file.includes(affected))
      );
      if (touchesAffectedFile) factors.push('Modified affected files');
    }

    const urgentKeywords = /urgent|hotfix|critical|emergency|fix|bug/i;
    if (urgentKeywords.test(analysis.message)) {
      factors.push('Urgent/fix commit');
    }

    const vaguePattern = /^(fix|update|change|modify).{0,10}$/i;
    if (vaguePattern.test(analysis.message)) {
      factors.push('Vague commit message');
    }

    return factors;
  }

  async generateImpactAnalysis(suspiciousCommits, affectedFiles) {
    const impact = {
      totalSuspiciousCommits: suspiciousCommits.length,
      highRiskCommits: suspiciousCommits.filter(c => c.riskScore > 0.7).length,
      authorsInvolved: new Set(suspiciousCommits.map(c => c.author)).size,
      filesImpacted: new Set(),
      commonPatterns: {}
    };

    // Collect all files from suspicious commits
    for (const commit of suspiciousCommits) {
      commit.filesChanged.forEach(file => impact.filesImpacted.add(file.file));
    }

    // Find common risk patterns
    const patterns = {};
    for (const commit of suspiciousCommits) {
      commit.riskFactors.forEach(factor => {
        patterns[factor] = (patterns[factor] || 0) + 1;
      });
    }
    impact.commonPatterns = patterns;

    return impact;
  }

  generateRecommendations(analysis) {
    const recommendations = [];

    if (analysis.suspiciousCommits.length === 0) {
      recommendations.push({
        priority: 'low',
        category: 'analysis',
        message: 'No suspicious commits found in the specified timeframe. Consider expanding the search window or checking for infrastructure changes outside version control.'
      });
      return recommendations;
    }

    const topCommit = analysis.suspiciousCommits[0];
    
    recommendations.push({
      priority: 'high',
      category: 'investigation',
      message: `Start investigation with commit ${topCommit.shortHash} (${topCommit.message}) - highest risk score: ${topCommit.riskScore.toFixed(2)}`
    });

    if (analysis.impactAnalysis.highRiskCommits > 0) {
      recommendations.push({
        priority: 'high',
        category: 'rollback',
        message: `Consider rolling back ${analysis.impactAnalysis.highRiskCommits} high-risk commit(s) if safe to do so`
      });
    }

    // Pattern-based recommendations
    const patterns = analysis.impactAnalysis.commonPatterns;
    if (patterns['Configuration changes']) {
      recommendations.push({
        priority: 'medium',
        category: 'config',
        message: 'Configuration changes detected - verify environment variables and config files'
      });
    }

    if (patterns['Database changes']) {
      recommendations.push({
        priority: 'high',
        category: 'database',
        message: 'Database changes detected - check for migration issues and data integrity'
      });
    }

    if (patterns['Off-hours deployment']) {
      recommendations.push({
        priority: 'medium',
        category: 'process',
        message: 'Off-hours deployments found - review deployment approval processes'
      });
    }

    if (analysis.impactAnalysis.authorsInvolved > 3) {
      recommendations.push({
        priority: 'low',
        category: 'coordination',
        message: `Multiple developers (${analysis.impactAnalysis.authorsInvolved}) involved - check for coordination issues`
      });
    }

    return recommendations;
  }

  async getFileHistory(filePath, since, until) {
    const commits = await this.git.log({
      since: since.toISOString(),
      until: until.toISOString(),
      file: filePath,
      format: {
        hash: '%H',
        date: '%ai',
        message: '%s',
        author_name: '%an'
      }
    });

    return commits.all;
  }

  async getCommitDiff(commitHash, filePath = null) {
    const options = [`${commitHash}^`, commitHash];
    if (filePath) options.push('--', filePath);
    
    const diff = await this.git.diff(options);
    return diff;
  }
}