import { Octokit } from '@octokit/rest';
import { logger } from '../utils/logger.js';
import { readFileSync } from 'fs';
import path from 'path';

export class GitHubIntegration {
  constructor(token = null) {
    this.octokit = new Octokit({
      auth: token || process.env.GITHUB_TOKEN
    });
  }

  async analyzePullRequest(owner, repo, pullNumber) {
    logger.info(`🔍 Analyzing PR #${pullNumber} in ${owner}/${repo}`);

    const analysis = {
      pr: null,
      riskScore: 0,
      impactAssessment: {},
      recommendations: [],
      reviewSuggestions: []
    };

    try {
      // Get PR details
      const { data: pr } = await this.octokit.pulls.get({
        owner,
        repo,
        pull_number: pullNumber
      });

      analysis.pr = {
        number: pr.number,
        title: pr.title,
        body: pr.body,
        author: pr.user.login,
        state: pr.state,
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
        additions: pr.additions,
        deletions: pr.deletions,
        changedFiles: pr.changed_files
      };

      // Get files changed
      const { data: files } = await this.octokit.pulls.listFiles({
        owner,
        repo,
        pull_number: pullNumber
      });

      // Analyze each file for risk
      const fileAnalyses = files.map(file => this.analyzeFileChange(file));
      
      // Calculate overall risk score
      analysis.riskScore = this.calculatePRRiskScore(analysis.pr, fileAnalyses);
      
      // Generate impact assessment
      analysis.impactAssessment = this.generateImpactAssessment(analysis.pr, fileAnalyses);
      
      // Generate recommendations
      analysis.recommendations = this.generatePRRecommendations(analysis);
      
      // Generate review suggestions
      analysis.reviewSuggestions = this.generateReviewSuggestions(fileAnalyses);

      logger.info(`✅ Analysis complete. Risk score: ${analysis.riskScore.toFixed(2)}`);

    } catch (error) {
      logger.error(`❌ Error analyzing PR: ${error.message}`);
      throw error;
    }

    return analysis;
  }

  analyzeFileChange(file) {
    const analysis = {
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      riskScore: 0,
      riskFactors: []
    };

    // High-risk file patterns
    const riskPatterns = {
      'Critical Infrastructure': /^(Dockerfile|docker-compose|k8s|kubernetes|\.github\/workflows)/i,
      'Configuration': /\.(env|config|ini|yaml|yml|json)$/i,
      'Database': /(migration|schema|database|sql)/i,
      'Security': /(auth|security|login|password|token|key|secret)/i,
      'Package Dependencies': /(package\.json|requirements\.txt|Gemfile|pom\.xml|go\.mod)/i,
      'Build System': /(Makefile|build|webpack|rollup|vite\.config)/i,
      'Core Application': /(server|main|index|app)\.(js|ts|py|rb|go|java)$/i
    };

    // Calculate base risk from file patterns
    for (const [category, pattern] of Object.entries(riskPatterns)) {
      if (pattern.test(file.filename)) {
        analysis.riskFactors.push(category);
        analysis.riskScore += 0.3;
      }
    }

    // Large changes are riskier
    if (file.changes > 500) {
      analysis.riskScore += 0.4;
      analysis.riskFactors.push('Large change (500+ lines)');
    } else if (file.changes > 100) {
      analysis.riskScore += 0.2;
      analysis.riskFactors.push('Medium change (100+ lines)');
    }

    // Deletions can be risky
    if (file.deletions > file.additions && file.deletions > 50) {
      analysis.riskScore += 0.2;
      analysis.riskFactors.push('High deletion ratio');
    }

    // New files have moderate risk
    if (file.status === 'added') {
      analysis.riskScore += 0.1;
      analysis.riskFactors.push('New file');
    }

    // File removals are concerning
    if (file.status === 'removed') {
      analysis.riskScore += 0.3;
      analysis.riskFactors.push('File removal');
    }

    return analysis;
  }

  calculatePRRiskScore(pr, fileAnalyses) {
    let score = 0;

    // Base score from file analyses
    const avgFileRisk = fileAnalyses.reduce((sum, f) => sum + f.riskScore, 0) / fileAnalyses.length;
    score += avgFileRisk;

    // Large PRs are riskier
    if (pr.changedFiles > 20) {
      score += 0.3;
    } else if (pr.changedFiles > 10) {
      score += 0.1;
    }

    if (pr.additions + pr.deletions > 1000) {
      score += 0.3;
    } else if (pr.additions + pr.deletions > 500) {
      score += 0.2;
    }

    // Check PR title and description for risk indicators
    const riskKeywords = /urgent|hotfix|critical|emergency|breaking|major|refactor/i;
    if (riskKeywords.test(pr.title) || (pr.body && riskKeywords.test(pr.body))) {
      score += 0.2;
    }

    // Vague descriptions are risky
    if (!pr.body || pr.body.length < 50) {
      score += 0.1;
    }

    return Math.min(score, 1.0);
  }

  generateImpactAssessment(pr, fileAnalyses) {
    const assessment = {
      scope: this.assessScope(pr, fileAnalyses),
      complexity: this.assessComplexity(pr, fileAnalyses),
      riskAreas: this.identifyRiskAreas(fileAnalyses),
      testingNeeds: this.assessTestingNeeds(fileAnalyses),
      deploymentRisks: this.assessDeploymentRisks(fileAnalyses)
    };

    return assessment;
  }

  assessScope(pr, fileAnalyses) {
    if (pr.changedFiles > 20) return 'Large - affects many files';
    if (pr.changedFiles > 10) return 'Medium - affects multiple components';
    if (pr.changedFiles > 5) return 'Small-Medium - focused change';
    return 'Small - minimal scope';
  }

  assessComplexity(pr, fileAnalyses) {
    const hasInfraChanges = fileAnalyses.some(f => 
      f.riskFactors.includes('Critical Infrastructure') || 
      f.riskFactors.includes('Configuration')
    );

    const hasDbChanges = fileAnalyses.some(f => 
      f.riskFactors.includes('Database')
    );

    if (hasInfraChanges && hasDbChanges) return 'High - infrastructure and data changes';
    if (hasInfraChanges) return 'Medium-High - infrastructure changes';
    if (hasDbChanges) return 'Medium-High - database changes';
    if (pr.additions + pr.deletions > 500) return 'Medium - large code changes';
    return 'Low-Medium - standard code changes';
  }

  identifyRiskAreas(fileAnalyses) {
    const riskAreas = new Set();
    
    fileAnalyses.forEach(file => {
      file.riskFactors.forEach(factor => riskAreas.add(factor));
    });

    return Array.from(riskAreas);
  }

  assessTestingNeeds(fileAnalyses) {
    const needs = [];

    if (fileAnalyses.some(f => f.riskFactors.includes('Database'))) {
      needs.push('Database migration testing');
      needs.push('Data integrity verification');
    }

    if (fileAnalyses.some(f => f.riskFactors.includes('Security'))) {
      needs.push('Security regression testing');
      needs.push('Authentication/authorization testing');
    }

    if (fileAnalyses.some(f => f.riskFactors.includes('Critical Infrastructure'))) {
      needs.push('Deployment pipeline testing');
      needs.push('Infrastructure validation');
    }

    if (fileAnalyses.some(f => f.riskFactors.includes('Core Application'))) {
      needs.push('Full regression testing');
      needs.push('Performance testing');
    }

    if (fileAnalyses.some(f => f.riskFactors.includes('Package Dependencies'))) {
      needs.push('Dependency compatibility testing');
      needs.push('Security vulnerability scanning');
    }

    return needs.length > 0 ? needs : ['Standard unit and integration tests'];
  }

  assessDeploymentRisks(fileAnalyses) {
    const risks = [];

    if (fileAnalyses.some(f => f.riskFactors.includes('Database'))) {
      risks.push('Database migration may cause downtime');
      risks.push('Consider blue-green deployment');
    }

    if (fileAnalyses.some(f => f.riskFactors.includes('Configuration'))) {
      risks.push('Configuration changes may require service restart');
      risks.push('Verify environment-specific configs');
    }

    if (fileAnalyses.some(f => f.riskFactors.includes('Package Dependencies'))) {
      risks.push('Dependency updates may introduce breaking changes');
      risks.push('Test in staging environment thoroughly');
    }

    const totalChanges = fileAnalyses.reduce((sum, f) => sum + f.changes, 0);
    if (totalChanges > 1000) {
      risks.push('Large changeset - consider feature flags');
      risks.push('Plan for quick rollback capability');
    }

    return risks.length > 0 ? risks : ['Standard deployment risks - monitor closely'];
  }

  generatePRRecommendations(analysis) {
    const recommendations = [];

    if (analysis.riskScore > 0.7) {
      recommendations.push({
        priority: 'high',
        category: 'review',
        message: 'High-risk PR - require multiple senior reviewers and thorough testing'
      });
    } else if (analysis.riskScore > 0.4) {
      recommendations.push({
        priority: 'medium',
        category: 'review',
        message: 'Medium-risk PR - ensure comprehensive review and testing'
      });
    }

    if (analysis.pr.changedFiles > 15) {
      recommendations.push({
        priority: 'medium',
        category: 'process',
        message: 'Consider breaking this large PR into smaller, focused changes'
      });
    }

    if (!analysis.pr.body || analysis.pr.body.length < 50) {
      recommendations.push({
        priority: 'low',
        category: 'documentation',
        message: 'Add detailed description explaining the changes and their impact'
      });
    }

    if (analysis.impactAssessment.riskAreas.includes('Database')) {
      recommendations.push({
        priority: 'high',
        category: 'testing',
        message: 'Run database migrations in staging environment before merging'
      });
    }

    if (analysis.impactAssessment.riskAreas.includes('Security')) {
      recommendations.push({
        priority: 'high',
        category: 'security',
        message: 'Require security team review for authentication/authorization changes'
      });
    }

    return recommendations;
  }

  generateReviewSuggestions(fileAnalyses) {
    const suggestions = [];

    // Group files by risk category
    const highRiskFiles = fileAnalyses.filter(f => f.riskScore > 0.5);
    const configFiles = fileAnalyses.filter(f => f.riskFactors.includes('Configuration'));
    const dbFiles = fileAnalyses.filter(f => f.riskFactors.includes('Database'));

    if (highRiskFiles.length > 0) {
      suggestions.push({
        category: 'focus',
        message: `Pay special attention to these high-risk files: ${highRiskFiles.map(f => f.filename).join(', ')}`
      });
    }

    if (configFiles.length > 0) {
      suggestions.push({
        category: 'config',
        message: 'Verify configuration changes against all environments (dev, staging, prod)'
      });
    }

    if (dbFiles.length > 0) {
      suggestions.push({
        category: 'database',
        message: 'Ensure database changes are backward compatible and can be rolled back'
      });
    }

    const newFiles = fileAnalyses.filter(f => f.riskFactors.includes('New file'));
    if (newFiles.length > 0) {
      suggestions.push({
        category: 'new-files',
        message: `Review new files for coding standards and security: ${newFiles.map(f => f.filename).join(', ')}`
      });
    }

    const removedFiles = fileAnalyses.filter(f => f.riskFactors.includes('File removal'));
    if (removedFiles.length > 0) {
      suggestions.push({
        category: 'removals',
        message: 'Verify that file removals won\'t break dependent code or deployment scripts'
      });
    }

    return suggestions;
  }

  async addPRComment(owner, repo, pullNumber, comment) {
    await this.octokit.issues.createComment({
      owner,
      repo,
      issue_number: pullNumber,
      body: comment
    });
  }

  async requestReviewers(owner, repo, pullNumber, reviewers, teamReviewers = []) {
    await this.octokit.pulls.requestReviewers({
      owner,
      repo,
      pull_number: pullNumber,
      reviewers,
      team_reviewers: teamReviewers
    });
  }

  formatAnalysisComment(analysis) {
    const riskEmoji = analysis.riskScore > 0.7 ? '🚨' : analysis.riskScore > 0.4 ? '⚠️' : '✅';
    
    let comment = `## ${riskEmoji} Traversion Impact Analysis\n\n`;
    comment += `**Risk Score:** ${(analysis.riskScore * 100).toFixed(0)}% ${riskEmoji}\n\n`;
    
    comment += `### 📊 Impact Assessment\n`;
    comment += `- **Scope:** ${analysis.impactAssessment.scope}\n`;
    comment += `- **Complexity:** ${analysis.impactAssessment.complexity}\n`;
    
    if (analysis.impactAssessment.riskAreas.length > 0) {
      comment += `- **Risk Areas:** ${analysis.impactAssessment.riskAreas.join(', ')}\n`;
    }
    
    comment += `\n### 🧪 Testing Recommendations\n`;
    analysis.impactAssessment.testingNeeds.forEach(need => {
      comment += `- [ ] ${need}\n`;
    });
    
    if (analysis.recommendations.length > 0) {
      comment += `\n### 💡 Recommendations\n`;
      analysis.recommendations.forEach(rec => {
        const emoji = rec.priority === 'high' ? '🔴' : rec.priority === 'medium' ? '🟡' : '🔵';
        comment += `${emoji} **${rec.category.toUpperCase()}:** ${rec.message}\n`;
      });
    }
    
    if (analysis.reviewSuggestions.length > 0) {
      comment += `\n### 👀 Review Focus Areas\n`;
      analysis.reviewSuggestions.forEach(suggestion => {
        comment += `- **${suggestion.category}:** ${suggestion.message}\n`;
      });
    }
    
    comment += `\n---\n*Generated by Traversion v${process.env.npm_package_version || '0.1.0'}*`;
    
    return comment;
  }
}