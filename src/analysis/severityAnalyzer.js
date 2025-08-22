import { IncidentAnalyzer } from '../forensics/incidentAnalyzer.js';
import { SecureGitIntegration } from '../security/secureGitIntegration.js';
import logger from '../utils/logger.js';

/**
 * Intelligent Severity Analyzer
 * 
 * Automatically determines incident severity based on multiple factors:
 * - Code impact analysis (files changed, critical paths)
 * - Business impact indicators (user-facing, revenue impact)
 * - Infrastructure impact (services affected, dependencies)
 * - Historical patterns (similar incidents, team knowledge)
 */
export class SeverityAnalyzer {
  constructor() {
    this.incidentAnalyzer = new IncidentAnalyzer();
    this.git = new SecureGitIntegration();
    
    // Define critical system components
    this.criticalPaths = [
      'src/auth/',
      'src/api/',
      'src/security/',
      'database/',
      'config/',
      'docker',
      'k8s/',
      'package.json',
      'requirements.txt'
    ];
    
    // Business impact indicators
    this.businessCritical = [
      'payment',
      'billing',
      'auth',
      'login',
      'signup',
      'checkout',
      'order',
      'user'
    ];
    
    this.escalationRules = new Map();
    this.severityHistory = new Map();
    
    this.loadEscalationRules();
  }

  /**
   * Analyze incident severity based on multiple factors
   */
  async analyzeSeverity(incidentData) {
    try {
      const analysis = {
        suggestedSeverity: 'medium',
        confidence: 0.5,
        factors: {},
        escalationRecommendations: [],
        reasoning: []
      };

      // Factor 1: Code Impact Analysis
      if (incidentData.affectedFiles && incidentData.affectedFiles.length > 0) {
        const codeImpact = await this.analyzeCodeImpact(incidentData.affectedFiles);
        analysis.factors.codeImpact = codeImpact;
        this.applySeverityFactor(analysis, 'code', codeImpact);
      }

      // Factor 2: Error Pattern Analysis
      if (incidentData.errorLogs || incidentData.description) {
        const errorAnalysis = this.analyzeErrorPatterns(
          incidentData.errorLogs || incidentData.description
        );
        analysis.factors.errorPatterns = errorAnalysis;
        this.applySeverityFactor(analysis, 'errors', errorAnalysis);
      }

      // Factor 3: Infrastructure Impact
      if (incidentData.affectedServices) {
        const infraImpact = this.analyzeInfrastructureImpact(incidentData.affectedServices);
        analysis.factors.infrastructure = infraImpact;
        this.applySeverityFactor(analysis, 'infrastructure', infraImpact);
      }

      // Factor 4: User Impact Analysis
      if (incidentData.userReports || incidentData.affectedUsers) {
        const userImpact = this.analyzeUserImpact(incidentData);
        analysis.factors.userImpact = userImpact;
        this.applySeverityFactor(analysis, 'users', userImpact);
      }

      // Factor 5: Historical Pattern Matching
      const historicalAnalysis = await this.analyzeHistoricalPatterns(incidentData);
      analysis.factors.historical = historicalAnalysis;
      this.applySeverityFactor(analysis, 'historical', historicalAnalysis);

      // Factor 6: Time-based urgency
      const timeAnalysis = this.analyzeTimeFactors(incidentData);
      analysis.factors.timing = timeAnalysis;
      this.applySeverityFactor(analysis, 'timing', timeAnalysis);

      // Generate escalation recommendations
      analysis.escalationRecommendations = this.generateEscalationRecommendations(analysis);

      // Generate human-readable reasoning
      analysis.reasoning = this.generateReasoning(analysis);

      logger.info('Severity analysis completed', {
        suggestedSeverity: analysis.suggestedSeverity,
        confidence: analysis.confidence,
        factors: Object.keys(analysis.factors)
      });

      return analysis;

    } catch (error) {
      logger.error('Severity analysis failed', { error: error.message });
      return this.getDefaultSeverityAnalysis();
    }
  }

  async analyzeCodeImpact(affectedFiles) {
    const impact = {
      score: 0,
      criticalFiles: 0,
      totalFiles: affectedFiles.length,
      criticalPaths: [],
      riskFactors: []
    };

    for (const file of affectedFiles) {
      // Check if file is in critical path
      const isCritical = this.criticalPaths.some(path => file.includes(path));
      if (isCritical) {
        impact.criticalFiles++;
        impact.criticalPaths.push(file);
      }

      // Analyze file change complexity using git
      try {
        const fileHistory = await this.git.getFileHistory(file, 5);
        if (fileHistory.length > 0) {
          const recentChanges = fileHistory.filter(commit => {
            const commitDate = new Date(commit.date);
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            return commitDate > oneDayAgo;
          });

          if (recentChanges.length > 3) {
            impact.riskFactors.push(`High change frequency in ${file}`);
          }
        }
      } catch (error) {
        logger.debug('Could not analyze file history', { file, error: error.message });
      }
    }

    // Calculate impact score
    const criticalRatio = impact.criticalFiles / impact.totalFiles;
    const fileCountFactor = Math.min(impact.totalFiles / 10, 1); // Scale by file count
    
    impact.score = (criticalRatio * 0.7 + fileCountFactor * 0.3);

    return impact;
  }

  analyzeErrorPatterns(errorText) {
    const analysis = {
      score: 0,
      patterns: [],
      severity: 'medium',
      keywords: []
    };

    if (!errorText) return analysis;

    const text = errorText.toLowerCase();
    
    // Critical error patterns
    const criticalPatterns = [
      { pattern: /segmentation fault|sigsegv/i, weight: 1.0, desc: 'Segmentation fault detected' },
      { pattern: /out of memory|oom|memory exhausted/i, weight: 0.9, desc: 'Memory exhaustion' },
      { pattern: /database.*down|connection.*refused.*database/i, weight: 0.9, desc: 'Database connectivity issue' },
      { pattern: /authentication.*failed|unauthorized.*access/i, weight: 0.8, desc: 'Authentication failure' },
      { pattern: /payment.*failed|billing.*error/i, weight: 0.9, desc: 'Payment system issue' }
    ];

    // High severity patterns
    const highPatterns = [
      { pattern: /500 internal server error/i, weight: 0.7, desc: 'Server error' },
      { pattern: /timeout|timed out/i, weight: 0.6, desc: 'Timeout issues' },
      { pattern: /service unavailable|503/i, weight: 0.7, desc: 'Service unavailable' },
      { pattern: /disk.*full|no space left/i, weight: 0.8, desc: 'Disk space issue' }
    ];

    // Medium severity patterns  
    const mediumPatterns = [
      { pattern: /404 not found/i, weight: 0.4, desc: '404 errors' },
      { pattern: /deprecated|warning/i, weight: 0.2, desc: 'Deprecation warnings' },
      { pattern: /slow.*query|performance/i, weight: 0.5, desc: 'Performance issues' }
    ];

    let totalWeight = 0;

    [criticalPatterns, highPatterns, mediumPatterns].forEach(patterns => {
      patterns.forEach(({ pattern, weight, desc }) => {
        if (pattern.test(text)) {
          analysis.patterns.push(desc);
          totalWeight += weight;
        }
      });
    });

    analysis.score = Math.min(totalWeight, 1.0);

    // Determine severity based on patterns
    if (totalWeight >= 0.8) analysis.severity = 'critical';
    else if (totalWeight >= 0.6) analysis.severity = 'high';
    else if (totalWeight >= 0.3) analysis.severity = 'medium';
    else analysis.severity = 'low';

    return analysis;
  }

  analyzeInfrastructureImpact(affectedServices) {
    const impact = {
      score: 0,
      criticalServices: 0,
      totalServices: affectedServices.length,
      serviceTypes: []
    };

    const criticalServiceTypes = [
      'database', 'auth', 'api-gateway', 'load-balancer', 
      'payment', 'user-service', 'notification'
    ];

    const serviceScores = {
      'database': 0.9,
      'auth': 0.9,
      'api-gateway': 0.8,
      'load-balancer': 0.8,
      'payment': 1.0,
      'user-service': 0.7,
      'notification': 0.5,
      'logging': 0.3,
      'monitoring': 0.4
    };

    let totalScore = 0;

    affectedServices.forEach(service => {
      const serviceType = this.identifyServiceType(service);
      impact.serviceTypes.push(serviceType);
      
      if (criticalServiceTypes.includes(serviceType)) {
        impact.criticalServices++;
      }
      
      totalScore += serviceScores[serviceType] || 0.3;
    });

    impact.score = Math.min(totalScore / affectedServices.length, 1.0);

    return impact;
  }

  analyzeUserImpact(incidentData) {
    const impact = {
      score: 0,
      affectedUsers: 0,
      userReports: 0,
      businessImpact: 'low'
    };

    if (incidentData.affectedUsers) {
      impact.affectedUsers = parseInt(incidentData.affectedUsers) || 0;
    }

    if (incidentData.userReports) {
      impact.userReports = Array.isArray(incidentData.userReports) 
        ? incidentData.userReports.length 
        : parseInt(incidentData.userReports) || 0;
    }

    // Business impact assessment
    const description = (incidentData.description || '').toLowerCase();
    const businessKeywords = this.businessCritical;
    
    const businessMatches = businessKeywords.filter(keyword => 
      description.includes(keyword)
    );

    if (businessMatches.length > 0) {
      impact.businessImpact = businessMatches.some(k => 
        ['payment', 'billing', 'auth'].includes(k)
      ) ? 'high' : 'medium';
    }

    // Calculate score based on user impact
    let userScore = 0;
    if (impact.affectedUsers > 1000) userScore = 1.0;
    else if (impact.affectedUsers > 100) userScore = 0.7;
    else if (impact.affectedUsers > 10) userScore = 0.5;
    else if (impact.userReports > 5) userScore = 0.6;
    else if (impact.userReports > 1) userScore = 0.4;

    const businessScore = impact.businessImpact === 'high' ? 0.8 : 
                         impact.businessImpact === 'medium' ? 0.5 : 0.2;

    impact.score = Math.max(userScore, businessScore);

    return impact;
  }

  async analyzeHistoricalPatterns(incidentData) {
    const analysis = {
      score: 0,
      similarIncidents: [],
      patterns: [],
      recommendations: []
    };

    // This would typically query a database of historical incidents
    // For now, we'll simulate with basic pattern matching

    const description = incidentData.description || '';
    const affectedFiles = incidentData.affectedFiles || [];

    // Simulate finding similar incidents (in production, this would be a database query)
    const historicalSeverities = this.simulateHistoricalLookup(description, affectedFiles);

    if (historicalSeverities.length > 0) {
      const avgSeverity = this.calculateAverageHistoricalSeverity(historicalSeverities);
      analysis.score = this.severityToScore(avgSeverity);
      analysis.patterns.push(`Similar incidents typically rated as ${avgSeverity}`);
      
      if (historicalSeverities.filter(s => s === 'critical').length > 0) {
        analysis.recommendations.push('Historical data shows similar issues escalated to critical');
      }
    }

    return analysis;
  }

  analyzeTimeFactors(incidentData) {
    const analysis = {
      score: 0,
      factors: [],
      urgencyMultiplier: 1.0
    };

    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay(); // 0 = Sunday, 6 = Saturday

    // Business hours analysis (assuming 9 AM - 5 PM, Mon-Fri)
    const isBusinessHours = day >= 1 && day <= 5 && hour >= 9 && hour <= 17;
    const isWeekend = day === 0 || day === 6;

    if (!isBusinessHours) {
      analysis.factors.push('Outside business hours');
      if (isWeekend) {
        analysis.factors.push('Weekend incident');
        analysis.urgencyMultiplier = 0.8; // Lower urgency on weekends
      } else {
        analysis.urgencyMultiplier = 0.9; // Slightly lower urgency after hours
      }
    } else {
      analysis.factors.push('During business hours');
      analysis.urgencyMultiplier = 1.1; // Higher urgency during business hours
    }

    // Special high-impact times
    if (hour >= 8 && hour <= 10) {
      analysis.factors.push('Morning peak hours');
      analysis.urgencyMultiplier *= 1.2;
    }

    analysis.score = Math.min((analysis.urgencyMultiplier - 1) * 2 + 0.5, 1.0);

    return analysis;
  }

  applySeverityFactor(analysis, factorType, factorData) {
    const weights = {
      code: 0.25,
      errors: 0.30,
      infrastructure: 0.20,
      users: 0.15,
      historical: 0.05,
      timing: 0.05
    };

    const weight = weights[factorType] || 0.1;
    const factorScore = factorData.score || 0;

    // Update overall confidence and severity
    const severityContribution = factorScore * weight;
    
    // Weighted average approach to combine factors
    if (!analysis.totalWeight) analysis.totalWeight = 0;
    if (!analysis.totalScore) analysis.totalScore = 0;
    
    analysis.totalWeight += weight;
    analysis.totalScore += severityContribution;
    
    // Calculate final severity
    const overallScore = analysis.totalScore / analysis.totalWeight;
    
    analysis.suggestedSeverity = this.scoreToSeverity(overallScore);
    analysis.confidence = Math.min(analysis.totalWeight * 2, 1.0); // Scale confidence based on available data
  }

  scoreToSeverity(score) {
    if (score >= 0.8) return 'critical';
    if (score >= 0.6) return 'high';
    if (score >= 0.4) return 'medium';
    return 'low';
  }

  severityToScore(severity) {
    const scores = { critical: 0.9, high: 0.7, medium: 0.5, low: 0.3 };
    return scores[severity] || 0.5;
  }

  generateEscalationRecommendations(analysis) {
    const recommendations = [];
    
    if (analysis.suggestedSeverity === 'critical') {
      recommendations.push({
        type: 'immediate',
        action: 'Page on-call engineer immediately',
        reason: 'Critical severity incident detected'
      });
      recommendations.push({
        type: 'communication',
        action: 'Notify stakeholders within 15 minutes',
        reason: 'High business impact expected'
      });
    }
    
    if (analysis.suggestedSeverity === 'high') {
      recommendations.push({
        type: 'escalation',
        action: 'Escalate to senior engineer within 30 minutes',
        reason: 'High severity requires experienced response'
      });
    }
    
    if (analysis.factors.infrastructure?.criticalServices > 0) {
      recommendations.push({
        type: 'infrastructure',
        action: 'Alert infrastructure team',
        reason: 'Critical services are affected'
      });
    }
    
    if (analysis.factors.userImpact?.affectedUsers > 100) {
      recommendations.push({
        type: 'communication',
        action: 'Prepare customer communication',
        reason: 'Significant user impact detected'
      });
    }
    
    return recommendations;
  }

  generateReasoning(analysis) {
    const reasoning = [];
    
    reasoning.push(`Suggested severity: ${analysis.suggestedSeverity.toUpperCase()} (${Math.round(analysis.confidence * 100)}% confidence)`);
    
    if (analysis.factors.codeImpact) {
      const ci = analysis.factors.codeImpact;
      if (ci.criticalFiles > 0) {
        reasoning.push(`${ci.criticalFiles} critical system files affected`);
      }
      reasoning.push(`${ci.totalFiles} files total impacted`);
    }
    
    if (analysis.factors.errorPatterns) {
      const ep = analysis.factors.errorPatterns;
      if (ep.patterns.length > 0) {
        reasoning.push(`Error analysis: ${ep.patterns.join(', ')}`);
      }
    }
    
    if (analysis.factors.infrastructure) {
      const inf = analysis.factors.infrastructure;
      if (inf.criticalServices > 0) {
        reasoning.push(`${inf.criticalServices} critical services impacted`);
      }
    }
    
    if (analysis.factors.userImpact) {
      const ui = analysis.factors.userImpact;
      if (ui.affectedUsers > 0) {
        reasoning.push(`${ui.affectedUsers} users affected`);
      }
      if (ui.businessImpact !== 'low') {
        reasoning.push(`${ui.businessImpact} business impact`);
      }
    }
    
    if (analysis.factors.timing) {
      reasoning.push(analysis.factors.timing.factors.join(', '));
    }
    
    return reasoning;
  }

  identifyServiceType(serviceName) {
    const serviceMap = {
      'db': 'database',
      'database': 'database',
      'postgres': 'database',
      'mysql': 'database',
      'redis': 'database',
      'auth': 'auth',
      'authentication': 'auth',
      'api': 'api-gateway',
      'gateway': 'api-gateway',
      'nginx': 'load-balancer',
      'haproxy': 'load-balancer',
      'payment': 'payment',
      'billing': 'payment',
      'user': 'user-service',
      'notification': 'notification',
      'email': 'notification',
      'log': 'logging',
      'monitor': 'monitoring'
    };

    const lowerName = serviceName.toLowerCase();
    
    for (const [key, type] of Object.entries(serviceMap)) {
      if (lowerName.includes(key)) {
        return type;
      }
    }
    
    return 'other';
  }

  simulateHistoricalLookup(description, affectedFiles) {
    // In production, this would query historical incident database
    // For simulation, return some sample data based on keywords
    
    const severities = [];
    const desc = description.toLowerCase();
    
    if (desc.includes('database') || desc.includes('db')) {
      severities.push('high', 'critical', 'high');
    }
    
    if (desc.includes('payment') || desc.includes('billing')) {
      severities.push('critical', 'critical', 'high');
    }
    
    if (desc.includes('auth') || desc.includes('login')) {
      severities.push('high', 'high', 'medium');
    }
    
    if (affectedFiles.some(f => f.includes('package.json') || f.includes('requirements.txt'))) {
      severities.push('medium', 'high', 'medium');
    }
    
    return severities;
  }

  calculateAverageHistoricalSeverity(severities) {
    const scores = severities.map(s => this.severityToScore(s));
    const avgScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    return this.scoreToSeverity(avgScore);
  }

  getDefaultSeverityAnalysis() {
    return {
      suggestedSeverity: 'medium',
      confidence: 0.3,
      factors: {},
      escalationRecommendations: [{
        type: 'manual',
        action: 'Manual severity assessment required',
        reason: 'Automatic analysis failed'
      }],
      reasoning: ['Default severity due to analysis error']
    };
  }

  loadEscalationRules() {
    // Load escalation rules from configuration
    // In production, this might come from a database or config file
    
    this.escalationRules.set('critical', {
      immediateNotify: true,
      pageDuration: 0, // Page immediately
      stakeholderNotifyMinutes: 15,
      requiredRoles: ['incident-commander', 'senior-engineer']
    });
    
    this.escalationRules.set('high', {
      immediateNotify: false,
      pageDuration: 30, // Page after 30 minutes if unacknowledged
      stakeholderNotifyMinutes: 60,
      requiredRoles: ['senior-engineer']
    });
    
    this.escalationRules.set('medium', {
      immediateNotify: false,
      pageDuration: 120, // Page after 2 hours
      stakeholderNotifyMinutes: 240, // 4 hours
      requiredRoles: ['engineer']
    });
  }

  /**
   * Get escalation timeline for a severity level
   */
  getEscalationTimeline(severity) {
    const rules = this.escalationRules.get(severity);
    if (!rules) return null;

    return {
      acknowledgmentRequired: rules.pageDuration,
      stakeholderNotification: rules.stakeholderNotifyMinutes,
      requiredRoles: rules.requiredRoles,
      immediateAction: rules.immediateNotify
    };
  }
}

export default SeverityAnalyzer;