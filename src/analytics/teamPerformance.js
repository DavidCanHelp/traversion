import logger from '../utils/logger.js';
import { InputSanitizer } from '../security/inputSanitizer.js';

/**
 * Team Performance Analytics
 * 
 * Tracks and analyzes team incident response performance:
 * - MTTR (Mean Time To Resolution) tracking
 * - Individual and team performance metrics
 * - Trend analysis and improvement suggestions
 * - Workload distribution analysis
 * - Skills gap identification
 */
export class TeamPerformanceAnalytics {
  constructor(options = {}) {
    this.incidents = new Map();
    this.teamMembers = new Map();
    this.performanceHistory = new Map();
    this.benchmarks = {
      mttr: {
        critical: 15,   // 15 minutes target
        high: 60,       // 1 hour target
        medium: 240,    // 4 hours target
        low: 1440       // 24 hours target
      },
      responseTime: {
        critical: 5,    // 5 minutes to first response
        high: 15,       // 15 minutes
        medium: 60,     // 1 hour
        low: 240        // 4 hours
      }
    };
    
    this.skillCategories = [
      'database',
      'frontend',
      'backend',
      'infrastructure',
      'security',
      'deployment',
      'monitoring'
    ];
  }

  /**
   * Generate comprehensive team performance report
   */
  generateTeamReport(tenantId, timeframe = '30d') {
    try {
      const incidents = this.getIncidentsInTimeframe(tenantId, timeframe);
      
      const report = {
        timeframe,
        generatedAt: new Date().toISOString(),
        teamMetrics: this.calculateTeamMetrics(incidents),
        individualMetrics: this.calculateIndividualMetrics(incidents),
        trends: this.analyzeTrends(incidents, timeframe),
        benchmarks: this.compareToBenchmarks(incidents),
        recommendations: this.generateRecommendations(incidents),
        workloadAnalysis: this.analyzeWorkloadDistribution(incidents),
        skillsAnalysis: this.analyzeSkillsGaps(incidents)
      };

      logger.info('Team performance report generated', {
        tenantId,
        timeframe,
        incidentCount: incidents.length,
        teamSize: report.individualMetrics.length
      });

      return report;

    } catch (error) {
      logger.error('Failed to generate team report', { error: error.message, tenantId });
      throw error;
    }
  }

  /**
   * Calculate team-wide performance metrics
   */
  calculateTeamMetrics(incidents) {
    if (incidents.length === 0) {
      return this.getEmptyTeamMetrics();
    }

    const resolved = incidents.filter(i => i.status === 'resolved' && i.resolvedAt);
    const active = incidents.filter(i => i.status === 'active');

    // Calculate MTTR by severity
    const mttrBySeverity = {};
    ['critical', 'high', 'medium', 'low'].forEach(severity => {
      const severityIncidents = resolved.filter(i => i.severity === severity);
      mttrBySeverity[severity] = this.calculateAverageMTTR(severityIncidents);
    });

    // Calculate response times
    const responseTimeMetrics = this.calculateResponseTimeMetrics(incidents);

    // Calculate resolution rates
    const resolutionRates = this.calculateResolutionRates(incidents);

    // Calculate escalation metrics
    const escalationMetrics = this.calculateEscalationMetrics(incidents);

    return {
      totalIncidents: incidents.length,
      resolvedIncidents: resolved.length,
      activeIncidents: active.length,
      resolutionRate: resolved.length / incidents.length,
      
      mttr: {
        overall: this.calculateAverageMTTR(resolved),
        bySeverity: mttrBySeverity
      },
      
      responseTime: responseTimeMetrics,
      resolutionRates,
      escalationMetrics,
      
      efficiency: {
        firstTimeResolution: this.calculateFirstTimeResolution(resolved),
        preventedEscalations: escalationMetrics.preventedCount,
        avgIncidentsPerDay: incidents.length / 30 // Assuming 30-day window
      }
    };
  }

  /**
   * Calculate individual team member metrics
   */
  calculateIndividualMetrics(incidents) {
    const memberMetrics = new Map();

    incidents.forEach(incident => {
      // Track assigned person
      if (incident.assignedTo) {
        if (!memberMetrics.has(incident.assignedTo)) {
          memberMetrics.set(incident.assignedTo, {
            userId: incident.assignedTo,
            incidentsHandled: 0,
            incidentsResolved: 0,
            mttr: [],
            responseTime: [],
            severityBreakdown: { critical: 0, high: 0, medium: 0, low: 0 },
            escalations: 0,
            handoffs: 0
          });
        }

        const metrics = memberMetrics.get(incident.assignedTo);
        metrics.incidentsHandled++;
        
        if (incident.severity) {
          metrics.severityBreakdown[incident.severity]++;
        }

        if (incident.status === 'resolved' && incident.resolvedAt) {
          metrics.incidentsResolved++;
          const mttr = this.calculateIncidentMTTR(incident);
          if (mttr > 0) metrics.mttr.push(mttr);
        }

        // Track response time (time from creation to first action)
        if (incident.firstResponse) {
          const responseTime = new Date(incident.firstResponse) - new Date(incident.createdAt);
          metrics.responseTime.push(responseTime / 60000); // Convert to minutes
        }

        // Track escalations and handoffs
        if (incident.escalated) metrics.escalations++;
        if (incident.reassignedCount > 0) metrics.handoffs += incident.reassignedCount;
      }
    });

    // Calculate averages and performance scores
    return Array.from(memberMetrics.values()).map(metrics => {
      const avgMTTR = metrics.mttr.length > 0 
        ? metrics.mttr.reduce((sum, time) => sum + time, 0) / metrics.mttr.length
        : 0;

      const avgResponseTime = metrics.responseTime.length > 0
        ? metrics.responseTime.reduce((sum, time) => sum + time, 0) / metrics.responseTime.length
        : 0;

      const resolutionRate = metrics.incidentsHandled > 0 
        ? metrics.incidentsResolved / metrics.incidentsHandled
        : 0;

      const performanceScore = this.calculatePerformanceScore({
        mttr: avgMTTR,
        responseTime: avgResponseTime,
        resolutionRate,
        escalationRate: metrics.escalations / metrics.incidentsHandled
      });

      return {
        ...metrics,
        avgMTTR: Math.round(avgMTTR),
        avgResponseTime: Math.round(avgResponseTime),
        resolutionRate: Math.round(resolutionRate * 100),
        performanceScore: Math.round(performanceScore * 100),
        workloadLevel: this.assessWorkloadLevel(metrics)
      };
    }).sort((a, b) => b.performanceScore - a.performanceScore);
  }

  /**
   * Analyze performance trends over time
   */
  analyzeTrends(incidents, timeframe) {
    const timeframeDays = this.parseTimeframeDays(timeframe);
    const dailyMetrics = this.groupIncidentsByDay(incidents, timeframeDays);

    const trends = {
      incidentVolume: this.calculateTrend(dailyMetrics.map(d => d.count)),
      mttr: this.calculateTrend(dailyMetrics.map(d => d.avgMTTR).filter(x => x > 0)),
      responseTime: this.calculateTrend(dailyMetrics.map(d => d.avgResponseTime).filter(x => x > 0)),
      resolutionRate: this.calculateTrend(dailyMetrics.map(d => d.resolutionRate))
    };

    // Weekly patterns analysis
    const weeklyPatterns = this.analyzeWeeklyPatterns(incidents);
    
    // Monthly patterns
    const monthlyPatterns = timeframeDays >= 60 ? this.analyzeMonthlyPatterns(incidents) : null;

    return {
      trends,
      weeklyPatterns,
      monthlyPatterns,
      insights: this.generateTrendInsights(trends, weeklyPatterns)
    };
  }

  /**
   * Compare performance to industry benchmarks
   */
  compareToBenchmarks(incidents) {
    const resolved = incidents.filter(i => i.status === 'resolved' && i.resolvedAt);
    const comparison = {};

    ['critical', 'high', 'medium', 'low'].forEach(severity => {
      const severityIncidents = resolved.filter(i => i.severity === severity);
      const actualMTTR = this.calculateAverageMTTR(severityIncidents);
      const benchmark = this.benchmarks.mttr[severity];

      comparison[severity] = {
        actual: Math.round(actualMTTR),
        benchmark: benchmark,
        performance: actualMTTR <= benchmark ? 'meeting' : 'below',
        gap: actualMTTR > benchmark ? Math.round(actualMTTR - benchmark) : 0
      };
    });

    // Overall benchmark score
    const overallScore = Object.values(comparison).reduce((score, sev) => {
      return score + (sev.performance === 'meeting' ? 25 : 0);
    }, 0);

    return {
      mttr: comparison,
      overallScore,
      grade: this.getPerformanceGrade(overallScore)
    };
  }

  /**
   * Generate actionable recommendations
   */
  generateRecommendations(incidents) {
    const recommendations = [];
    const teamMetrics = this.calculateTeamMetrics(incidents);
    const individualMetrics = this.calculateIndividualMetrics(incidents);

    // MTTR recommendations
    if (teamMetrics.mttr.overall > 120) { // Over 2 hours average
      recommendations.push({
        type: 'process',
        priority: 'high',
        title: 'Improve Incident Response Time',
        description: 'Average MTTR is above recommended levels',
        actions: [
          'Implement incident response playbooks',
          'Provide escalation training',
          'Review on-call procedures'
        ]
      });
    }

    // Workload distribution recommendations
    const workloadVariance = this.calculateWorkloadVariance(individualMetrics);
    if (workloadVariance > 0.3) {
      recommendations.push({
        type: 'workload',
        priority: 'medium',
        title: 'Balance Team Workload',
        description: 'Uneven incident distribution across team members',
        actions: [
          'Review incident assignment process',
          'Consider workload rotation',
          'Identify overburdened team members'
        ]
      });
    }

    // Skills gap recommendations
    const skillsGaps = this.identifySkillsGaps(incidents);
    if (skillsGaps.length > 0) {
      recommendations.push({
        type: 'training',
        priority: 'medium',
        title: 'Address Skills Gaps',
        description: `Skills gaps identified in: ${skillsGaps.join(', ')}`,
        actions: [
          'Provide targeted training',
          'Cross-training opportunities',
          'Knowledge sharing sessions'
        ]
      });
    }

    // Response time recommendations
    if (teamMetrics.responseTime.average > 30) { // Over 30 minutes average
      recommendations.push({
        type: 'alerting',
        priority: 'high',
        title: 'Improve Response Time',
        description: 'Initial response time is too slow',
        actions: [
          'Review alerting mechanisms',
          'Improve on-call coverage',
          'Streamline initial triage process'
        ]
      });
    }

    return recommendations;
  }

  /**
   * Analyze workload distribution across team
   */
  analyzeWorkloadDistribution(incidents) {
    const assignedIncidents = incidents.filter(i => i.assignedTo);
    const distribution = {};

    assignedIncidents.forEach(incident => {
      if (!distribution[incident.assignedTo]) {
        distribution[incident.assignedTo] = {
          userId: incident.assignedTo,
          count: 0,
          severityBreakdown: { critical: 0, high: 0, medium: 0, low: 0 },
          avgResolutionTime: []
        };
      }

      distribution[incident.assignedTo].count++;
      if (incident.severity) {
        distribution[incident.assignedTo].severityBreakdown[incident.severity]++;
      }

      if (incident.status === 'resolved' && incident.resolvedAt) {
        const resolutionTime = this.calculateIncidentMTTR(incident);
        distribution[incident.assignedTo].avgResolutionTime.push(resolutionTime);
      }
    });

    // Calculate workload metrics
    const workloads = Object.values(distribution).map(user => {
      const avgResTime = user.avgResolutionTime.length > 0
        ? user.avgResolutionTime.reduce((sum, time) => sum + time, 0) / user.avgResolutionTime.length
        : 0;

      return {
        ...user,
        percentage: (user.count / assignedIncidents.length) * 100,
        avgResolutionTime: Math.round(avgResTime),
        workloadScore: this.calculateWorkloadScore(user)
      };
    });

    // Calculate distribution statistics
    const counts = workloads.map(w => w.count);
    const mean = counts.reduce((sum, c) => sum + c, 0) / counts.length;
    const variance = counts.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / counts.length;
    const stdDev = Math.sqrt(variance);

    return {
      distribution: workloads.sort((a, b) => b.count - a.count),
      statistics: {
        mean: Math.round(mean),
        standardDeviation: Math.round(stdDev),
        coefficientOfVariation: mean > 0 ? stdDev / mean : 0,
        balance: stdDev / mean < 0.3 ? 'balanced' : 'unbalanced'
      }
    };
  }

  /**
   * Analyze skills gaps based on incident patterns
   */
  analyzeSkillsGaps(incidents) {
    const skillsRequired = new Map();
    const skillsAvailable = new Map();

    incidents.forEach(incident => {
      // Extract required skills from incident data
      const requiredSkills = this.extractRequiredSkills(incident);
      
      requiredSkills.forEach(skill => {
        skillsRequired.set(skill, (skillsRequired.get(skill) || 0) + 1);
      });

      // Track available skills from resolution patterns
      if (incident.status === 'resolved' && incident.assignedTo) {
        const resolvedSkills = this.extractResolvedSkills(incident);
        resolvedSkills.forEach(skill => {
          if (!skillsAvailable.has(incident.assignedTo)) {
            skillsAvailable.set(incident.assignedTo, new Set());
          }
          skillsAvailable.get(incident.assignedTo).add(skill);
        });
      }
    });

    // Identify gaps
    const gaps = [];
    skillsRequired.forEach((demand, skill) => {
      const supply = Array.from(skillsAvailable.values())
        .filter(skillSet => skillSet.has(skill)).length;
      
      const ratio = supply > 0 ? demand / supply : demand;
      
      if (ratio > 2) { // High demand to supply ratio
        gaps.push({
          skill,
          demand,
          supply,
          gap: ratio,
          severity: ratio > 5 ? 'high' : 'medium'
        });
      }
    });

    return {
      gaps: gaps.sort((a, b) => b.gap - a.gap),
      recommendations: this.generateSkillsRecommendations(gaps)
    };
  }

  // Helper methods

  getIncidentsInTimeframe(tenantId, timeframe) {
    const days = this.parseTimeframeDays(timeframe);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    return Array.from(this.incidents.values())
      .filter(incident => 
        incident.tenantId === tenantId &&
        new Date(incident.createdAt) >= cutoff
      );
  }

  parseTimeframeDays(timeframe) {
    const match = timeframe.match(/(\d+)([dwmy])/);
    if (!match) return 30;

    const [, number, unit] = match;
    const multipliers = { d: 1, w: 7, m: 30, y: 365 };
    return parseInt(number) * (multipliers[unit] || 1);
  }

  calculateAverageMTTR(incidents) {
    const resolved = incidents.filter(i => i.resolvedAt && i.createdAt);
    if (resolved.length === 0) return 0;

    const totalTime = resolved.reduce((sum, incident) => {
      return sum + (new Date(incident.resolvedAt) - new Date(incident.createdAt));
    }, 0);

    return totalTime / resolved.length / 60000; // Convert to minutes
  }

  calculateIncidentMTTR(incident) {
    if (!incident.resolvedAt || !incident.createdAt) return 0;
    return (new Date(incident.resolvedAt) - new Date(incident.createdAt)) / 60000;
  }

  calculateResponseTimeMetrics(incidents) {
    const responseTimes = incidents
      .filter(i => i.firstResponse && i.createdAt)
      .map(i => (new Date(i.firstResponse) - new Date(i.createdAt)) / 60000);

    if (responseTimes.length === 0) {
      return { average: 0, median: 0, p95: 0 };
    }

    responseTimes.sort((a, b) => a - b);
    
    return {
      average: Math.round(responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length),
      median: Math.round(responseTimes[Math.floor(responseTimes.length / 2)]),
      p95: Math.round(responseTimes[Math.floor(responseTimes.length * 0.95)])
    };
  }

  calculateResolutionRates(incidents) {
    const total = incidents.length;
    const resolved = incidents.filter(i => i.status === 'resolved').length;
    const escalated = incidents.filter(i => i.escalated).length;
    const reassigned = incidents.filter(i => i.reassignedCount > 0).length;

    return {
      resolved: total > 0 ? Math.round((resolved / total) * 100) : 0,
      escalated: total > 0 ? Math.round((escalated / total) * 100) : 0,
      reassigned: total > 0 ? Math.round((reassigned / total) * 100) : 0,
      firstTimeResolution: this.calculateFirstTimeResolution(incidents.filter(i => i.status === 'resolved'))
    };
  }

  calculateFirstTimeResolution(resolvedIncidents) {
    const firstTime = resolvedIncidents.filter(i => 
      !i.escalated && (i.reassignedCount || 0) === 0
    ).length;
    
    return resolvedIncidents.length > 0 
      ? Math.round((firstTime / resolvedIncidents.length) * 100)
      : 0;
  }

  calculateEscalationMetrics(incidents) {
    const escalated = incidents.filter(i => i.escalated);
    const prevented = incidents.filter(i => i.escalationPrevented);
    
    return {
      total: escalated.length,
      rate: incidents.length > 0 ? Math.round((escalated.length / incidents.length) * 100) : 0,
      preventedCount: prevented.length,
      avgTimeToEscalation: this.calculateAverageEscalationTime(escalated)
    };
  }

  calculateAverageEscalationTime(escalatedIncidents) {
    const times = escalatedIncidents
      .filter(i => i.escalatedAt && i.createdAt)
      .map(i => (new Date(i.escalatedAt) - new Date(i.createdAt)) / 60000);

    return times.length > 0 
      ? Math.round(times.reduce((sum, time) => sum + time, 0) / times.length)
      : 0;
  }

  calculatePerformanceScore(metrics) {
    let score = 0.5; // Base score

    // MTTR factor (lower is better)
    if (metrics.mttr <= 60) score += 0.2;
    else if (metrics.mttr <= 120) score += 0.1;
    else if (metrics.mttr > 240) score -= 0.2;

    // Response time factor (lower is better)
    if (metrics.responseTime <= 15) score += 0.15;
    else if (metrics.responseTime <= 30) score += 0.1;
    else if (metrics.responseTime > 60) score -= 0.1;

    // Resolution rate factor (higher is better)
    score += (metrics.resolutionRate - 0.8) * 0.25;

    // Escalation rate factor (lower is better)
    if (metrics.escalationRate <= 0.1) score += 0.1;
    else if (metrics.escalationRate > 0.2) score -= 0.1;

    return Math.max(0, Math.min(1, score));
  }

  assessWorkloadLevel(metrics) {
    const incidentThresholds = { low: 5, medium: 15, high: 25 };
    
    if (metrics.incidentsHandled >= incidentThresholds.high) return 'high';
    if (metrics.incidentsHandled >= incidentThresholds.medium) return 'medium';
    return 'low';
  }

  calculateTrend(values) {
    if (values.length < 2) return { direction: 'stable', change: 0 };

    const recentAvg = values.slice(-7).reduce((sum, val) => sum + val, 0) / values.slice(-7).length;
    const previousAvg = values.slice(0, -7).reduce((sum, val) => sum + val, 0) / values.slice(0, -7).length;

    const change = previousAvg > 0 ? ((recentAvg - previousAvg) / previousAvg) * 100 : 0;

    let direction = 'stable';
    if (Math.abs(change) > 5) {
      direction = change > 0 ? 'increasing' : 'decreasing';
    }

    return { direction, change: Math.round(change) };
  }

  groupIncidentsByDay(incidents, days) {
    const dailyData = [];
    
    for (let i = 0; i < days; i++) {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

      const dayIncidents = incidents.filter(incident => {
        const incidentDate = new Date(incident.createdAt);
        return incidentDate >= dayStart && incidentDate < dayEnd;
      });

      const resolved = dayIncidents.filter(i => i.status === 'resolved');
      
      dailyData.unshift({
        date: dayStart.toISOString().split('T')[0],
        count: dayIncidents.length,
        resolved: resolved.length,
        resolutionRate: dayIncidents.length > 0 ? resolved.length / dayIncidents.length : 0,
        avgMTTR: this.calculateAverageMTTR(resolved),
        avgResponseTime: this.calculateResponseTimeMetrics(dayIncidents).average
      });
    }

    return dailyData;
  }

  analyzeWeeklyPatterns(incidents) {
    const dayOfWeek = [0, 1, 2, 3, 4, 5, 6]; // Sunday to Saturday
    const patterns = {};

    dayOfWeek.forEach(day => {
      const dayIncidents = incidents.filter(incident => 
        new Date(incident.createdAt).getDay() === day
      );
      
      patterns[this.getDayName(day)] = {
        count: dayIncidents.length,
        percentage: incidents.length > 0 ? (dayIncidents.length / incidents.length) * 100 : 0,
        avgMTTR: this.calculateAverageMTTR(dayIncidents.filter(i => i.status === 'resolved'))
      };
    });

    return patterns;
  }

  getDayName(dayIndex) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[dayIndex];
  }

  getEmptyTeamMetrics() {
    return {
      totalIncidents: 0,
      resolvedIncidents: 0,
      activeIncidents: 0,
      resolutionRate: 0,
      mttr: { overall: 0, bySeverity: {} },
      responseTime: { average: 0, median: 0, p95: 0 },
      resolutionRates: { resolved: 0, escalated: 0, reassigned: 0 },
      escalationMetrics: { total: 0, rate: 0, preventedCount: 0 },
      efficiency: { firstTimeResolution: 0, preventedEscalations: 0, avgIncidentsPerDay: 0 }
    };
  }

  extractRequiredSkills(incident) {
    const skills = new Set();
    
    // Extract from affected files
    if (incident.affectedFiles) {
      incident.affectedFiles.forEach(file => {
        if (file.includes('database') || file.includes('.sql')) skills.add('database');
        if (file.includes('frontend') || file.includes('.tsx') || file.includes('.jsx')) skills.add('frontend');
        if (file.includes('backend') || file.includes('api')) skills.add('backend');
        if (file.includes('docker') || file.includes('k8s')) skills.add('infrastructure');
        if (file.includes('auth') || file.includes('security')) skills.add('security');
      });
    }

    // Extract from description
    if (incident.description) {
      const desc = incident.description.toLowerCase();
      this.skillCategories.forEach(skill => {
        if (desc.includes(skill)) skills.add(skill);
      });
    }

    return Array.from(skills);
  }

  extractResolvedSkills(incident) {
    // Similar to extractRequiredSkills but for skills demonstrated in resolution
    return this.extractRequiredSkills(incident);
  }

  generateSkillsRecommendations(gaps) {
    return gaps.slice(0, 3).map(gap => ({
      skill: gap.skill,
      priority: gap.severity,
      action: `Increase ${gap.skill} expertise through training or hiring`,
      impact: `Reduce ${gap.skill}-related incident resolution time`
    }));
  }

  getPerformanceGrade(score) {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }

  calculateWorkloadScore(user) {
    const criticalWeight = user.severityBreakdown.critical * 3;
    const highWeight = user.severityBreakdown.high * 2;
    const mediumWeight = user.severityBreakdown.medium * 1.5;
    const lowWeight = user.severityBreakdown.low * 1;
    
    return criticalWeight + highWeight + mediumWeight + lowWeight;
  }

  calculateWorkloadVariance(individualMetrics) {
    const counts = individualMetrics.map(m => m.incidentsHandled);
    if (counts.length === 0) return 0;
    
    const mean = counts.reduce((sum, count) => sum + count, 0) / counts.length;
    const variance = counts.reduce((sum, count) => sum + Math.pow(count - mean, 2), 0) / counts.length;
    
    return mean > 0 ? Math.sqrt(variance) / mean : 0;
  }

  generateTrendInsights(trends, weeklyPatterns) {
    const insights = [];

    // Volume insights
    if (trends.incidentVolume.direction === 'increasing' && trends.incidentVolume.change > 20) {
      insights.push('Incident volume is increasing significantly - consider proactive measures');
    }

    // MTTR insights
    if (trends.mttr.direction === 'increasing') {
      insights.push('Resolution times are getting longer - review processes and training');
    }

    // Weekly patterns insights
    const weekendPattern = weeklyPatterns.Saturday.percentage + weeklyPatterns.Sunday.percentage;
    if (weekendPattern > 30) {
      insights.push('High weekend incident rate - consider infrastructure stability improvements');
    }

    return insights;
  }

  /**
   * Add incident data for analysis
   */
  addIncident(incident) {
    this.incidents.set(incident.id, incident);
  }

  /**
   * Update existing incident
   */
  updateIncident(incidentId, updates) {
    const incident = this.incidents.get(incidentId);
    if (incident) {
      Object.assign(incident, updates);
    }
  }
}

export default TeamPerformanceAnalytics;