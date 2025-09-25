import { Octokit } from '@octokit/rest';
import simpleGit from 'simple-git';
import EventEmitter from 'events';
import { FeedbackLoop } from '../learning/feedbackLoop.js';
import logger from '../utils/logger.js';

/**
 * Automatic Rollback PR Generator
 *
 * Generates rollback pull requests with confidence scores and detailed
 * analysis when incidents are detected.
 */
export class RollbackGenerator extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      githubToken: config.githubToken || process.env.GITHUB_TOKEN,
      autoCreate: config.autoCreate || false,
      confidenceThreshold: config.confidenceThreshold || 0.8,
      analysisDepth: config.analysisDepth || 10,
      ...config
    };

    // Initialize components
    this.octokit = new Octokit({
      auth: this.config.githubToken
    });

    this.git = simpleGit();
    this.feedbackLoop = new FeedbackLoop(config.feedbackConfig);

    // Rollback history
    this.rollbackHistory = new Map();
    this.pendingRollbacks = new Map();
  }

  /**
   * Generate rollback for an incident
   */
  async generateRollback(incident, options = {}) {
    try {
      logger.info('Generating rollback for incident', {
        incidentId: incident.id,
        deploymentId: incident.deploymentId
      });

      // Analyze the incident
      const analysis = await this.analyzeIncident(incident);

      // Identify commits to rollback
      const rollbackTarget = await this.identifyRollbackTarget(analysis);

      // Calculate rollback confidence
      const confidence = await this.calculateRollbackConfidence(analysis, rollbackTarget);

      // Generate rollback plan
      const rollbackPlan = await this.createRollbackPlan(
        incident,
        analysis,
        rollbackTarget,
        confidence
      );

      // Create or prepare the rollback
      let result;
      if (confidence.score >= this.config.confidenceThreshold && this.config.autoCreate) {
        result = await this.executeRollback(rollbackPlan);
      } else {
        result = await this.prepareRollback(rollbackPlan);
      }

      // Store rollback history
      this.rollbackHistory.set(incident.id, {
        ...rollbackPlan,
        result,
        createdAt: new Date()
      });

      // Emit rollback event
      this.emit('rollback_generated', {
        incident,
        rollbackPlan,
        result
      });

      return result;

    } catch (error) {
      logger.error('Failed to generate rollback', {
        incidentId: incident.id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Analyze incident for rollback
   */
  async analyzeIncident(incident) {
    const analysis = {
      deploymentCommit: null,
      suspiciousCommits: [],
      affectedFiles: [],
      riskFactors: [],
      correlatedAlerts: [],
      timeline: []
    };

    try {
      // Get deployment details
      if (incident.deploymentId) {
        analysis.deploymentCommit = incident.commit;
      }

      // Analyze commit history
      const recentCommits = await this.getRecentCommits(
        incident.timestamp,
        this.config.analysisDepth
      );

      // Score each commit
      for (const commit of recentCommits) {
        const score = await this.scoreCommitSuspicion(commit, incident);
        if (score > 0.5) {
          analysis.suspiciousCommits.push({
            ...commit,
            suspicionScore: score
          });
        }
      }

      // Sort by suspicion score
      analysis.suspiciousCommits.sort((a, b) => b.suspicionScore - a.suspicionScore);

      // Extract affected files
      analysis.affectedFiles = this.extractAffectedFiles(analysis.suspiciousCommits);

      // Get risk factors
      analysis.riskFactors = this.identifyRiskFactors(analysis.suspiciousCommits);

      // Get correlated alerts
      if (incident.anomalies) {
        analysis.correlatedAlerts = incident.anomalies;
      }

      // Build timeline
      analysis.timeline = this.buildIncidentTimeline(incident, analysis);

    } catch (error) {
      logger.error('Error analyzing incident', {
        incidentId: incident.id,
        error: error.message
      });
    }

    return analysis;
  }

  /**
   * Get recent commits
   */
  async getRecentCommits(beforeTime, limit = 10) {
    try {
      const log = await this.git.log({
        '--before': beforeTime.toISOString(),
        n: limit
      });

      return log.all.map(commit => ({
        hash: commit.hash,
        message: commit.message,
        author: commit.author_name,
        email: commit.author_email,
        date: new Date(commit.date),
        diff: commit.diff
      }));

    } catch (error) {
      logger.error('Error getting recent commits', { error: error.message });
      return [];
    }
  }

  /**
   * Score commit suspicion
   */
  async scoreCommitSuspicion(commit, incident) {
    let score = 0;

    // Time proximity to incident
    const timeDiff = Math.abs(incident.timestamp - commit.date);
    const hoursDiff = timeDiff / (1000 * 60 * 60);

    if (hoursDiff < 1) {
      score += 0.5;
    } else if (hoursDiff < 6) {
      score += 0.3;
    } else if (hoursDiff < 24) {
      score += 0.1;
    }

    // Check for risky patterns
    const riskyPatterns = [
      /hotfix/i,
      /emergency/i,
      /urgent/i,
      /critical/i,
      /revert/i,
      /rollback/i
    ];

    if (riskyPatterns.some(pattern => pattern.test(commit.message))) {
      score += 0.3;
    }

    // Check for configuration changes
    if (commit.message.match(/config|env|database|migration/i)) {
      score += 0.2;
    }

    // Check author history (if available)
    const authorHistory = await this.getAuthorIncidentHistory(commit.author);
    if (authorHistory.incidentRate > 0.3) {
      score += 0.1;
    }

    // Learn from feedback
    const adjustedScore = this.feedbackLoop.getAdjustedRiskScore(
      score,
      this.extractCommitFactors(commit)
    );

    return Math.min(1.0, adjustedScore);
  }

  /**
   * Identify rollback target
   */
  async identifyRollbackTarget(analysis) {
    // Find the best commit to rollback to
    let targetCommit = null;
    let targetReason = '';

    if (analysis.suspiciousCommits.length > 0) {
      // Most suspicious commit
      const topSuspect = analysis.suspiciousCommits[0];

      // Get the commit before the suspect
      const beforeCommit = await this.getCommitBefore(topSuspect.hash);

      if (beforeCommit) {
        targetCommit = beforeCommit;
        targetReason = `Reverting ${topSuspect.hash.substr(0, 7)}: ${topSuspect.message}`;
      }
    } else if (analysis.deploymentCommit) {
      // Rollback entire deployment
      const beforeCommit = await this.getCommitBefore(analysis.deploymentCommit.hash);

      if (beforeCommit) {
        targetCommit = beforeCommit;
        targetReason = `Reverting deployment ${analysis.deploymentCommit.hash.substr(0, 7)}`;
      }
    }

    if (!targetCommit) {
      // Fallback to last known good commit
      targetCommit = await this.getLastKnownGoodCommit();
      targetReason = 'Reverting to last known stable state';
    }

    return {
      commit: targetCommit,
      reason: targetReason,
      method: analysis.suspiciousCommits.length > 1 ? 'multi-commit' : 'single-commit'
    };
  }

  /**
   * Get commit before a given hash
   */
  async getCommitBefore(hash) {
    try {
      const log = await this.git.log({
        from: `${hash}~1`,
        to: `${hash}~1`,
        n: 1
      });

      return log.latest ? {
        hash: log.latest.hash,
        message: log.latest.message,
        author: log.latest.author_name,
        date: new Date(log.latest.date)
      } : null;

    } catch (error) {
      logger.error('Error getting commit before', { hash, error: error.message });
      return null;
    }
  }

  /**
   * Calculate rollback confidence
   */
  async calculateRollbackConfidence(analysis, rollbackTarget) {
    const confidence = {
      score: 0,
      factors: [],
      warnings: []
    };

    // Suspicion score confidence
    if (analysis.suspiciousCommits.length > 0) {
      const topSuspicion = analysis.suspiciousCommits[0].suspicionScore;
      confidence.score += topSuspicion * 0.4;
      confidence.factors.push(`High suspicion commit (${(topSuspicion * 100).toFixed(0)}%)`);
    }

    // Alert correlation confidence
    if (analysis.correlatedAlerts.length > 0) {
      const criticalAlerts = analysis.correlatedAlerts.filter(a => a.severity === 'critical');
      if (criticalAlerts.length > 0) {
        confidence.score += 0.3;
        confidence.factors.push(`${criticalAlerts.length} critical alerts`);
      } else {
        confidence.score += 0.15;
        confidence.factors.push(`${analysis.correlatedAlerts.length} alerts detected`);
      }
    }

    // Rollback safety check
    const safety = await this.assessRollbackSafety(rollbackTarget);
    if (safety.isSafe) {
      confidence.score += 0.2;
      confidence.factors.push('Rollback assessed as safe');
    } else {
      confidence.warnings.push(...safety.warnings);
    }

    // Historical success rate
    const historicalSuccess = await this.getHistoricalRollbackSuccess();
    if (historicalSuccess > 0.7) {
      confidence.score += 0.1;
      confidence.factors.push(`Historical success rate: ${(historicalSuccess * 100).toFixed(0)}%`);
    }

    // Cap confidence at 1.0
    confidence.score = Math.min(1.0, confidence.score);

    // Add warnings for low confidence
    if (confidence.score < 0.5) {
      confidence.warnings.push('Low confidence - manual review strongly recommended');
    }

    return confidence;
  }

  /**
   * Assess rollback safety
   */
  async assessRollbackSafety(rollbackTarget) {
    const safety = {
      isSafe: true,
      warnings: []
    };

    try {
      // Check for database migrations
      const commitsSince = await this.getCommitsSince(rollbackTarget.commit.hash);
      const hasMigrations = commitsSince.some(c =>
        c.message.match(/migration|schema|database/i)
      );

      if (hasMigrations) {
        safety.isSafe = false;
        safety.warnings.push('Database migrations detected - manual review required');
      }

      // Check for API changes
      const hasApiChanges = commitsSince.some(c =>
        c.message.match(/api|endpoint|breaking/i)
      );

      if (hasApiChanges) {
        safety.warnings.push('API changes detected - check client compatibility');
      }

      // Check for configuration changes
      const hasConfigChanges = commitsSince.some(c =>
        c.message.match(/config|env|secret/i)
      );

      if (hasConfigChanges) {
        safety.warnings.push('Configuration changes detected - verify environment variables');
      }

    } catch (error) {
      logger.error('Error assessing rollback safety', { error: error.message });
      safety.warnings.push('Could not complete safety assessment');
    }

    return safety;
  }

  /**
   * Create rollback plan
   */
  async createRollbackPlan(incident, analysis, rollbackTarget, confidence) {
    const plan = {
      id: this.generateRollbackId(),
      incidentId: incident.id,
      targetCommit: rollbackTarget.commit,
      rollbackReason: rollbackTarget.reason,
      confidence,
      analysis: {
        suspiciousCommits: analysis.suspiciousCommits.slice(0, 3),
        affectedFiles: analysis.affectedFiles.slice(0, 10),
        riskFactors: analysis.riskFactors
      },
      steps: [],
      estimatedDuration: 0,
      risks: [],
      rollbackType: 'standard'
    };

    // Determine rollback type
    if (rollbackTarget.method === 'multi-commit') {
      plan.rollbackType = 'multi-commit';
      plan.steps.push('Create branch from target commit');
      plan.steps.push('Cherry-pick safe commits if needed');
    } else {
      plan.rollbackType = 'single-commit';
      plan.steps.push('Revert suspicious commit');
    }

    // Add standard steps
    plan.steps.push(
      'Run automated tests',
      'Deploy to staging environment',
      'Verify metrics and alerts',
      'Deploy to production'
    );

    // Estimate duration
    plan.estimatedDuration = plan.steps.length * 5; // 5 minutes per step

    // Identify risks
    if (confidence.warnings.length > 0) {
      plan.risks.push(...confidence.warnings);
    }

    if (confidence.score < 0.7) {
      plan.risks.push('Medium confidence - additional validation recommended');
    }

    return plan;
  }

  /**
   * Execute rollback (create PR)
   */
  async executeRollback(rollbackPlan) {
    try {
      // Get repository info
      const repoInfo = await this.getRepositoryInfo();

      // Create rollback branch
      const branchName = `rollback/${rollbackPlan.incidentId}`;
      await this.git.checkoutBranch(branchName, rollbackPlan.targetCommit.hash);

      // Create PR body
      const prBody = this.generatePRBody(rollbackPlan);

      // Create pull request
      const pr = await this.octokit.pulls.create({
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        title: `🚨 Rollback: ${rollbackPlan.rollbackReason}`,
        head: branchName,
        base: repoInfo.defaultBranch,
        body: prBody,
        draft: rollbackPlan.confidence.score < this.config.confidenceThreshold
      });

      // Add labels
      await this.octokit.issues.addLabels({
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        issue_number: pr.data.number,
        labels: ['rollback', 'incident', 'urgent']
      });

      // Add reviewers if high confidence
      if (rollbackPlan.confidence.score >= 0.8) {
        await this.addReviewers(pr.data.number, repoInfo);
      }

      logger.info('Rollback PR created', {
        prNumber: pr.data.number,
        incidentId: rollbackPlan.incidentId,
        confidence: rollbackPlan.confidence.score
      });

      return {
        success: true,
        prNumber: pr.data.number,
        prUrl: pr.data.html_url,
        branchName
      };

    } catch (error) {
      logger.error('Failed to execute rollback', {
        incidentId: rollbackPlan.incidentId,
        error: error.message
      });

      return {
        success: false,
        error: error.message,
        rollbackPlan
      };
    }
  }

  /**
   * Prepare rollback (without creating PR)
   */
  async prepareRollback(rollbackPlan) {
    // Store pending rollback
    this.pendingRollbacks.set(rollbackPlan.incidentId, rollbackPlan);

    // Generate rollback command
    const command = this.generateRollbackCommand(rollbackPlan);

    return {
      success: true,
      pending: true,
      rollbackPlan,
      command,
      instructions: this.generateManualInstructions(rollbackPlan)
    };
  }

  /**
   * Generate PR body
   */
  generatePRBody(rollbackPlan) {
    let body = `## 🚨 Incident Rollback\n\n`;
    body += `**Incident ID:** ${rollbackPlan.incidentId}\n`;
    body += `**Confidence:** ${(rollbackPlan.confidence.score * 100).toFixed(0)}%\n`;
    body += `**Rollback Type:** ${rollbackPlan.rollbackType}\n\n`;

    body += `### 📊 Analysis\n\n`;
    body += `**Target Commit:** ${rollbackPlan.targetCommit.hash.substr(0, 7)} - ${rollbackPlan.targetCommit.message}\n`;
    body += `**Reason:** ${rollbackPlan.rollbackReason}\n\n`;

    if (rollbackPlan.analysis.suspiciousCommits.length > 0) {
      body += `### 🔍 Suspicious Commits\n\n`;
      rollbackPlan.analysis.suspiciousCommits.forEach(commit => {
        body += `- \`${commit.hash.substr(0, 7)}\` - ${commit.message} (${(commit.suspicionScore * 100).toFixed(0)}% suspicion)\n`;
      });
      body += `\n`;
    }

    if (rollbackPlan.confidence.factors.length > 0) {
      body += `### ✅ Confidence Factors\n\n`;
      rollbackPlan.confidence.factors.forEach(factor => {
        body += `- ${factor}\n`;
      });
      body += `\n`;
    }

    if (rollbackPlan.risks.length > 0) {
      body += `### ⚠️ Risks and Warnings\n\n`;
      rollbackPlan.risks.forEach(risk => {
        body += `- ${risk}\n`;
      });
      body += `\n`;
    }

    body += `### 📋 Rollback Steps\n\n`;
    rollbackPlan.steps.forEach((step, index) => {
      body += `${index + 1}. ${step}\n`;
    });
    body += `\n`;

    body += `### ⏱️ Estimated Duration\n\n`;
    body += `Approximately ${rollbackPlan.estimatedDuration} minutes\n\n`;

    body += `### 🎯 Action Required\n\n`;
    if (rollbackPlan.confidence.score >= 0.8) {
      body += `This rollback has high confidence. Please review and merge if appropriate.\n`;
    } else if (rollbackPlan.confidence.score >= 0.6) {
      body += `This rollback has medium confidence. Manual review is recommended.\n`;
    } else {
      body += `This rollback has low confidence. Thorough manual review is required.\n`;
    }

    body += `\n---\n`;
    body += `*Generated automatically by Traversion Rollback Generator*`;

    return body;
  }

  /**
   * Generate rollback command
   */
  generateRollbackCommand(rollbackPlan) {
    if (rollbackPlan.rollbackType === 'single-commit') {
      return `git revert ${rollbackPlan.targetCommit.hash}`;
    } else {
      return `git checkout -b rollback/${rollbackPlan.incidentId} ${rollbackPlan.targetCommit.hash}`;
    }
  }

  /**
   * Generate manual instructions
   */
  generateManualInstructions(rollbackPlan) {
    const instructions = [];

    instructions.push('To manually execute this rollback:');
    instructions.push('');
    instructions.push('1. Review the rollback plan above');
    instructions.push(`2. Run: ${this.generateRollbackCommand(rollbackPlan)}`);
    instructions.push('3. Test the changes locally');
    instructions.push('4. Create a pull request with the rollback');
    instructions.push('5. Add "rollback" and "incident" labels');
    instructions.push('6. Request expedited review');

    if (rollbackPlan.risks.length > 0) {
      instructions.push('');
      instructions.push('⚠️ Special considerations:');
      rollbackPlan.risks.forEach(risk => {
        instructions.push(`- ${risk}`);
      });
    }

    return instructions.join('\n');
  }

  /**
   * Get repository info
   */
  async getRepositoryInfo() {
    try {
      const remotes = await this.git.getRemotes(true);
      const origin = remotes.find(r => r.name === 'origin');

      if (origin) {
        const match = origin.refs.fetch.match(/github\.com[:/](.+)\/(.+)\.git/);
        if (match) {
          return {
            owner: match[1],
            repo: match[2],
            defaultBranch: 'main' // or detect from git
          };
        }
      }

      throw new Error('Could not determine repository info');

    } catch (error) {
      logger.error('Error getting repository info', { error: error.message });
      throw error;
    }
  }

  /**
   * Add reviewers to PR
   */
  async addReviewers(prNumber, repoInfo) {
    try {
      // This would ideally get team members who are oncall or senior
      const reviewers = ['senior-dev-1', 'oncall-dev'];

      await this.octokit.pulls.requestReviewers({
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        pull_number: prNumber,
        reviewers
      });

    } catch (error) {
      logger.warn('Could not add reviewers', { error: error.message });
    }
  }

  /**
   * Get commits since a hash
   */
  async getCommitsSince(hash) {
    try {
      const log = await this.git.log({
        from: hash,
        to: 'HEAD'
      });

      return log.all;

    } catch (error) {
      logger.error('Error getting commits since hash', { hash, error: error.message });
      return [];
    }
  }

  /**
   * Get author incident history
   */
  async getAuthorIncidentHistory(author) {
    // This would query historical data about author's incident rate
    // For now, return mock data
    return {
      incidentRate: 0.1,
      totalCommits: 100,
      incidentCommits: 10
    };
  }

  /**
   * Get last known good commit
   */
  async getLastKnownGoodCommit() {
    // This would identify the last commit that didn't cause issues
    // For now, get commit from 24 hours ago
    try {
      const log = await this.git.log({
        '--before': new Date(Date.now() - 86400000).toISOString(),
        n: 1
      });

      return log.latest ? {
        hash: log.latest.hash,
        message: log.latest.message,
        author: log.latest.author_name,
        date: new Date(log.latest.date)
      } : null;

    } catch (error) {
      logger.error('Error getting last known good commit', { error: error.message });
      return null;
    }
  }

  /**
   * Get historical rollback success rate
   */
  async getHistoricalRollbackSuccess() {
    // Query feedback loop for rollback success rate
    const metrics = this.feedbackLoop.getPerformanceMetrics();
    return metrics.overall.accuracy || 0.7;
  }

  /**
   * Extract commit factors
   */
  extractCommitFactors(commit) {
    const factors = [];

    if (commit.message.match(/hotfix|urgent|emergency/i)) {
      factors.push({ type: 'urgent_keywords' });
    }

    if (commit.message.match(/config|database|migration/i)) {
      factors.push({ type: 'config_changes' });
    }

    const hour = new Date(commit.date).getHours();
    if (hour < 6 || hour > 22) {
      factors.push({ type: 'off_hours' });
    }

    return factors;
  }

  /**
   * Extract affected files
   */
  extractAffectedFiles(commits) {
    const files = new Set();

    commits.forEach(commit => {
      if (commit.diff && commit.diff.files) {
        commit.diff.files.forEach(file => files.add(file));
      }
    });

    return Array.from(files);
  }

  /**
   * Identify risk factors
   */
  identifyRiskFactors(commits) {
    const factors = [];

    commits.forEach(commit => {
      const commitFactors = this.extractCommitFactors(commit);
      factors.push(...commitFactors);
    });

    // Deduplicate
    return Array.from(new Map(factors.map(f => [f.type, f])).values());
  }

  /**
   * Build incident timeline
   */
  buildIncidentTimeline(incident, analysis) {
    const timeline = [];

    // Add incident start
    timeline.push({
      timestamp: incident.timestamp,
      type: 'incident_detected',
      description: 'Incident detected'
    });

    // Add suspicious commits
    analysis.suspiciousCommits.forEach(commit => {
      timeline.push({
        timestamp: commit.date,
        type: 'commit',
        description: `Commit: ${commit.message}`,
        hash: commit.hash
      });
    });

    // Add alerts
    if (incident.anomalies) {
      incident.anomalies.forEach(anomaly => {
        timeline.push({
          timestamp: incident.timestamp,
          type: 'alert',
          description: anomaly.message,
          severity: anomaly.severity
        });
      });
    }

    // Sort by timestamp
    timeline.sort((a, b) => a.timestamp - b.timestamp);

    return timeline;
  }

  /**
   * Generate rollback ID
   */
  generateRollbackId() {
    return `rollback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Approve pending rollback
   */
  async approvePendingRollback(incidentId) {
    const rollbackPlan = this.pendingRollbacks.get(incidentId);

    if (!rollbackPlan) {
      throw new Error(`No pending rollback found for incident ${incidentId}`);
    }

    const result = await this.executeRollback(rollbackPlan);
    this.pendingRollbacks.delete(incidentId);

    return result;
  }

  /**
   * Get rollback history
   */
  getRollbackHistory(limit = 10) {
    const history = Array.from(this.rollbackHistory.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);

    return history;
  }
}

export default RollbackGenerator;