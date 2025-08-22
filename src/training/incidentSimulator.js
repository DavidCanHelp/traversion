import { simpleGit } from 'simple-git';
import { IncidentAnalyzer } from '../forensics/incidentAnalyzer.js';
import { PatternLearner } from '../learning/patternLearner.js';
import { writeFileSync, readFileSync, existsSync } from 'fs';

export class IncidentSimulator {
  constructor(options = {}) {
    this.repoPath = options.repoPath || process.cwd();
    this.git = simpleGit(this.repoPath);
    this.analyzer = new IncidentAnalyzer(this.repoPath);
    this.learner = new PatternLearner(options.learnerOptions);
    
    // Predefined scenarios for training
    this.scenarios = this.loadScenarios();
  }

  loadScenarios() {
    return [
      {
        id: 'config-error',
        name: 'Configuration Error',
        description: 'A configuration change causes production issues',
        severity: 'high',
        duration: 45, // minutes
        triggers: [
          'config file change',
          'environment variable modification',
          'deployment configuration update'
        ],
        commonPatterns: [
          'Off-hours deployment',
          'Configuration changes',
          'Urgent/fix commit'
        ],
        learningGoals: [
          'Identify configuration-related risks',
          'Recognize off-hours deployment patterns',
          'Understand cascading effects of config changes'
        ]
      },
      {
        id: 'database-migration',
        name: 'Database Migration Failure',
        description: 'A database migration causes data integrity issues',
        severity: 'critical',
        duration: 120,
        triggers: [
          'schema change',
          'data migration script',
          'index modification'
        ],
        commonPatterns: [
          'Database changes',
          'Large code changes',
          'Multiple files modified'
        ],
        learningGoals: [
          'Identify database-related risks',
          'Understand migration complexity',
          'Recognize data integrity patterns'
        ]
      },
      {
        id: 'dependency-update',
        name: 'Dependency Update Break',
        description: 'A dependency update introduces breaking changes',
        severity: 'medium',
        duration: 30,
        triggers: [
          'package.json change',
          'requirements.txt update',
          'dependency version bump'
        ],
        commonPatterns: [
          'Dependency changes',
          'Vague commit message',
          'Build system changes'
        ],
        learningGoals: [
          'Identify dependency-related risks',
          'Understand version compatibility',
          'Recognize breaking change patterns'
        ]
      },
      {
        id: 'security-vulnerability',
        name: 'Security Vulnerability Exposure',
        description: 'A code change exposes a security vulnerability',
        severity: 'critical',
        duration: 60,
        triggers: [
          'authentication code change',
          'permission logic modification',
          'input validation removal'
        ],
        commonPatterns: [
          'Security changes',
          'Authentication/authorization modification',
          'Input validation changes'
        ],
        learningGoals: [
          'Identify security-related risks',
          'Understand authentication patterns',
          'Recognize vulnerability indicators'
        ]
      },
      {
        id: 'performance-regression',
        name: 'Performance Regression',
        description: 'A code change significantly impacts performance',
        severity: 'medium',
        duration: 90,
        triggers: [
          'algorithm change',
          'database query modification',
          'caching logic alteration'
        ],
        commonPatterns: [
          'Large code changes',
          'Core application changes',
          'Database query modifications'
        ],
        learningGoals: [
          'Identify performance-related risks',
          'Understand algorithmic complexity',
          'Recognize optimization patterns'
        ]
      },
      {
        id: 'hotfix-cascade',
        name: 'Hotfix Cascade Failure',
        description: 'A rushed hotfix creates additional problems',
        severity: 'high',
        duration: 75,
        triggers: [
          'urgent commit',
          'minimal testing',
          'off-hours deployment'
        ],
        commonPatterns: [
          'Urgent/fix commit',
          'Off-hours deployment',
          'Vague commit message',
          'Minimal testing'
        ],
        learningGoals: [
          'Understand hotfix risks',
          'Recognize pressure-driven decisions',
          'Learn from cascading failures'
        ]
      }
    ];
  }

  async runTrainingSession(scenarioId, options = {}) {
    const scenario = this.scenarios.find(s => s.id === scenarioId);
    if (!scenario) {
      throw new Error(`Scenario '${scenarioId}' not found`);
    }

    console.log(`🎓 Starting training session: ${scenario.name}`);
    console.log(`📖 Scenario: ${scenario.description}`);
    console.log(`⚡ Severity: ${scenario.severity.toUpperCase()}`);
    console.log(`⏱️ Expected duration: ${scenario.duration} minutes\n`);

    const session = {
      id: `training-${Date.now()}`,
      scenarioId,
      scenario,
      startTime: new Date(),
      participantId: options.participantId || 'anonymous',
      mode: options.mode || 'guided', // 'guided', 'challenge', 'assessment'
      steps: [],
      results: {}
    };

    // Find a suitable historical incident or simulate one
    const simulatedIncident = await this.createSimulatedIncident(scenario);
    
    switch (session.mode) {
      case 'guided':
        await this.runGuidedSession(session, simulatedIncident);
        break;
      case 'challenge':
        await this.runChallengeSession(session, simulatedIncident);
        break;
      case 'assessment':
        await this.runAssessmentSession(session, simulatedIncident);
        break;
    }

    session.endTime = new Date();
    session.duration = session.endTime - session.startTime;

    await this.saveTrainingResults(session);
    this.displaySessionSummary(session);

    return session;
  }

  async createSimulatedIncident(scenario) {
    console.log('🔍 Creating simulated incident based on scenario...\n');

    // Look for historical commits that match the scenario patterns
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - (7 * 24 * 60 * 60 * 1000)); // Last 7 days
    
    try {
      const commits = await this.analyzer.getCommitsInTimeframe(startTime, endTime);
      
      // Find commits that match scenario patterns
      const matchingCommits = commits.filter(commit => {
        return scenario.triggers.some(trigger => 
          commit.message.toLowerCase().includes(trigger.toLowerCase())
        );
      });

      if (matchingCommits.length > 0) {
        // Use a real commit as basis for simulation
        const baseCommit = matchingCommits[0];
        return await this.enhanceCommitForScenario(baseCommit, scenario);
      }
    } catch (error) {
      console.log('⚠️ Could not find matching historical commits, creating synthetic scenario');
    }

    // Create a synthetic incident
    return this.createSyntheticIncident(scenario);
  }

  async enhanceCommitForScenario(commit, scenario) {
    const analysis = await this.analyzer.analyzeCommit(commit, []);
    
    return {
      id: `sim-${Date.now()}`,
      timestamp: new Date(commit.date).toISOString(),
      severity: scenario.severity,
      description: `Simulated ${scenario.name}: ${scenario.description}`,
      affectedFiles: this.generateAffectedFiles(scenario),
      suspiciousCommits: [analysis],
      actualPatterns: analysis.riskFactors || [],
      expectedPatterns: scenario.commonPatterns,
      duration: scenario.duration,
      scenario: scenario.id
    };
  }

  createSyntheticIncident(scenario) {
    const now = new Date();
    const incidentTime = new Date(now.getTime() - (2 * 60 * 60 * 1000)); // 2 hours ago

    return {
      id: `sim-${Date.now()}`,
      timestamp: incidentTime.toISOString(),
      severity: scenario.severity,
      description: `Simulated ${scenario.name}: ${scenario.description}`,
      affectedFiles: this.generateAffectedFiles(scenario),
      suspiciousCommits: this.generateSyntheticCommits(scenario, incidentTime),
      actualPatterns: scenario.commonPatterns,
      expectedPatterns: scenario.commonPatterns,
      duration: scenario.duration,
      scenario: scenario.id
    };
  }

  generateAffectedFiles(scenario) {
    const fileTemplates = {
      'config-error': ['config/production.yml', 'docker-compose.yml', '.env.production'],
      'database-migration': ['migrations/001_add_user_table.sql', 'models/User.js', 'database/schema.sql'],
      'dependency-update': ['package.json', 'package-lock.json', 'src/utils/validator.js'],
      'security-vulnerability': ['src/auth/login.js', 'middleware/authentication.js', 'src/security/validator.js'],
      'performance-regression': ['src/services/dataProcessor.js', 'src/database/queries.js', 'src/cache/manager.js'],
      'hotfix-cascade': ['src/api/userController.js', 'src/services/paymentService.js']
    };

    return fileTemplates[scenario.id] || ['src/app.js', 'config/settings.js'];
  }

  generateSyntheticCommits(scenario, incidentTime) {
    const commitTemplates = {
      'config-error': [
        {
          shortHash: 'a1b2c3d',
          message: 'fix: update production config timeout values',
          author: 'john.doe',
          riskScore: 0.75,
          riskFactors: ['Configuration changes', 'Off-hours deployment', 'Urgent/fix commit']
        }
      ],
      'database-migration': [
        {
          shortHash: 'e4f5g6h',
          message: 'feat: add user preferences table with migration',
          author: 'jane.smith',
          riskScore: 0.85,
          riskFactors: ['Database changes', 'Large code changes', 'Multiple files modified']
        }
      ],
      'dependency-update': [
        {
          shortHash: 'i7j8k9l',
          message: 'update dependencies to latest versions',
          author: 'bob.wilson',
          riskScore: 0.60,
          riskFactors: ['Dependency changes', 'Vague commit message', 'Package Dependencies']
        }
      ]
    };

    const templates = commitTemplates[scenario.id] || [{
      shortHash: 'x1y2z3a',
      message: 'fix: generic issue resolution',
      author: 'dev.user',
      riskScore: 0.50,
      riskFactors: ['Vague commit message']
    }];

    return templates.map(template => ({
      ...template,
      hash: template.shortHash + '4567890123456789',
      date: new Date(incidentTime.getTime() - (30 * 60 * 1000)), // 30 mins before incident
      filesChanged: this.generateAffectedFiles(scenario).map(file => ({ file, changes: 50 })),
      linesChanged: { additions: 25, deletions: 25 }
    }));
  }

  async runGuidedSession(session, incident) {
    console.log('📚 GUIDED MODE: I\'ll walk you through the analysis step by step\n');

    // Step 1: Initial assessment
    await this.guidedStep(session, 'initial-assessment', 
      'Let\'s start with the incident overview. What do you notice about the timing and severity?',
      () => this.displayIncidentOverview(incident)
    );

    // Step 2: Commit analysis
    await this.guidedStep(session, 'commit-analysis',
      'Now let\'s examine the suspicious commits. What patterns do you see?',
      () => this.displayCommitAnalysis(incident.suspiciousCommits)
    );

    // Step 3: Risk factor identification  
    await this.guidedStep(session, 'risk-factors',
      'What risk factors can you identify? Compare with the expected patterns.',
      () => this.compareRiskFactors(incident.actualPatterns, incident.expectedPatterns)
    );

    // Step 4: Root cause hypothesis
    await this.guidedStep(session, 'root-cause',
      'Based on the evidence, what\'s your hypothesis for the root cause?',
      () => this.displayRootCauseGuidance(incident)
    );

    // Step 5: Recommendations
    await this.guidedStep(session, 'recommendations',
      'What recommendations would you make to prevent this type of incident?',
      () => this.displayPreventionRecommendations(incident.scenario)
    );
  }

  async runChallengeSession(session, incident) {
    console.log('🏆 CHALLENGE MODE: Analyze this incident as quickly as possible!\n');
    console.log('⏱️ Timer started - try to identify the root cause and key risk factors.\n');

    const startTime = Date.now();

    // Show only basic incident info
    this.displayIncidentOverview(incident);
    
    // Challenge: identify top 3 risk factors
    const userRiskFactors = await this.promptForRiskFactors();
    
    // Challenge: identify most likely culprit commit
    const userCulprit = await this.promptForCulpritCommit(incident.suspiciousCommits);
    
    // Challenge: suggest prevention measures
    const userPrevention = await this.promptForPrevention();

    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;

    // Evaluate responses
    session.results = {
      duration,
      riskFactorScore: this.scoreRiskFactors(userRiskFactors, incident.expectedPatterns),
      culpritScore: this.scoreCulpritIdentification(userCulprit, incident.suspiciousCommits[0]),
      preventionScore: this.scorePreventionMeasures(userPrevention, incident.scenario),
      totalScore: 0
    };

    session.results.totalScore = (
      session.results.riskFactorScore + 
      session.results.culpritScore + 
      session.results.preventionScore
    ) / 3;

    this.displayChallengeResults(session);
  }

  async runAssessmentSession(session, incident) {
    console.log('📊 ASSESSMENT MODE: Complete forensic analysis for evaluation\n');

    // Multi-part assessment
    const assessmentParts = [
      {
        id: 'timeline-reconstruction',
        title: 'Timeline Reconstruction',
        task: 'Reconstruct the incident timeline from the evidence',
        weight: 0.2
      },
      {
        id: 'evidence-analysis',
        title: 'Evidence Analysis', 
        task: 'Analyze all suspicious commits and rank by likelihood',
        weight: 0.3
      },
      {
        id: 'pattern-recognition',
        title: 'Pattern Recognition',
        task: 'Identify patterns that led to this incident',
        weight: 0.2
      },
      {
        id: 'impact-assessment',
        title: 'Impact Assessment',
        task: 'Assess the scope and severity of the incident',
        weight: 0.15
      },
      {
        id: 'prevention-strategy',
        title: 'Prevention Strategy',
        task: 'Design a comprehensive prevention strategy',
        weight: 0.15
      }
    ];

    session.results = { parts: {}, totalScore: 0 };

    for (const part of assessmentParts) {
      console.log(`\n📋 ${part.title}: ${part.task}`);
      const response = await this.promptForAssessmentResponse(part, incident);
      const score = await this.scoreAssessmentResponse(part, response, incident);
      
      session.results.parts[part.id] = {
        response,
        score,
        weight: part.weight
      };
    }

    // Calculate total weighted score
    session.results.totalScore = assessmentParts.reduce((total, part) => {
      return total + (session.results.parts[part.id].score * part.weight);
    }, 0);

    this.displayAssessmentResults(session);
  }

  async guidedStep(session, stepId, instruction, displayFunction) {
    console.log(`\n🎯 STEP: ${instruction}\n`);
    
    if (displayFunction) {
      displayFunction();
    }

    const response = await this.waitForUserInput('\nPress Enter when you\'ve reviewed this information...');
    
    session.steps.push({
      id: stepId,
      instruction,
      timestamp: new Date(),
      userResponse: response
    });

    console.log('\n' + '─'.repeat(60) + '\n');
  }

  displayIncidentOverview(incident) {
    console.log('📊 INCIDENT OVERVIEW:');
    console.log(`   Time: ${new Date(incident.timestamp).toLocaleString()}`);
    console.log(`   Severity: ${incident.severity.toUpperCase()}`);
    console.log(`   Duration: ~${incident.duration} minutes`);
    console.log(`   Affected Files: ${incident.affectedFiles.length}`);
    console.log(`   Suspicious Commits: ${incident.suspiciousCommits.length}`);
    if (incident.description) {
      console.log(`   Description: ${incident.description}`);
    }
  }

  displayCommitAnalysis(commits) {
    console.log('🔍 SUSPICIOUS COMMITS:');
    commits.forEach((commit, index) => {
      const riskEmoji = commit.riskScore > 0.7 ? '🚨' : commit.riskScore > 0.4 ? '⚠️' : '🟡';
      console.log(`\n${index + 1}. ${riskEmoji} ${commit.shortHash} - ${commit.message}`);
      console.log(`   Author: ${commit.author} | Risk: ${(commit.riskScore * 100).toFixed(0)}%`);
      console.log(`   Files: ${commit.filesChanged?.length || 0} | Changes: +${commit.linesChanged?.additions || 0}/-${commit.linesChanged?.deletions || 0}`);
      if (commit.riskFactors && commit.riskFactors.length > 0) {
        console.log(`   Risk Factors: ${commit.riskFactors.join(', ')}`);
      }
    });
  }

  compareRiskFactors(actual, expected) {
    console.log('📋 RISK FACTOR COMPARISON:');
    console.log('\nExpected patterns for this scenario:');
    expected.forEach(pattern => console.log(`   ✓ ${pattern}`));
    
    console.log('\nActual patterns found:');
    actual.forEach(pattern => {
      const isExpected = expected.includes(pattern);
      console.log(`   ${isExpected ? '✅' : '❓'} ${pattern}`);
    });

    const missed = expected.filter(p => !actual.includes(p));
    if (missed.length > 0) {
      console.log('\nMissed patterns:');
      missed.forEach(pattern => console.log(`   ❌ ${pattern}`));
    }
  }

  displayRootCauseGuidance(incident) {
    const scenario = this.scenarios.find(s => s.id === incident.scenario);
    if (scenario) {
      console.log('💡 ROOT CAUSE GUIDANCE:');
      console.log(`\nScenario: ${scenario.name}`);
      console.log(`Typical causes: ${scenario.triggers.join(', ')}`);
      console.log('\nLook for:');
      scenario.commonPatterns.forEach(pattern => {
        console.log(`   • ${pattern}`);
      });
    }
  }

  displayPreventionRecommendations(scenarioId) {
    const preventionStrategies = {
      'config-error': [
        'Implement configuration validation in CI/CD',
        'Use infrastructure as code with peer review',
        'Set up configuration drift detection',
        'Establish emergency rollback procedures'
      ],
      'database-migration': [
        'Require database migration reviews',
        'Implement migration testing in staging',
        'Use backward-compatible migrations',
        'Monitor migration performance impacts'
      ],
      'dependency-update': [
        'Implement automated dependency scanning',
        'Use semantic versioning checks',
        'Require security review for major updates',
        'Maintain dependency update changelog'
      ],
      'security-vulnerability': [
        'Implement security-focused code reviews',
        'Use automated security scanning tools',
        'Establish security incident response plan',
        'Regular security training for developers'
      ]
    };

    const strategies = preventionStrategies[scenarioId] || [
      'Implement comprehensive testing',
      'Establish proper review processes',
      'Monitor system health metrics',
      'Create incident response procedures'
    ];

    console.log('🛡️ PREVENTION RECOMMENDATIONS:');
    strategies.forEach(strategy => console.log(`   • ${strategy}`));
  }

  async waitForUserInput(prompt) {
    // In a real implementation, this would use readline or similar
    // For now, simulate user interaction
    console.log(prompt);
    return 'user_acknowledged';
  }

  async promptForRiskFactors() {
    console.log('\n🎯 CHALLENGE: Identify the top 3 risk factors for this incident');
    console.log('Common risk factors: Configuration changes, Off-hours deployment, Database changes, Security changes, Large code changes, Vague commit message');
    
    // Simulate user input - in real implementation would prompt user
    return ['Configuration changes', 'Off-hours deployment', 'Urgent/fix commit'];
  }

  async promptForCulpritCommit(commits) {
    console.log('\n🎯 CHALLENGE: Which commit is most likely the culprit?');
    commits.forEach((commit, index) => {
      console.log(`${index + 1}. ${commit.shortHash} - ${commit.message} (${(commit.riskScore * 100).toFixed(0)}% risk)`);
    });
    
    // Simulate user selection
    return commits[0];
  }

  async promptForPrevention() {
    console.log('\n🎯 CHALLENGE: What prevention measures would you implement?');
    
    // Simulate user response
    return [
      'Implement configuration validation',
      'Require peer review for config changes',
      'Set up automated rollback procedures'
    ];
  }

  scoreRiskFactors(userFactors, expectedFactors) {
    const correct = userFactors.filter(factor => expectedFactors.includes(factor));
    return correct.length / expectedFactors.length;
  }

  scoreCulpritIdentification(userChoice, actualCulprit) {
    return userChoice.shortHash === actualCulprit.shortHash ? 1.0 : 0.5;
  }

  scorePreventionMeasures(userMeasures, scenarioId) {
    // Simple scoring based on relevance
    const relevantKeywords = {
      'config-error': ['configuration', 'validation', 'review', 'rollback'],
      'database-migration': ['migration', 'testing', 'staging', 'backward'],
      'dependency-update': ['dependency', 'scanning', 'version', 'security'],
      'security-vulnerability': ['security', 'review', 'scanning', 'training']
    };

    const keywords = relevantKeywords[scenarioId] || ['testing', 'review', 'monitoring'];
    const userText = userMeasures.join(' ').toLowerCase();
    
    const matchCount = keywords.filter(keyword => userText.includes(keyword)).length;
    return matchCount / keywords.length;
  }

  displayChallengeResults(session) {
    console.log('\n🏆 CHALLENGE RESULTS:');
    console.log(`⏱️ Duration: ${session.results.duration.toFixed(1)} seconds`);
    console.log(`📊 Risk Factor Identification: ${(session.results.riskFactorScore * 100).toFixed(0)}%`);
    console.log(`🎯 Culprit Identification: ${(session.results.culpritScore * 100).toFixed(0)}%`);
    console.log(`🛡️ Prevention Strategy: ${(session.results.preventionScore * 100).toFixed(0)}%`);
    console.log(`🏅 Total Score: ${(session.results.totalScore * 100).toFixed(0)}%`);

    const grade = session.results.totalScore >= 0.9 ? 'A' :
                  session.results.totalScore >= 0.8 ? 'B' :
                  session.results.totalScore >= 0.7 ? 'C' :
                  session.results.totalScore >= 0.6 ? 'D' : 'F';

    console.log(`📈 Grade: ${grade}`);
  }

  displayAssessmentResults(session) {
    console.log('\n📊 ASSESSMENT RESULTS:');
    
    Object.entries(session.results.parts).forEach(([partId, result]) => {
      console.log(`${partId}: ${(result.score * 100).toFixed(0)}% (weight: ${(result.weight * 100)}%)`);
    });

    console.log(`\n🏅 Final Score: ${(session.results.totalScore * 100).toFixed(0)}%`);
    
    const grade = session.results.totalScore >= 0.9 ? 'Excellent' :
                  session.results.totalScore >= 0.8 ? 'Good' :
                  session.results.totalScore >= 0.7 ? 'Satisfactory' :
                  session.results.totalScore >= 0.6 ? 'Needs Improvement' : 'Poor';

    console.log(`📈 Assessment: ${grade}`);
  }

  displaySessionSummary(session) {
    console.log('\n' + '═'.repeat(60));
    console.log('📚 TRAINING SESSION COMPLETE');
    console.log('═'.repeat(60));
    console.log(`Scenario: ${session.scenario.name}`);
    console.log(`Mode: ${session.mode.toUpperCase()}`);
    console.log(`Duration: ${Math.round((session.endTime - session.startTime) / 1000 / 60)} minutes`);
    
    if (session.results.totalScore !== undefined) {
      console.log(`Score: ${(session.results.totalScore * 100).toFixed(0)}%`);
    }

    console.log('\n🎯 Learning Goals Covered:');
    session.scenario.learningGoals.forEach(goal => {
      console.log(`   ✓ ${goal}`);
    });

    console.log('\n💡 Next Steps:');
    console.log('   • Review the scenario patterns in real incidents');
    console.log('   • Practice with different scenario types');
    console.log('   • Share insights with your team');
    console.log('   • Apply learnings to your incident response process');
  }

  async saveTrainingResults(session) {
    const resultsPath = '.traversion/training-results.json';
    let results = [];

    if (existsSync(resultsPath)) {
      try {
        results = JSON.parse(readFileSync(resultsPath, 'utf8'));
      } catch (error) {
        console.warn('Could not read existing training results');
      }
    }

    results.push({
      sessionId: session.id,
      participantId: session.participantId,
      scenarioId: session.scenarioId,
      mode: session.mode,
      startTime: session.startTime,
      endTime: session.endTime,
      duration: session.duration,
      score: session.results.totalScore,
      completed: true
    });

    // Keep only last 100 sessions
    if (results.length > 100) {
      results = results.slice(-100);
    }

    try {
      writeFileSync(resultsPath, JSON.stringify(results, null, 2));
    } catch (error) {
      console.warn('Could not save training results:', error.message);
    }
  }

  // Get available scenarios
  getAvailableScenarios() {
    return this.scenarios.map(s => ({
      id: s.id,
      name: s.name,
      description: s.description,
      severity: s.severity,
      duration: s.duration,
      learningGoals: s.learningGoals
    }));
  }

  // Get training statistics
  getTrainingStats(participantId = null) {
    const resultsPath = '.traversion/training-results.json';
    
    if (!existsSync(resultsPath)) {
      return { totalSessions: 0, averageScore: 0, scenarioStats: {} };
    }

    try {
      let results = JSON.parse(readFileSync(resultsPath, 'utf8'));
      
      if (participantId) {
        results = results.filter(r => r.participantId === participantId);
      }

      const totalSessions = results.length;
      const averageScore = results.reduce((sum, r) => sum + (r.score || 0), 0) / totalSessions;
      
      const scenarioStats = {};
      results.forEach(result => {
        if (!scenarioStats[result.scenarioId]) {
          scenarioStats[result.scenarioId] = { count: 0, averageScore: 0, totalScore: 0 };
        }
        scenarioStats[result.scenarioId].count++;
        scenarioStats[result.scenarioId].totalScore += result.score || 0;
        scenarioStats[result.scenarioId].averageScore = scenarioStats[result.scenarioId].totalScore / scenarioStats[result.scenarioId].count;
      });

      return {
        totalSessions,
        averageScore,
        scenarioStats,
        recentSessions: results.slice(-10)
      };
    } catch (error) {
      console.warn('Could not read training statistics:', error.message);
      return { totalSessions: 0, averageScore: 0, scenarioStats: {} };
    }
  }
}