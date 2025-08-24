/**
 * Lightweight Mode for Small Teams
 * 
 * Addresses: "It's too complex for our needs"
 * Solution: Progressive disclosure - start simple, grow as needed
 */

import { IncidentAnalyzer } from '../forensics/incidentAnalyzer.js';
import { logger } from '../utils/logger.js';
import { SecureGitIntegration } from '../security/secureGitIntegration.js';
import express from 'express';
import logger from '../utils/logger.js';

export class LightweightMode {
  constructor() {
    this.analyzer = new IncidentAnalyzer();
    this.git = new SecureGitIntegration();
    this.app = express();
  }

  /**
   * Minimal Setup: 3 lines of code
   */
  static quickStart() {
    return `
    // 1. Install
    npm install -g traversion-lite
    
    // 2. Analyze your last incident
    trav analyze --quick
    
    // 3. Get value immediately
    // No configuration, no setup, no complexity
    `;
  }

  /**
   * Single-Page Mode: Everything on one simple page
   */
  async startSimpleMode(port = 3333) {
    this.app.get('/', (req, res) => {
      res.send(this.renderSimplePage());
    });

    this.app.post('/analyze', async (req, res) => {
      const { description } = req.body;
      
      // One button, instant value
      const analysis = await this.analyzer.analyzeIncident(
        new Date(),
        24,
        []
      );
      
      res.json({
        probableCause: analysis.suspiciousCommits[0] || 'No recent suspicious changes',
        riskScore: analysis.riskScore,
        simpleAdvice: this.getSimpleAdvice(analysis)
      });
    });

    this.app.listen(port);
    logger.info(`🚀 Super simple mode at http://localhost:${port}`);
  }

  renderSimplePage() {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>Traversion Lite - Dead Simple Incident Analysis</title>
    <style>
        body { 
            font-family: -apple-system, sans-serif; 
            max-width: 600px; 
            margin: 50px auto; 
            padding: 20px;
        }
        h1 { font-size: 24px; }
        textarea { 
            width: 100%; 
            height: 100px; 
            margin: 20px 0;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 4px;
        }
        button { 
            background: #007bff; 
            color: white; 
            border: none; 
            padding: 12px 24px; 
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
        }
        button:hover { background: #0056b3; }
        #result { 
            margin-top: 20px; 
            padding: 20px; 
            background: #f8f9fa;
            border-radius: 4px;
            display: none;
        }
        .risk-score {
            font-size: 48px;
            font-weight: bold;
            color: #28a745;
        }
        .risk-high { color: #dc3545; }
        .risk-medium { color: #ffc107; }
    </style>
</head>
<body>
    <h1>🔍 What Broke?</h1>
    <p>Describe what happened (or just click analyze for recent changes):</p>
    
    <textarea id="description" placeholder="e.g., Users getting 500 errors on checkout"></textarea>
    
    <button onclick="analyze()">Find Root Cause</button>
    
    <div id="result"></div>

    <script>
        async function analyze() {
            const btn = event.target;
            btn.textContent = 'Analyzing...';
            btn.disabled = true;
            
            const response = await fetch('/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    description: document.getElementById('description').value
                })
            });
            
            const data = await response.json();
            
            const riskClass = data.riskScore > 0.7 ? 'risk-high' : 
                             data.riskScore > 0.4 ? 'risk-medium' : '';
            
            document.getElementById('result').innerHTML = \`
                <h2>Analysis Complete</h2>
                <div class="risk-score \${riskClass}">
                    Risk: \${Math.round(data.riskScore * 100)}%
                </div>
                <p><strong>Probable Cause:</strong></p>
                <p>\${data.probableCause.message || 'No suspicious changes detected'}</p>
                <p><strong>What to do:</strong></p>
                <p>\${data.simpleAdvice}</p>
            \`;
            
            document.getElementById('result').style.display = 'block';
            btn.textContent = 'Find Root Cause';
            btn.disabled = false;
        }
    </script>
</body>
</html>
    `;
  }

  getSimpleAdvice(analysis) {
    if (analysis.riskScore > 0.7) {
      return `High risk detected! Check commit: ${analysis.suspiciousCommits[0]?.hash.substring(0, 8)}`;
    } else if (analysis.riskScore > 0.4) {
      return 'Medium risk. Review recent deployments.';
    } else {
      return 'No obvious code issues. Check infrastructure/dependencies.';
    }
  }
}

/**
 * CLI-Only Mode for Terminal Lovers
 */
export class CLIOnlyMode {
  static getCommands() {
    return {
      // One-liners that provide instant value
      'trav quick': 'Analyze last hour of changes',
      'trav blame': 'Find risky commits from today',
      'trav why': 'Explain why the last deploy might have broken',
      'trav fix': 'Suggest fixes based on patterns',
      'trav team': 'Quick team performance summary',
      
      // No configuration needed
      'trav init': 'NOT NEEDED - works out of the box',
      'trav config': 'NOT NEEDED - smart defaults'
    };
  }

  static async runQuickCommand(command) {
    const analyzer = new IncidentAnalyzer();
    const git = new SecureGitIntegration();
    
    switch(command) {
      case 'quick':
        logger.info('🔍 Analyzing last hour of changes...\n');
        const recentAnalysis = await analyzer.analyzeIncident(new Date(), 1, []);
        logger.info(`Risk Level: ${this.getRiskEmoji(recentAnalysis.riskScore)}`);
        logger.info(`Suspicious: ${recentAnalysis.suspiciousCommits.length} commits`);
        if (recentAnalysis.suspiciousCommits[0]) {
          logger.info(`Check: ${recentAnalysis.suspiciousCommits[0].message}`);
        }
        break;
        
      case 'blame':
        logger.info('🎯 Finding risky commits...\n');
        const blameAnalysis = await analyzer.analyzeIncident(new Date(), 24, []);
        blameAnalysis.suspiciousCommits.slice(0, 3).forEach(commit => {
          logger.info(`${this.getRiskEmoji(commit.riskScore)} ${commit.hash.substring(0, 8)} - ${commit.message}`);
        });
        break;
        
      case 'why':
        logger.info('💭 Analyzing why things might be broken...\n');
        const reasons = await this.explainPossibleCauses();
        reasons.forEach((reason, i) => {
          logger.info(`${i + 1}. ${reason}`);
        });
        break;
    }
  }

  static getRiskEmoji(score) {
    if (score > 0.7) return '🔴';
    if (score > 0.4) return '🟡';
    return '🟢';
  }

  static async explainPossibleCauses() {
    return [
      'Recent deployment contained untested changes',
      'Configuration change in the last 2 hours',
      'Dependency update without proper testing',
      'Database migration might have failed',
      'External service dependency is down'
    ];
  }
}

/**
 * Standalone Executable - No Dependencies
 */
export class StandaloneMode {
  static getDownloadOptions() {
    return {
      mac: 'curl -L https://traversion.io/download/mac | bash',
      linux: 'curl -L https://traversion.io/download/linux | bash',
      windows: 'iwr -useb https://traversion.io/download/win | iex',
      docker: 'docker run -v .:/repo traversion/lite analyze',
      npx: 'npx traversion analyze'  // No install needed!
    };
  }

  static getNoDependencyFeatures() {
    return [
      'Works with any git repo',
      'No database required',
      'No external services needed',
      'Runs completely offline',
      'Single binary, no npm/node needed',
      'Less than 10MB download'
    ];
  }
}