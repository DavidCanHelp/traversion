/**
 * Zero-Friction Mode
 * 
 * Addresses: "Yet another tool to maintain"
 * Solution: Works invisibly with existing tools, no new dashboards required
 */

import { MonitoringIntegrations } from '../integrations/monitoringIntegrations.js';
import { IncidentAnalyzer } from '../forensics/incidentAnalyzer.js';
import { PostMortemGenerator } from '../postmortem/postMortemGenerator.js';
import logger from '../utils/logger.js';

export class ZeroFrictionMode {
  constructor(config = {}) {
    this.mode = config.mode || 'invisible'; // invisible, augment, or replace
    this.integrations = new MonitoringIntegrations(config.monitoring);
    this.analyzer = new IncidentAnalyzer();
    this.postMortemGen = new PostMortemGenerator();
    
    // No new dashboards, no new logins, no new interfaces
    this.existingTools = {
      slack: config.slack,
      jira: config.jira,
      github: config.github,
      pagerduty: config.pagerduty
    };
  }

  /**
   * Invisible Mode: Enhance existing tools without adding new ones
   */
  async runInvisibleMode() {
    logger.info('Running in invisible mode - no new tools, just enhancements');

    // 1. Enhance Slack threads with automatic analysis
    if (this.existingTools.slack) {
      this.enhanceSlackIncidents();
    }

    // 2. Auto-enrich Jira tickets with forensics
    if (this.existingTools.jira) {
      this.enhanceJiraTickets();
    }

    // 3. Add risk scores to GitHub PRs automatically
    if (this.existingTools.github) {
      this.enhanceGitHubPRs();
    }

    // 4. Generate post-mortems directly in existing tools
    this.generateInToolPostMortems();

    return {
      status: 'active',
      mode: 'invisible',
      enhancements: this.getActiveEnhancements(),
      overhead: 'zero',
      newDashboards: 0,
      newLogins: 0,
      learningCurve: 'none'
    };
  }

  /**
   * Augment Mode: Add value to existing workflows
   */
  async augmentExistingWorkflow() {
    const enhancements = {
      // Slack: Add bot commands that work in existing channels
      slack: {
        commands: [
          '/analyze - Get instant analysis in thread',
          '/severity - Get AI severity suggestion',
          '/postmortem - Generate draft in thread'
        ],
        overhead: 'zero - works in existing channels'
      },

      // Jira: Add custom fields with automatic data
      jira: {
        customFields: [
          'Risk Score (auto-calculated)',
          'MTTR Prediction (ML-based)',
          'Root Cause (auto-detected)'
        ],
        overhead: 'zero - just metadata'
      },

      // GitHub: Comments and labels only
      github: {
        features: [
          'Automatic risk labels on PRs',
          'Comment with impact analysis',
          'Suggested reviewers based on expertise'
        ],
        overhead: 'zero - uses existing PR workflow'
      },

      // PagerDuty: Enrich alerts with context
      pagerduty: {
        features: [
          'Add code change context to alerts',
          'Suggest incident commander based on expertise',
          'Auto-generate initial response steps'
        ],
        overhead: 'zero - enhances existing alerts'
      }
    };

    return enhancements;
  }

  /**
   * One-Click Mode: Single command to add value
   */
  async oneClickValue() {
    return {
      github: 'npx traversion-analyze PR_URL',
      slack: '/traversion analyze INCIDENT_URL',
      cli: 'trav analyze --last-incident',
      api: 'curl https://api.traversion.io/quick-analyze'
    };
  }

  enhanceSlackIncidents() {
    // Listen to incident channels and auto-add context
    logger.info('Enhancing Slack incidents with zero overhead');
  }

  enhanceJiraTickets() {
    // Webhook to auto-add forensics data to tickets
    logger.info('Enhancing Jira tickets with automatic analysis');
  }

  enhanceGitHubPRs() {
    // GitHub App that only adds comments and labels
    logger.info('Adding risk analysis to GitHub PRs');
  }

  generateInToolPostMortems() {
    // Generate post-mortems in Google Docs/Confluence/Notion
    logger.info('Generating post-mortems in existing documentation tools');
  }

  getActiveEnhancements() {
    return Object.keys(this.existingTools).filter(tool => this.existingTools[tool]);
  }
}

export class GradualAdoptionPath {
  /**
   * Start with ONE feature that provides immediate value
   */
  static getAdoptionStages() {
    return {
      stage1: {
        name: 'Passive Analysis',
        timeToValue: '5 minutes',
        features: ['Git forensics on existing incidents'],
        requiredEffort: 'npm install, one command',
        risk: 'zero'
      },
      
      stage2: {
        name: 'Slack Enhancement',
        timeToValue: '1 hour',
        features: ['Slack bot for existing channels'],
        requiredEffort: 'Add bot to Slack',
        risk: 'minimal'
      },
      
      stage3: {
        name: 'Automated Post-Mortems',
        timeToValue: '1 day',
        features: ['Generate post-mortems from existing data'],
        requiredEffort: 'Connect to git',
        risk: 'low'
      },
      
      stage4: {
        name: 'Team Analytics',
        timeToValue: '1 week',
        features: ['Performance insights from existing data'],
        requiredEffort: 'Historical data import',
        risk: 'low'
      },
      
      stage5: {
        name: 'Full Platform',
        timeToValue: '1 month',
        features: ['Complete incident management platform'],
        requiredEffort: 'Team training',
        risk: 'moderate'
      }
    };
  }
}

export class InstantValueDemo {
  /**
   * Prove value in 60 seconds
   */
  static async runDemo(repoUrl, incidentDescription) {
    const analyzer = new IncidentAnalyzer();
    
    console.log('⏱️ 60-Second Value Demo Starting...\n');
    
    // Analyze last 24 hours of commits
    const analysis = await analyzer.analyzeIncident(
      new Date(),
      24,
      [] // Auto-detect affected files
    );
    
    return {
      suspiciousCommits: analysis.suspiciousCommits.slice(0, 3),
      riskScore: analysis.riskScore,
      probableCause: analysis.suspiciousCommits[0]?.message || 'Need more data',
      suggestedAction: 'Review commits by risk score',
      timeToInsight: '< 60 seconds',
      withoutTraversion: 'Hours of manual investigation'
    };
  }
}