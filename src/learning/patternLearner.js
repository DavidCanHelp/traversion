import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';

export class PatternLearner {
  constructor(options = {}) {
    this.dataPath = options.dataPath || '.traversion/patterns.json';
    this.patterns = this.loadPatterns();
    this.confidence = {
      minSamples: 3, // Need at least 3 incidents to establish pattern
      decayFactor: 0.95, // Pattern confidence decays over time
      learningRate: 0.1 // How fast we adapt to new data
    };
  }

  loadPatterns() {
    try {
      if (existsSync(this.dataPath)) {
        return JSON.parse(readFileSync(this.dataPath, 'utf8'));
      }
    } catch (error) {
      console.warn('Failed to load patterns:', error.message);
    }
    
    return {
      incidents: [], // Historical incident data
      commitPatterns: {}, // Patterns in risky commits
      filePatterns: {}, // File-based risk patterns
      timePatterns: {}, // Time-based incident patterns
      authorPatterns: {}, // Author-specific patterns
      deploymentPatterns: {}, // Deployment-related patterns
      version: '1.0.0',
      lastUpdated: new Date().toISOString()
    };
  }

  savePatterns() {
    try {
      this.patterns.lastUpdated = new Date().toISOString();
      writeFileSync(this.dataPath, JSON.stringify(this.patterns, null, 2));
    } catch (error) {
      console.error('Failed to save patterns:', error.message);
    }
  }

  // Learn from a completed incident analysis
  async learnFromIncident(incident) {
    console.log(`🧠 Learning from incident: ${incident.id || 'unknown'}`);

    const incidentData = {
      id: incident.id || Date.now().toString(),
      timestamp: new Date().toISOString(),
      duration: incident.duration || null,
      severity: incident.severity || 'unknown',
      rootCause: incident.rootCause || null,
      affectedFiles: incident.affectedFiles || [],
      suspiciousCommits: incident.suspiciousCommits || [],
      resolutionTime: incident.resolutionTime || null,
      tags: incident.tags || []
    };

    // Add to historical data
    this.patterns.incidents.push(incidentData);
    
    // Keep only last 100 incidents
    if (this.patterns.incidents.length > 100) {
      this.patterns.incidents = this.patterns.incidents.slice(-100);
    }

    // Learn patterns
    await this.extractCommitPatterns(incidentData);
    await this.extractFilePatterns(incidentData);
    await this.extractTimePatterns(incidentData);
    await this.extractAuthorPatterns(incidentData);
    await this.extractDeploymentPatterns(incidentData);

    this.savePatterns();
  }

  async extractCommitPatterns(incident) {
    if (!incident.suspiciousCommits || incident.suspiciousCommits.length === 0) return;

    for (const commit of incident.suspiciousCommits) {
      // Learn from commit message patterns
      const messagePattern = this.extractMessagePattern(commit.message);
      if (messagePattern) {
        this.updatePattern('commitPatterns', messagePattern, {
          incidentCount: 1,
          totalRiskScore: commit.riskScore || 0,
          commonFactors: commit.riskFactors || [],
          lastSeen: new Date().toISOString()
        });
      }

      // Learn from risk factors
      if (commit.riskFactors) {
        for (const factor of commit.riskFactors) {
          this.updatePattern('commitPatterns', `factor:${factor}`, {
            incidentCount: 1,
            avgRiskScore: commit.riskScore || 0,
            lastSeen: new Date().toISOString()
          });
        }
      }

      // Learn from file change patterns
      if (commit.filesChanged) {
        for (const file of commit.filesChanged) {
          const fileType = this.getFileType(file.file);
          const changeSize = this.categorizeChangeSize(file.changes || 0);
          
          this.updatePattern('commitPatterns', `fileChange:${fileType}:${changeSize}`, {
            incidentCount: 1,
            avgRiskScore: commit.riskScore || 0,
            lastSeen: new Date().toISOString()
          });
        }
      }
    }
  }

  async extractFilePatterns(incident) {
    if (!incident.affectedFiles || incident.affectedFiles.length === 0) return;

    for (const filePath of incident.affectedFiles) {
      const fileType = this.getFileType(filePath);
      const directory = path.dirname(filePath);
      
      // Learn file-specific patterns
      this.updatePattern('filePatterns', filePath, {
        incidentCount: 1,
        severity: incident.severity,
        lastIncident: new Date().toISOString()
      });

      // Learn file type patterns
      this.updatePattern('filePatterns', `type:${fileType}`, {
        incidentCount: 1,
        avgSeverity: this.severityToNumber(incident.severity),
        lastSeen: new Date().toISOString()
      });

      // Learn directory patterns
      this.updatePattern('filePatterns', `dir:${directory}`, {
        incidentCount: 1,
        avgSeverity: this.severityToNumber(incident.severity),
        lastSeen: new Date().toISOString()
      });
    }
  }

  async extractTimePatterns(incident) {
    const timestamp = new Date(incident.timestamp);
    const hour = timestamp.getHours();
    const dayOfWeek = timestamp.getDay();
    const month = timestamp.getMonth();

    // Learn time-of-day patterns
    this.updatePattern('timePatterns', `hour:${hour}`, {
      incidentCount: 1,
      avgSeverity: this.severityToNumber(incident.severity),
      lastSeen: new Date().toISOString()
    });

    // Learn day-of-week patterns
    this.updatePattern('timePatterns', `dayOfWeek:${dayOfWeek}`, {
      incidentCount: 1,
      avgSeverity: this.severityToNumber(incident.severity),
      lastSeen: new Date().toISOString()
    });

    // Learn seasonal patterns
    this.updatePattern('timePatterns', `month:${month}`, {
      incidentCount: 1,
      avgSeverity: this.severityToNumber(incident.severity),
      lastSeen: new Date().toISOString()
    });

    // Learn weekend vs weekday patterns
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    this.updatePattern('timePatterns', `weekend:${isWeekend}`, {
      incidentCount: 1,
      avgSeverity: this.severityToNumber(incident.severity),
      lastSeen: new Date().toISOString()
    });
  }

  async extractAuthorPatterns(incident) {
    if (!incident.suspiciousCommits) return;

    const authorStats = {};
    
    for (const commit of incident.suspiciousCommits) {
      if (commit.author) {
        if (!authorStats[commit.author]) {
          authorStats[commit.author] = {
            commitCount: 0,
            totalRiskScore: 0,
            riskFactors: new Set()
          };
        }
        
        authorStats[commit.author].commitCount++;
        authorStats[commit.author].totalRiskScore += commit.riskScore || 0;
        
        if (commit.riskFactors) {
          commit.riskFactors.forEach(factor => 
            authorStats[commit.author].riskFactors.add(factor)
          );
        }
      }
    }

    // Update author patterns
    for (const [author, stats] of Object.entries(authorStats)) {
      this.updatePattern('authorPatterns', author, {
        incidentCount: 1,
        avgCommitsPerIncident: stats.commitCount,
        avgRiskScore: stats.totalRiskScore / stats.commitCount,
        commonRiskFactors: Array.from(stats.riskFactors),
        lastIncident: new Date().toISOString()
      });
    }
  }

  async extractDeploymentPatterns(incident) {
    // Learn from deployment-related patterns
    const deploymentTags = incident.tags?.filter(tag => 
      tag.includes('deploy') || tag.includes('release') || tag.includes('hotfix')
    ) || [];

    for (const tag of deploymentTags) {
      this.updatePattern('deploymentPatterns', tag, {
        incidentCount: 1,
        avgSeverity: this.severityToNumber(incident.severity),
        lastSeen: new Date().toISOString()
      });
    }

    // Learn from resolution time patterns
    if (incident.resolutionTime) {
      const resolutionCategory = this.categorizeResolutionTime(incident.resolutionTime);
      this.updatePattern('deploymentPatterns', `resolution:${resolutionCategory}`, {
        incidentCount: 1,
        avgResolutionTime: incident.resolutionTime,
        lastSeen: new Date().toISOString()
      });
    }
  }

  updatePattern(category, key, newData) {
    if (!this.patterns[category]) {
      this.patterns[category] = {};
    }

    if (!this.patterns[category][key]) {
      this.patterns[category][key] = {
        ...newData,
        confidence: 0.1 // Start with low confidence
      };
    } else {
      const existing = this.patterns[category][key];
      const sampleCount = existing.incidentCount || 1;
      
      // Update with moving average
      if (newData.avgRiskScore !== undefined && existing.avgRiskScore !== undefined) {
        existing.avgRiskScore = this.movingAverage(
          existing.avgRiskScore, 
          newData.avgRiskScore, 
          sampleCount
        );
      }

      if (newData.avgSeverity !== undefined && existing.avgSeverity !== undefined) {
        existing.avgSeverity = this.movingAverage(
          existing.avgSeverity, 
          newData.avgSeverity, 
          sampleCount
        );
      }

      if (newData.avgResolutionTime !== undefined && existing.avgResolutionTime !== undefined) {
        existing.avgResolutionTime = this.movingAverage(
          existing.avgResolutionTime, 
          newData.avgResolutionTime, 
          sampleCount
        );
      }

      // Update counters
      existing.incidentCount = (existing.incidentCount || 0) + (newData.incidentCount || 1);
      existing.lastSeen = newData.lastSeen || new Date().toISOString();

      // Merge arrays
      if (newData.commonRiskFactors && existing.commonRiskFactors) {
        existing.commonRiskFactors = [...new Set([
          ...existing.commonRiskFactors, 
          ...newData.commonRiskFactors
        ])];
      }

      // Update confidence based on sample count
      existing.confidence = Math.min(1.0, existing.incidentCount / 10);
    }
  }

  // Apply learned patterns to enhance risk scoring
  enhanceRiskAssessment(analysis) {
    console.log('🧠 Applying learned patterns to risk assessment');

    if (analysis.suspiciousCommits) {
      for (const commit of analysis.suspiciousCommits) {
        commit.originalRiskScore = commit.riskScore;
        commit.riskScore = this.adjustCommitRiskScore(commit);
        commit.patternBoosts = this.explainRiskAdjustment(commit);
      }

      // Re-sort by adjusted risk score
      analysis.suspiciousCommits.sort((a, b) => b.riskScore - a.riskScore);
    }

    // Add pattern-based insights
    analysis.patternInsights = this.generatePatternInsights(analysis);

    return analysis;
  }

  adjustCommitRiskScore(commit) {
    let adjustedScore = commit.originalRiskScore || commit.riskScore;
    let boosts = [];

    // Apply commit pattern adjustments
    const messagePattern = this.extractMessagePattern(commit.message);
    if (messagePattern && this.patterns.commitPatterns[messagePattern]) {
      const pattern = this.patterns.commitPatterns[messagePattern];
      const boost = (pattern.avgRiskScore - 0.5) * pattern.confidence * 0.2;
      adjustedScore += boost;
      if (Math.abs(boost) > 0.05) {
        boosts.push(`Message pattern "${messagePattern}": ${boost > 0 ? '+' : ''}${(boost * 100).toFixed(0)}%`);
      }
    }

    // Apply risk factor adjustments
    if (commit.riskFactors) {
      for (const factor of commit.riskFactors) {
        const patternKey = `factor:${factor}`;
        if (this.patterns.commitPatterns[patternKey]) {
          const pattern = this.patterns.commitPatterns[patternKey];
          const boost = (pattern.avgRiskScore - 0.5) * pattern.confidence * 0.1;
          adjustedScore += boost;
          if (Math.abs(boost) > 0.03) {
            boosts.push(`${factor}: ${boost > 0 ? '+' : ''}${(boost * 100).toFixed(0)}%`);
          }
        }
      }
    }

    // Apply author pattern adjustments
    if (commit.author && this.patterns.authorPatterns[commit.author]) {
      const pattern = this.patterns.authorPatterns[commit.author];
      if (pattern.incidentCount >= 2) { // Only adjust if author has history
        const boost = (pattern.avgRiskScore - 0.5) * pattern.confidence * 0.15;
        adjustedScore += boost;
        if (Math.abs(boost) > 0.05) {
          boosts.push(`Author history: ${boost > 0 ? '+' : ''}${(boost * 100).toFixed(0)}%`);
        }
      }
    }

    // Apply time pattern adjustments
    const timestamp = new Date(commit.date);
    const hour = timestamp.getHours();
    const dayOfWeek = timestamp.getDay();
    
    if (this.patterns.timePatterns[`hour:${hour}`]) {
      const pattern = this.patterns.timePatterns[`hour:${hour}`];
      if (pattern.incidentCount >= this.confidence.minSamples) {
        const boost = (pattern.avgSeverity - 2) * pattern.confidence * 0.05; // Assuming severity 1-5 scale
        adjustedScore += boost;
        if (Math.abs(boost) > 0.02) {
          boosts.push(`Time of day: ${boost > 0 ? '+' : ''}${(boost * 100).toFixed(0)}%`);
        }
      }
    }

    commit.patternBoosts = boosts;
    return Math.min(1.0, Math.max(0.0, adjustedScore));
  }

  explainRiskAdjustment(commit) {
    return commit.patternBoosts || [];
  }

  generatePatternInsights(analysis) {
    const insights = [];

    // Time-based insights
    const timeInsights = this.generateTimeInsights(analysis);
    insights.push(...timeInsights);

    // Author-based insights
    const authorInsights = this.generateAuthorInsights(analysis);
    insights.push(...authorInsights);

    // File-based insights
    const fileInsights = this.generateFileInsights(analysis);
    insights.push(...fileInsights);

    // Historical comparison
    const historicalInsights = this.generateHistoricalInsights(analysis);
    insights.push(...historicalInsights);

    return insights;
  }

  generateTimeInsights(analysis) {
    const insights = [];
    const now = new Date();
    const hour = now.getHours();
    const dayOfWeek = now.getDay();

    // Check if current time has higher incident rates
    const hourPattern = this.patterns.timePatterns[`hour:${hour}`];
    if (hourPattern && hourPattern.incidentCount >= this.confidence.minSamples) {
      if (hourPattern.avgSeverity > 3) {
        insights.push({
          type: 'time-risk',
          level: 'warning',
          message: `This hour (${hour}:00) has historically seen ${hourPattern.incidentCount} incidents with above-average severity`,
          confidence: hourPattern.confidence
        });
      }
    }

    const dayPattern = this.patterns.timePatterns[`dayOfWeek:${dayOfWeek}`];
    if (dayPattern && dayPattern.incidentCount >= this.confidence.minSamples) {
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      if (dayPattern.avgSeverity > 3) {
        insights.push({
          type: 'day-risk',
          level: 'info',
          message: `${days[dayOfWeek]}s have seen ${dayPattern.incidentCount} incidents historically`,
          confidence: dayPattern.confidence
        });
      }
    }

    return insights;
  }

  generateAuthorInsights(analysis) {
    const insights = [];
    const authorCounts = {};

    // Count commits per author in this analysis
    if (analysis.suspiciousCommits) {
      for (const commit of analysis.suspiciousCommits) {
        if (commit.author) {
          authorCounts[commit.author] = (authorCounts[commit.author] || 0) + 1;
        }
      }
    }

    // Check against historical patterns
    for (const [author, count] of Object.entries(authorCounts)) {
      const pattern = this.patterns.authorPatterns[author];
      if (pattern && pattern.incidentCount >= 2) {
        if (count > pattern.avgCommitsPerIncident * 1.5) {
          insights.push({
            type: 'author-anomaly',
            level: 'warning',
            message: `${author} has ${count} suspicious commits (usually ${pattern.avgCommitsPerIncident.toFixed(1)})`,
            confidence: pattern.confidence
          });
        }
      }
    }

    return insights;
  }

  generateFileInsights(analysis) {
    const insights = [];
    
    // Check for high-risk files based on history
    if (analysis.impactAnalysis && analysis.impactAnalysis.filesImpacted) {
      for (const file of analysis.impactAnalysis.filesImpacted) {
        const pattern = this.patterns.filePatterns[file];
        if (pattern && pattern.incidentCount >= 2) {
          insights.push({
            type: 'file-risk',
            level: 'warning',
            message: `${file} has been involved in ${pattern.incidentCount} previous incidents`,
            confidence: pattern.confidence
          });
        }
      }
    }

    return insights;
  }

  generateHistoricalInsights(analysis) {
    const insights = [];
    const recentIncidents = this.patterns.incidents.slice(-10);
    
    if (recentIncidents.length >= 3) {
      const avgResolution = recentIncidents
        .filter(i => i.resolutionTime)
        .reduce((sum, i) => sum + i.resolutionTime, 0) / recentIncidents.length;

      if (avgResolution > 0) {
        insights.push({
          type: 'historical-context',
          level: 'info',
          message: `Recent incidents took an average of ${Math.round(avgResolution / 60)} minutes to resolve`,
          confidence: 0.8
        });
      }

      // Check for incident frequency
      const recentCount = recentIncidents.filter(i => {
        const incidentDate = new Date(i.timestamp);
        const daysSince = (Date.now() - incidentDate.getTime()) / (1000 * 60 * 60 * 24);
        return daysSince <= 7;
      }).length;

      if (recentCount >= 3) {
        insights.push({
          type: 'frequency-alert',
          level: 'warning',
          message: `${recentCount} incidents in the last 7 days - above normal frequency`,
          confidence: 0.9
        });
      }
    }

    return insights;
  }

  // Helper methods
  extractMessagePattern(message) {
    // Extract patterns from commit messages
    const lowerMessage = message.toLowerCase();
    
    if (/^hotfix/.test(lowerMessage)) return 'hotfix';
    if (/^fix/.test(lowerMessage)) return 'fix';
    if (/^update/.test(lowerMessage)) return 'update';
    if (/^refactor/.test(lowerMessage)) return 'refactor';
    if (/urgent|critical|emergency/.test(lowerMessage)) return 'urgent';
    if (/config|env/.test(lowerMessage)) return 'config';
    if (/^merge/.test(lowerMessage)) return 'merge';
    
    return null;
  }

  getFileType(filePath) {
    const ext = path.extname(filePath);
    switch (ext) {
      case '.js':
      case '.ts':
      case '.jsx':
      case '.tsx':
        return 'javascript';
      case '.py':
        return 'python';
      case '.java':
        return 'java';
      case '.go':
        return 'go';
      case '.rs':
        return 'rust';
      case '.php':
        return 'php';
      case '.rb':
        return 'ruby';
      case '.yml':
      case '.yaml':
        return 'yaml';
      case '.json':
        return 'json';
      case '.sql':
        return 'sql';
      case '.md':
        return 'markdown';
      case '.dockerfile':
      case '':
        if (filePath.includes('Dockerfile')) return 'docker';
        return 'unknown';
      default:
        return ext.slice(1);
    }
  }

  categorizeChangeSize(changes) {
    if (changes > 500) return 'large';
    if (changes > 100) return 'medium';
    if (changes > 10) return 'small';
    return 'minimal';
  }

  severityToNumber(severity) {
    const severityMap = {
      'critical': 5,
      'high': 4,
      'medium': 3,
      'low': 2,
      'minimal': 1,
      'unknown': 3
    };
    return severityMap[severity] || 3;
  }

  categorizeResolutionTime(minutes) {
    if (minutes > 240) return 'very-slow'; // > 4 hours
    if (minutes > 60) return 'slow';       // > 1 hour
    if (minutes > 15) return 'medium';     // > 15 minutes
    return 'fast';                         // <= 15 minutes
  }

  movingAverage(existing, newValue, sampleCount) {
    const weight = 1 / (sampleCount + 1);
    return existing * (1 - weight) + newValue * weight;
  }

  // Get insights for dashboard
  getPatternSummary() {
    return {
      totalIncidents: this.patterns.incidents.length,
      topRiskFiles: this.getTopRiskFiles(),
      riskiestHours: this.getRiskiestHours(),
      topRiskAuthors: this.getTopRiskAuthors(),
      commonPatterns: this.getCommonPatterns(),
      lastUpdated: this.patterns.lastUpdated
    };
  }

  getTopRiskFiles(limit = 5) {
    return Object.entries(this.patterns.filePatterns)
      .filter(([key, pattern]) => !key.startsWith('type:') && !key.startsWith('dir:'))
      .sort(([, a], [, b]) => (b.incidentCount * b.confidence) - (a.incidentCount * a.confidence))
      .slice(0, limit)
      .map(([file, pattern]) => ({
        file,
        incidentCount: pattern.incidentCount,
        confidence: pattern.confidence,
        lastIncident: pattern.lastIncident
      }));
  }

  getRiskiestHours(limit = 5) {
    return Object.entries(this.patterns.timePatterns)
      .filter(([key]) => key.startsWith('hour:'))
      .sort(([, a], [, b]) => (b.avgSeverity * b.confidence) - (a.avgSeverity * a.confidence))
      .slice(0, limit)
      .map(([key, pattern]) => ({
        hour: parseInt(key.split(':')[1]),
        incidentCount: pattern.incidentCount,
        avgSeverity: pattern.avgSeverity,
        confidence: pattern.confidence
      }));
  }

  getTopRiskAuthors(limit = 5) {
    return Object.entries(this.patterns.authorPatterns)
      .sort(([, a], [, b]) => (b.avgRiskScore * b.confidence) - (a.avgRiskScore * a.confidence))
      .slice(0, limit)
      .map(([author, pattern]) => ({
        author,
        incidentCount: pattern.incidentCount,
        avgRiskScore: pattern.avgRiskScore,
        confidence: pattern.confidence
      }));
  }

  getCommonPatterns() {
    const commonFactors = {};
    
    Object.entries(this.patterns.commitPatterns).forEach(([key, pattern]) => {
      if (key.startsWith('factor:') && pattern.incidentCount >= this.confidence.minSamples) {
        const factor = key.replace('factor:', '');
        commonFactors[factor] = {
          incidentCount: pattern.incidentCount,
          avgRiskScore: pattern.avgRiskScore,
          confidence: pattern.confidence
        };
      }
    });

    return Object.entries(commonFactors)
      .sort(([, a], [, b]) => b.incidentCount - a.incidentCount)
      .slice(0, 10)
      .map(([factor, data]) => ({ factor, ...data }));
  }
}