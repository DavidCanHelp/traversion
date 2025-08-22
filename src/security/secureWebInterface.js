import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { IncidentAnalyzer } from '../forensics/incidentAnalyzer.js';
import { GitHubIntegration } from '../integrations/githubIntegration.js';
import { InputSanitizer } from './inputSanitizer.js';
import { AuthMiddleware } from './authMiddleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class SecureWebInterface {
  constructor(port = 3335) {
    this.port = port;
    this.app = express();
    this.analyzer = new IncidentAnalyzer();
    this.github = new GitHubIntegration();
    this.auth = new AuthMiddleware();
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    // Security headers
    this.app.use(this.auth.securityHeaders);
    
    // Request parsing with limits
    this.app.use(express.json({ limit: '1mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '1mb' }));
    
    // Request sanitization
    this.app.use(this.auth.sanitizeRequest);
    
    // Rate limiting
    this.app.use(this.auth.rateLimit({
      windowMs: 900000, // 15 minutes
      max: 100, // 100 requests per window
      keyGenerator: (req) => req.ip || 'unknown'
    }));

    // Static files with security
    this.app.use(express.static(path.join(__dirname, 'public'), {
      setHeaders: (res) => {
        res.set('Cache-Control', 'public, max-age=86400'); // 24 hours
        res.set('X-Content-Type-Options', 'nosniff');
      }
    }));
  }

  setupRoutes() {
    // Health check
    this.app.get('/api/health', (req, res) => {
      res.json({ 
        status: 'ok', 
        service: 'traversion-forensics',
        version: process.env.npm_package_version || '0.1.0',
        timestamp: new Date().toISOString()
      });
    });

    // Main interface with XSS protection
    this.app.get('/', (req, res) => {
      res.send(this.renderSecureMainPage());
    });

    // Secure incident analysis endpoint
    this.app.post('/api/analyze-incident', async (req, res) => {
      try {
        const { incidentTime, lookbackHours = 24, affectedFiles = [] } = req.body;
        
        // Validate and sanitize inputs
        const sanitizedHours = InputSanitizer.sanitizeInteger(lookbackHours, 1, 168); // Max 1 week
        let sanitizedTime = new Date();
        
        if (incidentTime) {
          sanitizedTime = new Date(InputSanitizer.sanitizeISODate(incidentTime));
        }
        
        const sanitizedFiles = Array.isArray(affectedFiles) 
          ? affectedFiles.map(f => InputSanitizer.sanitizeFilePath(f))
          : [];
        
        const analysis = await this.analyzer.analyzeIncident(
          sanitizedTime, 
          sanitizedHours, 
          sanitizedFiles
        );
        
        // Sanitize output to prevent XSS
        const sanitizedAnalysis = this.sanitizeAnalysisOutput(analysis);
        
        res.json(sanitizedAnalysis);
      } catch (error) {
        res.status(400).json({ 
          error: 'Invalid request parameters',
          message: InputSanitizer.sanitizeHTML(error.message)
        });
      }
    });

    // Secure PR analysis endpoint
    this.app.post('/api/analyze-pr', async (req, res) => {
      try {
        const { owner, repo, number } = req.body;
        
        // Validate inputs
        if (!owner || !repo || !number) {
          return res.status(400).json({ 
            error: 'Missing required parameters: owner, repo, number' 
          });
        }

        const sanitizedOwner = InputSanitizer.sanitizeShellArg(owner);
        const sanitizedRepo = InputSanitizer.sanitizeShellArg(repo);
        const sanitizedNumber = InputSanitizer.sanitizeInteger(number, 1, 999999);
        
        const analysis = await this.github.analyzePullRequest(
          sanitizedOwner, 
          sanitizedRepo, 
          sanitizedNumber
        );
        
        const sanitizedAnalysis = this.sanitizeAnalysisOutput(analysis);
        
        res.json(sanitizedAnalysis);
      } catch (error) {
        res.status(500).json({ 
          error: 'PR analysis failed',
          message: InputSanitizer.sanitizeHTML(error.message)
        });
      }
    });

    // Error handling middleware
    this.app.use(this.auth.sanitizeErrors);
  }

  sanitizeAnalysisOutput(analysis) {
    // Recursively sanitize all string values to prevent XSS
    const sanitize = (obj) => {
      if (typeof obj === 'string') {
        return InputSanitizer.sanitizeHTML(obj);
      }
      
      if (Array.isArray(obj)) {
        return obj.map(sanitize);
      }
      
      if (obj && typeof obj === 'object') {
        const sanitized = {};
        for (const [key, value] of Object.entries(obj)) {
          sanitized[key] = sanitize(value);
        }
        return sanitized;
      }
      
      return obj;
    };

    return sanitize(analysis);
  }

  renderSecureMainPage() {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;">
    <title>Traversion - Incident Forensics</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: #333;
        }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        .header {
            background: rgba(255,255,255,0.95);
            backdrop-filter: blur(10px);
            border-radius: 16px;
            padding: 30px;
            margin-bottom: 30px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
        }
        .header h1 { 
            font-size: 2.5rem; 
            font-weight: 700;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 10px;
        }
        .header p { color: #666; font-size: 1.1rem; }
        .cards { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 30px; }
        .card {
            background: rgba(255,255,255,0.95);
            backdrop-filter: blur(10px);
            border-radius: 16px;
            padding: 30px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
        }
        .card h2 { 
            font-size: 1.5rem; 
            margin-bottom: 20px;
            color: #333;
        }
        .form-group { margin-bottom: 20px; }
        .form-group label { 
            display: block; 
            margin-bottom: 8px; 
            font-weight: 600;
            color: #555;
        }
        .form-group input, .form-group textarea {
            width: 100%;
            padding: 12px 16px;
            border: 2px solid #e1e5e9;
            border-radius: 8px;
            font-size: 14px;
            transition: all 0.2s;
        }
        .form-group input:focus, .form-group textarea:focus {
            outline: none;
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }
        .btn {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            font-size: 14px;
        }
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(102, 126, 234, 0.3);
        }
        .btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }
        .results {
            background: rgba(255,255,255,0.95);
            backdrop-filter: blur(10px);
            border-radius: 16px;
            padding: 30px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
            margin-top: 30px;
            display: none;
        }
        .loading { 
            text-align: center; 
            color: #667eea;
            font-weight: 600;
        }
        .error { 
            color: #dc3545; 
            background: #f8d7da; 
            padding: 15px; 
            border-radius: 8px; 
            border: 1px solid #f5c6cb;
        }
        .commit {
            border-left: 4px solid #667eea;
            padding: 15px;
            margin: 10px 0;
            background: #f8f9fc;
            border-radius: 0 8px 8px 0;
        }
        .commit.high-risk { border-left-color: #dc3545; }
        .commit.medium-risk { border-left-color: #ffc107; }
        .risk-score {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 20px;
            color: white;
            font-weight: 600;
            font-size: 0.8rem;
        }
        .risk-high { background: #dc3545; }
        .risk-medium { background: #ffc107; color: #333; }
        .risk-low { background: #28a745; }
        .recommendations { margin-top: 20px; }
        .recommendation {
            padding: 12px 16px;
            margin: 8px 0;
            border-radius: 8px;
            border-left: 4px solid;
        }
        .recommendation.high { border-left-color: #dc3545; background: #f8d7da; }
        .recommendation.medium { border-left-color: #ffc107; background: #fff3cd; }
        .recommendation.low { border-left-color: #28a745; background: #d4edda; }
        .security-notice {
            background: #e3f2fd;
            border: 1px solid #2196f3;
            border-radius: 8px;
            padding: 15px;
            margin: 20px 0;
        }
        .security-notice h3 { color: #1976d2; margin-bottom: 10px; }
        @media (max-width: 768px) {
            .cards { grid-template-columns: 1fr; }
            .container { padding: 15px; }
            .header h1 { font-size: 2rem; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🕵️ Traversion</h1>
            <p>Post-incident forensics and code review analysis for development teams</p>
        </div>

        <div class="security-notice">
            <h3>🔒 Security Notice</h3>
            <p>This interface includes security protections against XSS, CSRF, and injection attacks. All inputs are sanitized and validated.</p>
        </div>

        <div class="cards">
            <div class="card">
                <h2>🚨 Incident Analysis</h2>
                <form id="incident-form">
                    <div class="form-group">
                        <label for="incident-time">Incident Time:</label>
                        <input type="datetime-local" id="incident-time" name="incidentTime" max="${new Date().toISOString().slice(0, 16)}">
                    </div>
                    <div class="form-group">
                        <label for="lookback-hours">Hours to Look Back:</label>
                        <input type="number" id="lookback-hours" name="lookbackHours" value="24" min="1" max="168">
                    </div>
                    <div class="form-group">
                        <label for="affected-files">Affected Files (comma-separated):</label>
                        <textarea id="affected-files" name="affectedFiles" rows="3" placeholder="server.js, config.yml, database.sql" maxlength="1000"></textarea>
                    </div>
                    <button type="submit" class="btn">🔍 Analyze Incident</button>
                </form>
            </div>

            <div class="card">
                <h2>📋 Pull Request Analysis</h2>
                <form id="pr-form">
                    <div class="form-group">
                        <label for="pr-owner">Repository Owner:</label>
                        <input type="text" id="pr-owner" name="owner" placeholder="octocat" required maxlength="100" pattern="[a-zA-Z0-9-]+">
                    </div>
                    <div class="form-group">
                        <label for="pr-repo">Repository Name:</label>
                        <input type="text" id="pr-repo" name="repo" placeholder="Hello-World" required maxlength="100" pattern="[a-zA-Z0-9._-]+">
                    </div>
                    <div class="form-group">
                        <label for="pr-number">PR Number:</label>
                        <input type="number" id="pr-number" name="number" placeholder="123" required min="1" max="999999">
                    </div>
                    <button type="submit" class="btn">📊 Analyze PR</button>
                </form>
            </div>
        </div>

        <div id="results" class="results">
            <div id="loading" class="loading">🔍 Analyzing...</div>
            <div id="content"></div>
        </div>
    </div>

    <script>
        // Content Security Policy compliant JavaScript
        (function() {
            'use strict';
            
            // Set current time as default (limited to now)
            const now = new Date();
            document.getElementById('incident-time').value = now.toISOString().slice(0, 16);

            // Input sanitization function
            function sanitizeHTML(str) {
                const div = document.createElement('div');
                div.textContent = str;
                return div.innerHTML;
            }

            // Validate and sanitize form inputs
            function validateAndSanitizeFormData(formData) {
                const data = {};
                
                for (let [key, value] of formData.entries()) {
                    if (typeof value === 'string') {
                        // Basic sanitization
                        value = value.trim();
                        if (value.length > 1000) {
                            throw new Error(\`\${key} is too long (max 1000 characters)\`);
                        }
                    }
                    data[key] = value;
                }
                
                return data;
            }

            // Secure fetch wrapper
            async function secureRequest(url, options = {}) {
                const defaultOptions = {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Requested-With': 'XMLHttpRequest'
                    }
                };
                
                return fetch(url, { ...defaultOptions, ...options });
            }

            // Show results securely
            function showResults() {
                document.getElementById('results').style.display = 'block';
                document.getElementById('results').scrollIntoView({ behavior: 'smooth' });
            }

            function showLoading() {
                document.getElementById('loading').style.display = 'block';
                document.getElementById('content').textContent = '';
            }

            function hideLoading() {
                document.getElementById('loading').style.display = 'none';
            }

            function showError(error) {
                hideLoading();
                const errorDiv = document.createElement('div');
                errorDiv.className = 'error';
                errorDiv.textContent = '❌ Error: ' + sanitizeHTML(error);
                
                const content = document.getElementById('content');
                content.textContent = '';
                content.appendChild(errorDiv);
            }

            // Secure incident form handler
            document.getElementById('incident-form').addEventListener('submit', async (e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                
                try {
                    const data = validateAndSanitizeFormData(formData);
                    
                    showResults();
                    showLoading();
                    
                    const response = await secureRequest('/api/analyze-incident', {
                        method: 'POST',
                        body: JSON.stringify({
                            incidentTime: data.incidentTime,
                            lookbackHours: parseInt(data.lookbackHours) || 24,
                            affectedFiles: data.affectedFiles ? data.affectedFiles.split(',').map(f => f.trim()) : []
                        })
                    });
                    
                    const result = await response.json();
                    if (response.ok) {
                        showIncidentResults(result);
                    } else {
                        showError(result.error || result.message || 'Unknown error');
                    }
                } catch (error) {
                    showError(error.message);
                }
            });

            // Secure PR form handler
            document.getElementById('pr-form').addEventListener('submit', async (e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                
                try {
                    const data = validateAndSanitizeFormData(formData);
                    
                    showResults();
                    showLoading();
                    
                    const response = await secureRequest('/api/analyze-pr', {
                        method: 'POST',
                        body: JSON.stringify(data)
                    });
                    
                    const result = await response.json();
                    if (response.ok) {
                        showPRResults(result);
                    } else {
                        showError(result.error || result.message || 'Unknown error');
                    }
                } catch (error) {
                    showError(error.message);
                }
            });

            function showIncidentResults(analysis) {
                hideLoading();
                
                const content = document.getElementById('content');
                content.textContent = '';
                
                const title = document.createElement('h2');
                title.textContent = '🚨 Incident Forensics Report';
                content.appendChild(title);
                
                const summary = document.createElement('div');
                summary.innerHTML = \`
                    <p><strong>Incident Time:</strong> \${sanitizeHTML(new Date(analysis.incidentTime).toLocaleString())}</p>
                    <p><strong>Analysis Window:</strong> \${sanitizeHTML(((new Date(analysis.lookbackPeriod.end) - new Date(analysis.lookbackPeriod.start)) / (1000 * 60 * 60)).toString())} hours</p>
                    <p><strong>Suspicious Commits:</strong> \${sanitizeHTML(analysis.suspiciousCommits?.length?.toString() || '0')}</p>
                \`;
                content.appendChild(summary);

                if (analysis.suspiciousCommits && analysis.suspiciousCommits.length > 0) {
                    const commitsTitle = document.createElement('h3');
                    commitsTitle.textContent = '🎯 Top Suspects:';
                    content.appendChild(commitsTitle);
                    
                    analysis.suspiciousCommits.slice(0, 5).forEach((commit, index) => {
                        const commitDiv = document.createElement('div');
                        const riskLevel = commit.riskScore > 0.7 ? 'high' : commit.riskScore > 0.4 ? 'medium' : 'low';
                        commitDiv.className = \`commit \${riskLevel}-risk\`;
                        
                        commitDiv.innerHTML = \`
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <strong>\${sanitizeHTML(commit.shortHash)}: \${sanitizeHTML(commit.message)}</strong>
                                <span class="risk-score risk-\${riskLevel}">\${Math.round(commit.riskScore * 100)}%</span>
                            </div>
                            <div style="margin: 8px 0; color: #666;">
                                👤 \${sanitizeHTML(commit.author)} | ⏰ \${sanitizeHTML(new Date(commit.date).toLocaleString())}
                            </div>
                            <div style="color: #666;">
                                📁 \${commit.filesChanged?.length || 0} files | +\${commit.linesChanged?.additions || 0}/-\${commit.linesChanged?.deletions || 0}
                            </div>
                            \${commit.riskFactors && commit.riskFactors.length > 0 ? 
                                \`<div style="margin-top: 8px;"><strong>Risk Factors:</strong> \${commit.riskFactors.map(f => sanitizeHTML(f)).join(', ')}</div>\` : ''
                            }
                        \`;
                        content.appendChild(commitDiv);
                    });

                    if (analysis.recommendations && analysis.recommendations.length > 0) {
                        const recsTitle = document.createElement('h3');
                        recsTitle.textContent = '💡 Recommendations:';
                        content.appendChild(recsTitle);
                        
                        const recsDiv = document.createElement('div');
                        recsDiv.className = 'recommendations';
                        
                        analysis.recommendations.forEach(rec => {
                            const recDiv = document.createElement('div');
                            recDiv.className = \`recommendation \${rec.priority}\`;
                            recDiv.innerHTML = \`<strong>\${sanitizeHTML(rec.category.toUpperCase())}:</strong> \${sanitizeHTML(rec.message)}\`;
                            recsDiv.appendChild(recDiv);
                        });
                        
                        content.appendChild(recsDiv);
                    }
                } else {
                    const noResults = document.createElement('p');
                    noResults.textContent = '✨ No suspicious commits found in the timeframe.';
                    noResults.style.color = '#666';
                    content.appendChild(noResults);
                }
            }

            function showPRResults(analysis) {
                hideLoading();
                
                const content = document.getElementById('content');
                content.textContent = '';
                
                const title = document.createElement('h2');
                title.textContent = '📋 Pull Request Analysis';
                content.appendChild(title);
                
                const riskLevel = analysis.riskScore > 0.7 ? 'high' : analysis.riskScore > 0.4 ? 'medium' : 'low';
                
                const summary = document.createElement('div');
                summary.innerHTML = \`
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                        <h3>PR #\${sanitizeHTML(analysis.pr?.number?.toString() || 'N/A')}: \${sanitizeHTML(analysis.pr?.title || 'N/A')}</h3>
                        <span class="risk-score risk-\${riskLevel}">\${Math.round(analysis.riskScore * 100)}%</span>
                    </div>
                    <p><strong>Author:</strong> \${sanitizeHTML(analysis.pr?.author || 'N/A')}</p>
                    <p><strong>Changes:</strong> +\${analysis.pr?.additions || 0} -\${analysis.pr?.deletions || 0} (\${analysis.pr?.changedFiles || 0} files)</p>
                \`;
                content.appendChild(summary);

                if (analysis.impactAssessment) {
                    const impactTitle = document.createElement('h3');
                    impactTitle.textContent = '📊 Impact Assessment:';
                    content.appendChild(impactTitle);
                    
                    const impactDiv = document.createElement('div');
                    impactDiv.innerHTML = \`
                        <ul>
                            <li><strong>Scope:</strong> \${sanitizeHTML(analysis.impactAssessment.scope || 'N/A')}</li>
                            <li><strong>Complexity:</strong> \${sanitizeHTML(analysis.impactAssessment.complexity || 'N/A')}</li>
                            \${analysis.impactAssessment.riskAreas?.length > 0 ? 
                                \`<li><strong>Risk Areas:</strong> \${analysis.impactAssessment.riskAreas.map(r => sanitizeHTML(r)).join(', ')}</li>\` : ''
                            }
                        </ul>
                    \`;
                    content.appendChild(impactDiv);
                }

                if (analysis.impactAssessment?.testingNeeds?.length > 0) {
                    const testingTitle = document.createElement('h3');
                    testingTitle.textContent = '🧪 Testing Recommendations:';
                    content.appendChild(testingTitle);
                    
                    const testingList = document.createElement('ul');
                    analysis.impactAssessment.testingNeeds.forEach(need => {
                        const li = document.createElement('li');
                        li.textContent = need;
                        testingList.appendChild(li);
                    });
                    content.appendChild(testingList);
                }

                if (analysis.recommendations?.length > 0) {
                    const recsTitle = document.createElement('h3');
                    recsTitle.textContent = '💡 Recommendations:';
                    content.appendChild(recsTitle);
                    
                    const recsDiv = document.createElement('div');
                    recsDiv.className = 'recommendations';
                    
                    analysis.recommendations.forEach(rec => {
                        const recDiv = document.createElement('div');
                        recDiv.className = \`recommendation \${rec.priority}\`;
                        recDiv.innerHTML = \`<strong>\${sanitizeHTML(rec.category?.toUpperCase() || 'N/A')}:</strong> \${sanitizeHTML(rec.message || 'N/A')}\`;
                        recsDiv.appendChild(recDiv);
                    });
                    
                    content.appendChild(recsDiv);
                }
            }
        })();
    </script>
</body>
</html>
    `;
  }

  start() {
    // Start cleanup timer for rate limiting
    this.auth.startCleanupTimer();
    
    this.app.listen(this.port, () => {
      console.log(`🌐 Secure Traversion web interface running at http://localhost:${this.port}`);
      console.log('🔒 Security features enabled: XSS protection, input sanitization, rate limiting');
    });
  }
}