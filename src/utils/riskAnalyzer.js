/**
 * Centralized Risk Analysis Module
 * 
 * Provides consistent risk scoring across the application
 */

import { logger } from './logger.js';

export class RiskAnalyzer {
  constructor(config = {}) {
    this.config = {
      weights: {
        timing: 0.2,
        changeSize: 0.3,
        fileType: 0.3,
        commitMessage: 0.2
      },
      thresholds: {
        high: 0.7,
        medium: 0.4,
        low: 0.2
      },
      ...config
    };
    
    this.riskPatterns = {
      highRisk: {
        files: [
          /config|env|secret|key|password/i,
          /database|migration|schema/i,
          /auth|security|login|jwt|token/i,
          /\.env|\.credentials/i,
          /production|deploy/i
        ],
        messages: [
          /hotfix|critical|urgent|emergency/i,
          /revert|rollback/i,
          /security|vulnerability|CVE/i
        ]
      },
      mediumRisk: {
        files: [
          /server|api|endpoint/i,
          /package\.json|requirements|Gemfile|pom\.xml/i,
          /docker|kubernetes|k8s/i,
          /\.yml|\.yaml|\.json/i
        ],
        messages: [
          /fix|bug|issue|problem/i,
          /update|upgrade|patch/i,
          /refactor|restructure/i
        ]
      }
    };
  }
  
  /**
   * Calculate comprehensive risk score for a commit
   */
  calculateCommitRisk(commit, options = {}) {
    const scores = {
      timing: this.calculateTimingRisk(commit.date),
      changeSize: this.calculateChangeSizeRisk(commit.linesChanged),
      fileType: this.calculateFileTypeRisk(commit.filesChanged),
      commitMessage: this.calculateMessageRisk(commit.message)
    };
    
    // Apply custom affected files boost if provided
    if (options.affectedFiles?.length > 0) {
      const affectedScore = this.calculateAffectedFilesRisk(
        commit.filesChanged,
        options.affectedFiles
      );
      scores.affected = affectedScore;
    }
    
    // Calculate weighted score
    let totalScore = 0;
    let totalWeight = 0;
    
    for (const [key, score] of Object.entries(scores)) {
      const weight = key === 'affected' ? 0.4 : this.config.weights[key] || 0.1;
      totalScore += score * weight;
      totalWeight += weight;
    }
    
    const finalScore = Math.min(totalScore / totalWeight, 1.0);
    
    return {
      score: finalScore,
      level: this.getRiskLevel(finalScore),
      factors: this.identifyRiskFactors(commit, scores),
      breakdown: scores
    };
  }
  
  /**
   * Calculate timing-based risk
   */
  calculateTimingRisk(date) {
    const commitDate = new Date(date);
    const hour = commitDate.getHours();
    const day = commitDate.getDay();
    
    let score = 0;
    
    // Weekend deployments
    if (day === 0 || day === 6) {
      score += 0.4;
    }
    
    // Off-hours (before 9am or after 6pm)
    if (hour < 9 || hour > 18) {
      score += 0.3;
    }
    
    // Late night (11pm - 4am)
    if (hour >= 23 || hour <= 4) {
      score += 0.3;
    }
    
    // Friday afternoon (higher risk)
    if (day === 5 && hour >= 15) {
      score += 0.2;
    }
    
    return Math.min(score, 1.0);
  }
  
  /**
   * Calculate risk based on change size
   */
  calculateChangeSizeRisk(linesChanged) {
    const total = linesChanged.additions + linesChanged.deletions;
    
    if (total > 1000) return 0.9;
    if (total > 500) return 0.7;
    if (total > 200) return 0.5;
    if (total > 100) return 0.3;
    if (total > 50) return 0.2;
    
    return 0.1;
  }
  
  /**
   * Calculate risk based on file types
   */
  calculateFileTypeRisk(filesChanged) {
    let maxRisk = 0;
    
    for (const file of filesChanged) {
      const fileName = file.file || file;
      
      // Check high risk patterns
      for (const pattern of this.riskPatterns.highRisk.files) {
        if (pattern.test(fileName)) {
          maxRisk = Math.max(maxRisk, 0.8);
        }
      }
      
      // Check medium risk patterns
      for (const pattern of this.riskPatterns.mediumRisk.files) {
        if (pattern.test(fileName)) {
          maxRisk = Math.max(maxRisk, 0.5);
        }
      }
    }
    
    // Multiple files increase risk
    if (filesChanged.length > 20) maxRisk += 0.2;
    else if (filesChanged.length > 10) maxRisk += 0.1;
    
    return Math.min(maxRisk, 1.0);
  }
  
  /**
   * Calculate risk based on commit message
   */
  calculateMessageRisk(message) {
    let score = 0;
    
    // Check high risk message patterns
    for (const pattern of this.riskPatterns.highRisk.messages) {
      if (pattern.test(message)) {
        score = Math.max(score, 0.7);
      }
    }
    
    // Check medium risk patterns
    for (const pattern of this.riskPatterns.mediumRisk.messages) {
      if (pattern.test(message)) {
        score = Math.max(score, 0.4);
      }
    }
    
    // Vague messages are risky
    const vaguePattern = /^(fix|update|change|modify|edit).{0,10}$/i;
    if (vaguePattern.test(message)) {
      score = Math.max(score, 0.3);
    }
    
    // Very short messages are suspicious
    if (message.length < 10) {
      score = Math.max(score, 0.2);
    }
    
    return score;
  }
  
  /**
   * Calculate risk for affected files
   */
  calculateAffectedFilesRisk(filesChanged, affectedFiles) {
    const touchesAffected = filesChanged.some(file => {
      const fileName = file.file || file;
      return affectedFiles.some(affected => fileName.includes(affected));
    });
    
    return touchesAffected ? 0.8 : 0;
  }
  
  /**
   * Get risk level from score
   */
  getRiskLevel(score) {
    if (score >= this.config.thresholds.high) return 'HIGH';
    if (score >= this.config.thresholds.medium) return 'MEDIUM';
    if (score >= this.config.thresholds.low) return 'LOW';
    return 'MINIMAL';
  }
  
  /**
   * Identify specific risk factors
   */
  identifyRiskFactors(commit, scores) {
    const factors = [];
    
    // Timing factors
    if (scores.timing > 0.3) {
      const date = new Date(commit.date);
      const day = date.getDay();
      const hour = date.getHours();
      
      if (day === 0 || day === 6) factors.push('Weekend deployment');
      if (hour < 9 || hour > 18) factors.push('Off-hours deployment');
      if (hour >= 23 || hour <= 4) factors.push('Late night deployment');
    }
    
    // Size factors
    if (scores.changeSize > 0.5) {
      const total = commit.linesChanged.additions + commit.linesChanged.deletions;
      factors.push(`Large changes (${total} lines)`);
    }
    
    // File type factors
    if (scores.fileType > 0.5) {
      const criticalFiles = [];
      for (const file of commit.filesChanged) {
        const fileName = file.file || file;
        if (/config|env|secret/i.test(fileName)) criticalFiles.push('configuration');
        if (/database|migration/i.test(fileName)) criticalFiles.push('database');
        if (/auth|security/i.test(fileName)) criticalFiles.push('security');
      }
      
      if (criticalFiles.length > 0) {
        factors.push(`Critical files (${[...new Set(criticalFiles)].join(', ')})`);
      }
    }
    
    // Message factors
    if (scores.commitMessage > 0.4) {
      if (/hotfix|critical|urgent/i.test(commit.message)) {
        factors.push('Urgent/hotfix commit');
      }
      if (/^(fix|update|change).{0,10}$/i.test(commit.message)) {
        factors.push('Vague commit message');
      }
    }
    
    // Affected files
    if (scores.affected > 0) {
      factors.push('Modifies incident-related files');
    }
    
    return factors;
  }
  
  /**
   * Analyze risk for a pull request
   */
  analyzePullRequestRisk(pullRequest) {
    const commits = pullRequest.commits || [];
    const files = pullRequest.files || [];
    
    // Analyze individual commit risks
    const commitRisks = commits.map(commit => this.calculateCommitRisk(commit));
    
    // Calculate aggregate risk
    const maxRisk = Math.max(...commitRisks.map(r => r.score), 0);
    const avgRisk = commitRisks.reduce((sum, r) => sum + r.score, 0) / (commitRisks.length || 1);
    
    // PR-specific risk factors
    let prRisk = 0;
    
    // Large PRs are risky
    if (files.length > 50) prRisk += 0.3;
    else if (files.length > 20) prRisk += 0.2;
    else if (files.length > 10) prRisk += 0.1;
    
    // Many commits might indicate complexity
    if (commits.length > 20) prRisk += 0.2;
    else if (commits.length > 10) prRisk += 0.1;
    
    // Final score weighted average
    const finalScore = Math.min((maxRisk * 0.5) + (avgRisk * 0.3) + (prRisk * 0.2), 1.0);
    
    return {
      score: finalScore,
      level: this.getRiskLevel(finalScore),
      maxCommitRisk: maxRisk,
      avgCommitRisk: avgRisk,
      fileCount: files.length,
      commitCount: commits.length,
      recommendations: this.generateRecommendations(finalScore, commitRisks)
    };
  }
  
  /**
   * Generate recommendations based on risk analysis
   */
  generateRecommendations(score, commitRisks = []) {
    const recommendations = [];
    
    if (score >= this.config.thresholds.high) {
      recommendations.push({
        priority: 'HIGH',
        message: 'High-risk changes detected. Require senior review and extensive testing.'
      });
    }
    
    // Check for specific patterns
    const hasSecurityChanges = commitRisks.some(r => 
      r.factors.some(f => f.includes('security'))
    );
    
    if (hasSecurityChanges) {
      recommendations.push({
        priority: 'HIGH',
        message: 'Security-related changes detected. Require security team review.'
      });
    }
    
    const hasDatabaseChanges = commitRisks.some(r => 
      r.factors.some(f => f.includes('database'))
    );
    
    if (hasDatabaseChanges) {
      recommendations.push({
        priority: 'MEDIUM',
        message: 'Database changes detected. Ensure migrations are tested and reversible.'
      });
    }
    
    const hasOffHours = commitRisks.some(r => 
      r.factors.some(f => f.includes('Off-hours') || f.includes('Weekend'))
    );
    
    if (hasOffHours) {
      recommendations.push({
        priority: 'LOW',
        message: 'Off-hours commits detected. Verify deployment timing and on-call coverage.'
      });
    }
    
    return recommendations;
  }
}

// Export singleton instance
export const riskAnalyzer = new RiskAnalyzer();

export default RiskAnalyzer;