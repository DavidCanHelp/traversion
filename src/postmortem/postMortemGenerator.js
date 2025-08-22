import { IncidentAnalyzer } from '../forensics/incidentAnalyzer.js';
import { SecureGitIntegration } from '../security/secureGitIntegration.js';
import { InputSanitizer } from '../security/inputSanitizer.js';
import logger from '../utils/logger.js';

/**
 * Automated Post-Mortem Generator
 * 
 * Generates comprehensive post-mortem reports from incident data:
 * - Timeline reconstruction from git history and logs
 * - Root cause analysis with supporting evidence
 * - Impact assessment and lessons learned
 * - Action item generation and tracking
 * - Template-driven post-mortem creation
 */
export class PostMortemGenerator {
  constructor() {
    this.analyzer = new IncidentAnalyzer();
    this.git = new SecureGitIntegration();
    this.templates = new Map();
    this.actionItems = new Map();
    
    this.loadTemplates();
  }

  /**
   * Generate comprehensive post-mortem report
   */
  async generatePostMortem(incident, options = {}) {
    try {
      logger.info('Generating post-mortem', { incidentId: incident.id });

      const postMortem = {
        incident: this.sanitizeIncidentData(incident),
        metadata: this.generateMetadata(incident),
        executive_summary: await this.generateExecutiveSummary(incident),
        timeline: await this.generateTimeline(incident),
        root_cause_analysis: await this.performRootCauseAnalysis(incident),
        impact_assessment: this.generateImpactAssessment(incident),
        response_analysis: this.analyzeResponseEffectiveness(incident),
        lessons_learned: this.extractLessonsLearned(incident),
        action_items: this.generateActionItems(incident),
        appendix: await this.generateAppendix(incident)
      };

      // Apply template formatting if specified
      if (options.template) {
        return this.applyTemplate(postMortem, options.template);
      }

      logger.info('Post-mortem generated successfully', { 
        incidentId: incident.id,
        actionItems: postMortem.action_items.length
      });

      return postMortem;

    } catch (error) {
      logger.error('Failed to generate post-mortem', { 
        error: error.message, 
        incidentId: incident.id 
      });
      throw error;
    }
  }

  /**
   * Generate executive summary
   */
  async generateExecutiveSummary(incident) {
    const duration = this.calculateIncidentDuration(incident);
    const impact = await this.assessBusinessImpact(incident);
    
    return {
      incident_title: InputSanitizer.sanitizeHTML(incident.title),
      severity: incident.severity,
      duration: {
        total_minutes: duration,
        start_time: incident.createdAt,
        end_time: incident.resolvedAt,
        human_readable: this.formatDuration(duration)
      },
      impact: {
        users_affected: impact.usersAffected || 0,
        services_affected: incident.affectedServices?.length || 0,
        business_impact: impact.businessImpact || 'low',
        revenue_impact: impact.revenueImpact || null
      },
      root_cause_summary: await this.generateRootCauseSummary(incident),
      resolution_summary: this.generateResolutionSummary(incident)
    };
  }

  /**
   * Generate detailed timeline from multiple sources
   */
  async generateTimeline(incident) {
    const events = [];

    // Add incident lifecycle events
    events.push({
      timestamp: incident.createdAt,
      type: 'incident_created',
      description: 'Incident reported',
      source: 'system',
      details: {
        reporter: incident.createdBy,
        initial_severity: incident.initialSeverity || incident.severity
      }
    });

    if (incident.firstResponse) {
      events.push({
        timestamp: incident.firstResponse,
        type: 'first_response',
        description: 'Initial response by team',
        source: 'team',
        details: {
          responder: incident.firstResponder,
          response_time_minutes: this.calculateResponseTime(incident)
        }
      });
    }

    // Add git commit events if available
    if (incident.affectedFiles) {
      try {
        const gitEvents = await this.extractGitTimeline(incident);
        events.push(...gitEvents);
      } catch (error) {
        logger.warn('Could not extract git timeline', { error: error.message });
      }
    }

    // Add escalation events
    if (incident.escalations) {
      incident.escalations.forEach(escalation => {
        events.push({
          timestamp: escalation.timestamp,
          type: 'escalation',
          description: `Escalated to ${escalation.to}`,
          source: 'team',
          details: {
            from: escalation.from,
            to: escalation.to,
            reason: escalation.reason
          }
        });
      });
    }

    // Add status change events
    if (incident.statusChanges) {
      incident.statusChanges.forEach(change => {
        events.push({
          timestamp: change.timestamp,
          type: 'status_change',
          description: `Status changed to ${change.status}`,
          source: 'team',
          details: {
            previous_status: change.previousStatus,
            new_status: change.status,
            changed_by: change.changedBy
          }
        });
      });
    }

    // Add resolution event
    if (incident.resolvedAt) {
      events.push({
        timestamp: incident.resolvedAt,
        type: 'incident_resolved',
        description: 'Incident marked as resolved',
        source: 'team',
        details: {
          resolved_by: incident.resolvedBy,
          resolution_method: incident.resolutionMethod
        }
      });
    }

    // Sort events chronologically
    events.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    return {
      events: events.map(event => ({
        ...event,
        description: InputSanitizer.sanitizeHTML(event.description),
        formatted_time: this.formatTimestamp(event.timestamp)
      })),
      duration_analysis: this.analyzeTimelineDuration(events),
      critical_path: this.identifyCriticalPath(events)
    };
  }

  /**
   * Perform comprehensive root cause analysis
   */
  async performRootCauseAnalysis(incident) {
    const analysis = {
      primary_cause: null,
      contributing_factors: [],
      evidence: [],
      five_whys: [],
      preventability: null
    };

    try {
      // Use incident analyzer for detailed analysis
      if (incident.affectedFiles?.length > 0) {
        const incidentAnalysis = await this.analyzer.analyzeIncident(
          new Date(incident.createdAt),
          24,
          incident.affectedFiles
        );

        analysis.evidence.push({
          type: 'code_analysis',
          description: 'Automated code impact analysis',
          details: incidentAnalysis
        });

        // Extract primary cause from analysis
        if (incidentAnalysis.suspiciousCommits?.length > 0) {
          const primaryCommit = incidentAnalysis.suspiciousCommits[0];
          analysis.primary_cause = {
            category: 'code_change',
            description: `Suspicious commit: ${primaryCommit.message}`,
            commit_hash: primaryCommit.hash,
            author: primaryCommit.author,
            timestamp: primaryCommit.timestamp,
            risk_score: primaryCommit.riskScore
          };
        }
      }

      // Analyze error patterns
      if (incident.errorLogs || incident.description) {
        const errorAnalysis = this.analyzeErrorPatterns(incident.errorLogs || incident.description);
        analysis.contributing_factors.push(...this.extractContributingFactors(errorAnalysis));
      }

      // Generate five whys analysis
      analysis.five_whys = this.generateFiveWhys(incident, analysis.primary_cause);

      // Assess preventability
      analysis.preventability = this.assessPreventability(incident, analysis);

    } catch (error) {
      logger.error('Root cause analysis failed', { error: error.message });
      analysis.primary_cause = {
        category: 'unknown',
        description: 'Root cause analysis could not be completed automatically',
        requires_manual_investigation: true
      };
    }

    return analysis;
  }

  /**
   * Generate impact assessment
   */
  generateImpactAssessment(incident) {
    const assessment = {
      technical_impact: this.assessTechnicalImpact(incident),
      business_impact: this.assessBusinessImpactSync(incident),
      customer_impact: this.assessCustomerImpact(incident),
      operational_impact: this.assessOperationalImpact(incident)
    };

    // Calculate overall impact score
    assessment.overall_impact_score = this.calculateOverallImpactScore(assessment);
    assessment.impact_classification = this.classifyImpact(assessment.overall_impact_score);

    return assessment;
  }

  /**
   * Analyze response effectiveness
   */
  analyzeResponseEffectiveness(incident) {
    const analysis = {
      response_time: this.calculateResponseTime(incident),
      escalation_effectiveness: this.analyzeEscalationEffectiveness(incident),
      communication_analysis: this.analyzeCommunicationEffectiveness(incident),
      resolution_effectiveness: this.analyzeResolutionEffectiveness(incident)
    };

    // Generate response score
    analysis.overall_response_score = this.calculateResponseScore(analysis);
    analysis.response_grade = this.getResponseGrade(analysis.overall_response_score);

    // Identify response improvement areas
    analysis.improvement_areas = this.identifyResponseImprovements(analysis);

    return analysis;
  }

  /**
   * Extract lessons learned
   */
  extractLessonsLearned(incident) {
    const lessons = [];

    // Technical lessons
    if (incident.affectedFiles) {
      lessons.push({
        category: 'technical',
        lesson: 'Code changes require additional testing in affected areas',
        evidence: `${incident.affectedFiles.length} files were impacted`,
        action_required: 'Improve test coverage for critical paths'
      });
    }

    // Process lessons based on response analysis
    const responseTime = this.calculateResponseTime(incident);
    if (responseTime > 30) {
      lessons.push({
        category: 'process',
        lesson: 'Incident response time exceeded targets',
        evidence: `Initial response took ${responseTime} minutes`,
        action_required: 'Review alerting and on-call procedures'
      });
    }

    // Communication lessons
    if (incident.escalations?.length > 1) {
      lessons.push({
        category: 'communication',
        lesson: 'Multiple escalations indicate communication gaps',
        evidence: `${incident.escalations.length} escalations occurred`,
        action_required: 'Clarify escalation criteria and procedures'
      });
    }

    // Monitoring lessons
    if (incident.detectionMethod === 'user_report') {
      lessons.push({
        category: 'monitoring',
        lesson: 'Issue was not detected by monitoring systems',
        evidence: 'Incident was reported by users',
        action_required: 'Improve monitoring coverage'
      });
    }

    return lessons;
  }

  /**
   * Generate actionable items
   */
  generateActionItems(incident) {
    const actionItems = [];
    let itemId = 1;

    // Technical action items
    if (incident.affectedFiles?.length > 0) {
      actionItems.push({
        id: itemId++,
        category: 'technical',
        title: 'Improve test coverage for affected components',
        description: `Add comprehensive tests for files: ${incident.affectedFiles.slice(0, 3).join(', ')}`,
        priority: 'high',
        estimated_effort: '1-2 weeks',
        owner: null,
        due_date: this.calculateDueDate(14), // 2 weeks
        acceptance_criteria: [
          'Unit tests cover all critical paths',
          'Integration tests validate component interactions',
          'Test coverage metrics meet team standards'
        ]
      });
    }

    // Process improvement items
    const responseTime = this.calculateResponseTime(incident);
    if (responseTime > 15) {
      actionItems.push({
        id: itemId++,
        category: 'process',
        title: 'Optimize incident response procedures',
        description: `Current response time (${responseTime}min) exceeds target (15min)`,
        priority: 'medium',
        estimated_effort: '1 week',
        owner: null,
        due_date: this.calculateDueDate(7),
        acceptance_criteria: [
          'Review and update on-call procedures',
          'Implement automated alerting improvements',
          'Conduct response time training'
        ]
      });
    }

    // Monitoring improvements
    if (!incident.automaticallyDetected) {
      actionItems.push({
        id: itemId++,
        category: 'monitoring',
        title: 'Enhance monitoring coverage',
        description: 'Add monitoring to detect similar issues automatically',
        priority: 'high',
        estimated_effort: '1 week',
        owner: null,
        due_date: this.calculateDueDate(7),
        acceptance_criteria: [
          'Implement alerts for similar failure patterns',
          'Add health checks for affected services',
          'Validate alert thresholds and sensitivity'
        ]
      });
    }

    // Documentation updates
    actionItems.push({
      id: itemId++,
      category: 'documentation',
      title: 'Update incident response runbooks',
      description: 'Document new procedures learned from this incident',
      priority: 'low',
      estimated_effort: '2-3 days',
      owner: null,
      due_date: this.calculateDueDate(10),
      acceptance_criteria: [
        'Update relevant runbook sections',
        'Add troubleshooting steps',
        'Review with team for completeness'
      ]
    });

    return actionItems;
  }

  /**
   * Generate appendix with supporting data
   */
  async generateAppendix(incident) {
    const appendix = {
      git_analysis: null,
      error_logs: this.sanitizeErrorLogs(incident.errorLogs),
      metrics: incident.metrics || null,
      related_incidents: await this.findRelatedIncidents(incident),
      team_members_involved: this.extractTeamMembers(incident)
    };

    // Add git analysis if available
    if (incident.affectedFiles) {
      try {
        appendix.git_analysis = await this.generateGitAnalysisReport(incident);
      } catch (error) {
        logger.warn('Could not generate git analysis for appendix', { error: error.message });
      }
    }

    return appendix;
  }

  // Helper methods

  sanitizeIncidentData(incident) {
    return {
      id: incident.id,
      title: InputSanitizer.sanitizeHTML(incident.title),
      description: InputSanitizer.sanitizeHTML(incident.description || ''),
      severity: incident.severity,
      status: incident.status,
      created_at: incident.createdAt,
      resolved_at: incident.resolvedAt,
      assigned_to: incident.assignedTo
    };
  }

  generateMetadata(incident) {
    return {
      report_generated: new Date().toISOString(),
      incident_id: incident.id,
      report_version: '1.0',
      template_used: 'standard',
      generated_by: 'traversion_automated',
      report_type: 'post_mortem'
    };
  }

  calculateIncidentDuration(incident) {
    if (!incident.resolvedAt || !incident.createdAt) return 0;
    return Math.round((new Date(incident.resolvedAt) - new Date(incident.createdAt)) / 60000);
  }

  calculateResponseTime(incident) {
    if (!incident.firstResponse || !incident.createdAt) return 0;
    return Math.round((new Date(incident.firstResponse) - new Date(incident.createdAt)) / 60000);
  }

  formatDuration(minutes) {
    if (minutes < 60) return `${minutes} minutes`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  }

  formatTimestamp(timestamp) {
    return new Date(timestamp).toLocaleString();
  }

  async assessBusinessImpact(incident) {
    // This would typically integrate with business metrics systems
    return {
      usersAffected: incident.usersAffected || 0,
      businessImpact: this.classifyBusinessImpact(incident),
      revenueImpact: this.estimateRevenueImpact(incident)
    };
  }

  assessBusinessImpactSync(incident) {
    const impact = {
      category: 'low',
      description: 'Minimal business impact',
      affected_processes: [],
      financial_impact: 'none'
    };

    // Analyze description for business keywords
    const description = (incident.description || '').toLowerCase();
    const businessKeywords = ['payment', 'billing', 'checkout', 'order', 'customer', 'revenue'];
    
    const matchedKeywords = businessKeywords.filter(keyword => description.includes(keyword));
    
    if (matchedKeywords.length > 0) {
      impact.category = matchedKeywords.some(k => ['payment', 'billing'].includes(k)) ? 'high' : 'medium';
      impact.affected_processes = matchedKeywords;
      impact.financial_impact = impact.category === 'high' ? 'significant' : 'moderate';
    }

    return impact;
  }

  assessTechnicalImpact(incident) {
    return {
      services_affected: incident.affectedServices?.length || 0,
      files_modified: incident.affectedFiles?.length || 0,
      systems_impacted: this.identifyImpactedSystems(incident),
      recovery_complexity: this.assessRecoveryComplexity(incident)
    };
  }

  assessCustomerImpact(incident) {
    return {
      users_affected: incident.usersAffected || 0,
      user_experience_impact: this.classifyUserExperienceImpact(incident),
      support_tickets_generated: incident.supportTickets || 0,
      customer_communications_sent: incident.customerCommunications || 0
    };
  }

  assessOperationalImpact(incident) {
    return {
      team_members_involved: this.extractTeamMembers(incident).length,
      person_hours_spent: this.estimatePersonHours(incident),
      operational_overhead: this.assessOperationalOverhead(incident)
    };
  }

  extractTeamMembers(incident) {
    const members = new Set();
    
    if (incident.assignedTo) members.add(incident.assignedTo);
    if (incident.createdBy) members.add(incident.createdBy);
    if (incident.resolvedBy) members.add(incident.resolvedBy);
    
    if (incident.escalations) {
      incident.escalations.forEach(escalation => {
        if (escalation.from) members.add(escalation.from);
        if (escalation.to) members.add(escalation.to);
      });
    }

    return Array.from(members);
  }

  async generateRootCauseSummary(incident) {
    try {
      const analysis = await this.performRootCauseAnalysis(incident);
      
      if (analysis.primary_cause) {
        return `${analysis.primary_cause.category}: ${analysis.primary_cause.description}`;
      }
      
      return 'Root cause requires further investigation';
    } catch (error) {
      return 'Root cause analysis pending';
    }
  }

  generateResolutionSummary(incident) {
    if (!incident.resolvedAt) {
      return 'Incident resolution in progress';
    }

    const duration = this.calculateIncidentDuration(incident);
    const method = incident.resolutionMethod || 'standard procedures';
    
    return `Resolved in ${this.formatDuration(duration)} using ${method}`;
  }

  async extractGitTimeline(incident) {
    const events = [];
    
    try {
      for (const file of incident.affectedFiles.slice(0, 10)) { // Limit to 10 files
        const history = await this.git.getFileHistory(file, 5);
        
        history.forEach(commit => {
          events.push({
            timestamp: commit.date,
            type: 'git_commit',
            description: `Code change: ${commit.message}`,
            source: 'git',
            details: {
              file: file,
              commit_hash: commit.hash,
              author: commit.author,
              message: commit.message
            }
          });
        });
      }
    } catch (error) {
      logger.warn('Could not extract git timeline', { error: error.message });
    }
    
    return events;
  }

  analyzeErrorPatterns(errorText) {
    const patterns = [];
    
    if (!errorText) return patterns;
    
    const text = errorText.toLowerCase();
    
    // Common error patterns
    const errorPatterns = [
      { pattern: /database.*error|connection.*failed/i, category: 'database' },
      { pattern: /timeout|timed out/i, category: 'performance' },
      { pattern: /out of memory|oom/i, category: 'resource' },
      { pattern: /authentication.*failed/i, category: 'security' },
      { pattern: /404|not found/i, category: 'routing' },
      { pattern: /500|internal server error/i, category: 'application' }
    ];

    errorPatterns.forEach(({ pattern, category }) => {
      if (pattern.test(text)) {
        patterns.push({ category, pattern: pattern.toString() });
      }
    });

    return patterns;
  }

  extractContributingFactors(errorAnalysis) {
    return errorAnalysis.map(error => ({
      factor: error.category,
      description: `Error pattern detected: ${error.category}`,
      evidence: error.pattern
    }));
  }

  generateFiveWhys(incident, primaryCause) {
    const whys = [];
    
    if (primaryCause) {
      whys.push({
        question: 'Why did the incident occur?',
        answer: primaryCause.description,
        evidence: 'Primary cause analysis'
      });
      
      // Generate subsequent whys based on cause type
      if (primaryCause.category === 'code_change') {
        whys.push({
          question: 'Why was the problematic code deployed?',
          answer: 'Testing may not have covered this scenario',
          evidence: 'Code analysis'
        });
        
        whys.push({
          question: 'Why did testing not catch this issue?',
          answer: 'Test coverage may be insufficient',
          evidence: 'Requires investigation'
        });
      }
    }
    
    return whys;
  }

  assessPreventability(incident, analysis) {
    let score = 0.5; // Default preventability score
    
    if (analysis.primary_cause) {
      switch (analysis.primary_cause.category) {
        case 'code_change':
          score = 0.8; // Highly preventable with better testing
          break;
        case 'infrastructure':
          score = 0.6; // Moderately preventable with monitoring
          break;
        case 'external':
          score = 0.2; // Low preventability for external factors
          break;
      }
    }
    
    return {
      score,
      classification: score > 0.7 ? 'highly_preventable' : score > 0.4 ? 'moderately_preventable' : 'difficult_to_prevent',
      recommendations: this.getPreventabilityRecommendations(score, analysis.primary_cause)
    };
  }

  getPreventabilityRecommendations(score, primaryCause) {
    const recommendations = [];
    
    if (score > 0.7) {
      recommendations.push('Implement additional automated testing');
      recommendations.push('Review deployment procedures');
    }
    
    if (primaryCause?.category === 'monitoring') {
      recommendations.push('Enhance monitoring coverage');
      recommendations.push('Improve alert sensitivity');
    }
    
    return recommendations;
  }

  calculateDueDate(daysFromNow) {
    const date = new Date();
    date.setDate(date.getDate() + daysFromNow);
    return date.toISOString().split('T')[0];
  }

  sanitizeErrorLogs(logs) {
    if (!logs) return null;
    
    // Remove potentially sensitive information
    return logs.replace(/password=\S+/gi, 'password=***')
               .replace(/token=\S+/gi, 'token=***')
               .replace(/key=\S+/gi, 'key=***');
  }

  async findRelatedIncidents(incident) {
    // This would query incident database for similar incidents
    // For now, return empty array
    return [];
  }

  loadTemplates() {
    // Load post-mortem templates
    this.templates.set('standard', {
      sections: ['executive_summary', 'timeline', 'root_cause_analysis', 'impact_assessment', 'lessons_learned', 'action_items'],
      format: 'markdown'
    });
  }

  applyTemplate(postMortem, templateName) {
    const template = this.templates.get(templateName);
    if (!template) return postMortem;
    
    // Apply template formatting (implementation depends on template format)
    return postMortem;
  }

  // Placeholder methods for complex calculations
  classifyBusinessImpact(incident) { return 'medium'; }
  estimateRevenueImpact(incident) { return null; }
  identifyImpactedSystems(incident) { return []; }
  assessRecoveryComplexity(incident) { return 'medium'; }
  classifyUserExperienceImpact(incident) { return 'minor'; }
  estimatePersonHours(incident) { return this.calculateIncidentDuration(incident) / 60; }
  assessOperationalOverhead(incident) { return 'low'; }
  calculateOverallImpactScore(assessment) { return 0.5; }
  classifyImpact(score) { return score > 0.7 ? 'high' : score > 0.4 ? 'medium' : 'low'; }
  analyzeEscalationEffectiveness(incident) { return { effective: true, reason: 'Proper escalation procedures followed' }; }
  analyzeCommunicationEffectiveness(incident) { return { effective: true, areas_for_improvement: [] }; }
  analyzeResolutionEffectiveness(incident) { return { effective: true, method_appropriate: true }; }
  calculateResponseScore(analysis) { return 0.8; }
  getResponseGrade(score) { return score > 0.8 ? 'A' : score > 0.6 ? 'B' : 'C'; }
  identifyResponseImprovements(analysis) { return []; }
  analyzeTimelineDuration(events) { return { total_duration: 0, critical_path_duration: 0 }; }
  identifyCriticalPath(events) { return []; }
  
  async generateGitAnalysisReport(incident) {
    try {
      const analysis = await this.analyzer.analyzeIncident(
        new Date(incident.createdAt),
        24,
        incident.affectedFiles
      );
      
      return {
        suspicious_commits: analysis.suspiciousCommits,
        risk_score: analysis.riskScore,
        affected_files: analysis.affectedFiles
      };
    } catch (error) {
      return null;
    }
  }
}

export default PostMortemGenerator;