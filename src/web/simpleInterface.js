import express from 'express';
import { logger } from '../utils/logger.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { IncidentAnalyzer } from '../forensics/incidentAnalyzer.js';
import { GitHubIntegration } from '../integrations/githubIntegration.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class SimpleWebInterface {
  constructor(port = 3335) {
    this.port = port;
    this.app = express();
    this.analyzer = new IncidentAnalyzer();
    this.github = new GitHubIntegration();
    this.setupRoutes();
  }

  setupRoutes() {
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, 'public')));

    // Main interface
    this.app.get('/', (req, res) => {
      res.send(this.renderMainPage());
    });

    // Incident analysis endpoint
    this.app.post('/api/analyze-incident', async (req, res) => {
      try {
        const { incidentTime, lookbackHours = 24, affectedFiles = [] } = req.body;
        
        const time = incidentTime ? new Date(incidentTime) : new Date();
        const files = typeof affectedFiles === 'string' ? affectedFiles.split(',').map(f => f.trim()) : affectedFiles;
        
        const analysis = await this.analyzer.analyzeIncident(time, lookbackHours, files);
        res.json(analysis);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // PR analysis endpoint
    this.app.post('/api/analyze-pr', async (req, res) => {
      try {
        const { owner, repo, number } = req.body;
        const analysis = await this.github.analyzePullRequest(owner, repo, number);
        res.json(analysis);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Health check
    this.app.get('/api/health', (req, res) => {
      res.json({ status: 'ok', service: 'traversion-forensics' });
    });
  }

  renderMainPage() {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
        .cli-examples {
            background: #f8f9fc;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
            border-left: 4px solid #667eea;
        }
        .cli-examples h3 { margin-bottom: 15px; color: #333; }
        .cli-examples code { 
            background: #2d3748; 
            color: #e2e8f0; 
            padding: 8px 12px; 
            border-radius: 4px; 
            display: block; 
            margin: 5px 0;
            font-family: 'Monaco', 'Menlo', monospace;
        }
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

        <div class="cards">
            <div class="card">
                <h2>🚨 Incident Analysis</h2>
                <form id="incident-form">
                    <div class="form-group">
                        <label for="incident-time">Incident Time:</label>
                        <input type="datetime-local" id="incident-time" name="incidentTime">
                    </div>
                    <div class="form-group">
                        <label for="lookback-hours">Hours to Look Back:</label>
                        <input type="number" id="lookback-hours" name="lookbackHours" value="24" min="1" max="168">
                    </div>
                    <div class="form-group">
                        <label for="affected-files">Affected Files (comma-separated):</label>
                        <textarea id="affected-files" name="affectedFiles" rows="3" placeholder="server.js, config.yml, database.sql"></textarea>
                    </div>
                    <button type="submit" class="btn">🔍 Analyze Incident</button>
                </form>
            </div>

            <div class="card">
                <h2>📋 Pull Request Analysis</h2>
                <form id="pr-form">
                    <div class="form-group">
                        <label for="pr-owner">Repository Owner:</label>
                        <input type="text" id="pr-owner" name="owner" placeholder="octocat" required>
                    </div>
                    <div class="form-group">
                        <label for="pr-repo">Repository Name:</label>
                        <input type="text" id="pr-repo" name="repo" placeholder="Hello-World" required>
                    </div>
                    <div class="form-group">
                        <label for="pr-number">PR Number:</label>
                        <input type="number" id="pr-number" name="number" placeholder="123" required>
                    </div>
                    <button type="submit" class="btn">📊 Analyze PR</button>
                </form>
            </div>
        </div>

        <div class="cli-examples">
            <h3>💻 CLI Usage Examples</h3>
            <code>npm install -g traversion</code>
            <code>trav incident --time "2 hours ago" --hours 48</code>
            <code>trav pr owner/repo/123 --comment</code>
            <code>trav analyze --since "2023-12-01" --files "server.js,config.yml"</code>
            <code>trav forensics  # Interactive mode</code>
        </div>

        <div id="results" class="results">
            <div id="loading" class="loading">🔍 Analyzing...</div>
            <div id="content"></div>
        </div>
    </div>

    <script>
        // Set current time as default
        document.getElementById('incident-time').value = new Date().toISOString().slice(0, 16);

        // Incident form handler
        document.getElementById('incident-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData);
            
            showResults();
            showLoading();
            
            try {
                const response = await fetch('/api/analyze-incident', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        incidentTime: data.incidentTime,
                        lookbackHours: parseInt(data.lookbackHours),
                        affectedFiles: data.affectedFiles
                    })
                });
                
                const result = await response.json();
                if (response.ok) {
                    showIncidentResults(result);
                } else {
                    showError(result.error);
                }
            } catch (error) {
                showError(error.message);
            }
        });

        // PR form handler
        document.getElementById('pr-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData);
            
            showResults();
            showLoading();
            
            try {
                const response = await fetch('/api/analyze-pr', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                
                const result = await response.json();
                if (response.ok) {
                    showPRResults(result);
                } else {
                    showError(result.error);
                }
            } catch (error) {
                showError(error.message);
            }
        });

        function showResults() {
            document.getElementById('results').style.display = 'block';
            document.getElementById('results').scrollIntoView({ behavior: 'smooth' });
        }

        function showLoading() {
            document.getElementById('loading').style.display = 'block';
            document.getElementById('content').innerHTML = '';
        }

        function hideLoading() {
            document.getElementById('loading').style.display = 'none';
        }

        function showError(error) {
            hideLoading();
            document.getElementById('content').innerHTML = \`
                <div class="error">❌ Error: \${error}</div>
            \`;
        }

        function showIncidentResults(analysis) {
            hideLoading();
            
            let html = \`
                <h2>🚨 Incident Forensics Report</h2>
                <p><strong>Incident Time:</strong> \${new Date(analysis.incidentTime).toLocaleString()}</p>
                <p><strong>Analysis Window:</strong> \${(analysis.lookbackPeriod.end - analysis.lookbackPeriod.start) / (1000 * 60 * 60)} hours</p>
                <p><strong>Suspicious Commits:</strong> \${analysis.suspiciousCommits.length}</p>
            \`;

            if (analysis.suspiciousCommits.length > 0) {
                html += '<h3>🎯 Top Suspects:</h3>';
                analysis.suspiciousCommits.slice(0, 5).forEach((commit, index) => {
                    const riskLevel = commit.riskScore > 0.7 ? 'high' : commit.riskScore > 0.4 ? 'medium' : 'low';
                    const riskClass = \`risk-\${riskLevel}\`;
                    
                    html += \`
                        <div class="commit \${riskLevel}-risk">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <strong>\${commit.shortHash}: \${commit.message}</strong>
                                <span class="risk-score \${riskClass}">\${(commit.riskScore * 100).toFixed(0)}%</span>
                            </div>
                            <div style="margin: 8px 0; color: #666;">
                                👤 \${commit.author} | ⏰ \${new Date(commit.date).toLocaleString()}
                            </div>
                            <div style="color: #666;">
                                📁 \${commit.filesChanged.length} files | +\${commit.linesChanged.additions}/-\${commit.linesChanged.deletions}
                            </div>
                            \${commit.riskFactors.length > 0 ? \`<div style="margin-top: 8px;"><strong>Risk Factors:</strong> \${commit.riskFactors.join(', ')}</div>\` : ''}
                        </div>
                    \`;
                });

                if (analysis.recommendations.length > 0) {
                    html += '<div class="recommendations"><h3>💡 Recommendations:</h3>';
                    analysis.recommendations.forEach(rec => {
                        html += \`<div class="recommendation \${rec.priority}"><strong>\${rec.category.toUpperCase()}:</strong> \${rec.message}</div>\`;
                    });
                    html += '</div>';
                }
            }

            document.getElementById('content').innerHTML = html;
        }

        function showPRResults(analysis) {
            hideLoading();
            
            const riskLevel = analysis.riskScore > 0.7 ? 'high' : analysis.riskScore > 0.4 ? 'medium' : 'low';
            const riskClass = \`risk-\${riskLevel}\`;
            
            let html = \`
                <h2>📋 Pull Request Analysis</h2>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                    <h3>PR #\${analysis.pr.number}: \${analysis.pr.title}</h3>
                    <span class="risk-score \${riskClass}">\${(analysis.riskScore * 100).toFixed(0)}%</span>
                </div>
                <p><strong>Author:</strong> \${analysis.pr.author}</p>
                <p><strong>Changes:</strong> +\${analysis.pr.additions} -\${analysis.pr.deletions} (\${analysis.pr.changedFiles} files)</p>
                
                <h3>📊 Impact Assessment:</h3>
                <ul>
                    <li><strong>Scope:</strong> \${analysis.impactAssessment.scope}</li>
                    <li><strong>Complexity:</strong> \${analysis.impactAssessment.complexity}</li>
                    \${analysis.impactAssessment.riskAreas.length > 0 ? \`<li><strong>Risk Areas:</strong> \${analysis.impactAssessment.riskAreas.join(', ')}</li>\` : ''}
                </ul>
                
                <h3>🧪 Testing Recommendations:</h3>
                <ul>
                    \${analysis.impactAssessment.testingNeeds.map(need => \`<li>\${need}</li>\`).join('')}
                </ul>
            \`;

            if (analysis.recommendations.length > 0) {
                html += '<div class="recommendations"><h3>💡 Recommendations:</h3>';
                analysis.recommendations.forEach(rec => {
                    html += \`<div class="recommendation \${rec.priority}"><strong>\${rec.category.toUpperCase()}:</strong> \${rec.message}</div>\`;
                });
                html += '</div>';
            }

            document.getElementById('content').innerHTML = html;
        }
    </script>
</body>
</html>
    `;
  }

  start() {
    this.app.listen(this.port, () => {
      logger.info(`🌐 Traversion web interface running at http://localhost:${this.port}`);
      logger.info('📝 Use this for quick incident analysis and PR reviews');
    });
  }
}