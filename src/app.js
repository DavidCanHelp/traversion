import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import Database from 'better-sqlite3';
import simpleGit from 'simple-git';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import auth from './middleware/auth.js';
import rateLimiter from './middleware/rateLimiter.js';
import validation from './middleware/validation.js';

/**
 * Minimal working application
 * This is a simplified version to get the app running
 */
class TraversionApp {
  constructor(port = 3335) {
    this.port = port;
    this.app = express();
    this.git = simpleGit();
    this.setupDataDirectory();
    this.setupDatabase();
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupDataDirectory() {
    const dataDir = './.traversion';
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
      console.log('Created data directory:', dataDir);
    }
  }

  setupDatabase() {
    try {
      this.db = new Database('./.traversion/database.db');

      // Create basic tables
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS incidents (
          id TEXT PRIMARY KEY,
          title TEXT,
          description TEXT,
          severity TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          resolved_at DATETIME,
          metadata TEXT
        );

        CREATE TABLE IF NOT EXISTS deployments (
          id TEXT PRIMARY KEY,
          commit_hash TEXT,
          author TEXT,
          message TEXT,
          risk_score REAL,
          deployed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          status TEXT,
          metadata TEXT
        );

        CREATE TABLE IF NOT EXISTS risk_analysis (
          id TEXT PRIMARY KEY,
          deployment_id TEXT,
          commit_hash TEXT,
          risk_score REAL,
          risk_factors TEXT,
          analyzed_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      console.log('Database initialized');
    } catch (error) {
      console.error('Database setup failed:', error);
    }
  }

  setupMiddleware() {
    // Security
    this.app.use(helmet({
      contentSecurityPolicy: false // Disable for development
    }));

    // CORS
    this.app.use(cors());

    // Compression
    this.app.use(compression());

    // Rate limiting
    this.app.use(rateLimiter.general());

    // Body parsing
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Optional auth for logging
    this.app.use(auth.optionalAuth());

    // Request logging
    this.app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} ${req.method} ${req.path} ${req.user ? `[${req.user.username}]` : '[anonymous]'}`);
      rateLimiter.logRequest(req, false);
      next();
    });
  }

  setupRoutes() {
    // ===== Public Routes =====

    // Health check (public)
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString()
      });
    });

    // ===== Authentication Routes =====

    // Register new user
    this.app.post('/api/auth/register', rateLimiter.auth(), async (req, res) => {
      try {
        const { username, email, password } = req.body;

        if (!username || !email || !password) {
          return res.status(400).json({ error: 'Missing required fields' });
        }

        const user = await auth.register(username, email, password);
        res.json({ success: true, user });

      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Login
    this.app.post('/api/auth/login', rateLimiter.auth(), async (req, res) => {
      try {
        const { username, password } = req.body;

        if (!username || !password) {
          return res.status(400).json({ error: 'Missing credentials' });
        }

        const result = await auth.login(username, password);
        res.json({ success: true, ...result });

      } catch (error) {
        res.status(401).json({ error: error.message });
      }
    });

    // Logout
    this.app.post('/api/auth/logout', auth.requireAuth(), async (req, res) => {
      try {
        const token = req.headers.authorization?.slice(7);
        await auth.logout(token);
        res.json({ success: true, message: 'Logged out' });

      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Get current user
    this.app.get('/api/auth/me', auth.requireAuth(), (req, res) => {
      res.json({ user: req.user });
    });

    // Generate API key
    this.app.post('/api/auth/api-key', auth.requireAuth(), async (req, res) => {
      try {
        const { name } = req.body;
        const apiKey = await auth.generateApiKey(req.user.id, name);
        res.json({ success: true, apiKey });

      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // ===== Public API Routes =====

    // Basic API info (public)
    this.app.get('/api/info', (req, res) => {
      res.json({
        app: 'Traversion',
        version: '0.1.0',
        status: 'running',
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
        authenticated: !!req.user
      });
    });

    // ===== Protected API Routes =====

    // Git timeline (requires authentication)
    this.app.get('/api/timeline', rateLimiter.read(), auth.requireAuth(), async (req, res) => {
      try {
        const log = await this.git.log({ n: 20 });

        const timeline = log.all.map(commit => ({
          hash: commit.hash,
          message: commit.message,
          author: commit.author_name,
          date: commit.date,
          risk: this.calculateBasicRisk(commit)
        }));

        res.json({
          success: true,
          commits: timeline,
          total: log.total
        });
      } catch (error) {
        console.error('Timeline error:', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Incident analysis (requires authentication)
    this.app.post('/api/incident', rateLimiter.analysis(), auth.requireAuth(), async (req, res) => {
      try {
        const { time, hours = 24 } = req.body;
        const incidentTime = time ? new Date(time) : new Date();

        // Get commits around incident time
        const log = await this.git.log({
          '--before': incidentTime.toISOString(),
          n: 50
        });

        // Analyze commits for risk
        const suspiciousCommits = log.all
          .map(commit => ({
            ...commit,
            riskScore: this.calculateIncidentRisk(commit, incidentTime),
            risk: this.calculateBasicRisk(commit)
          }))
          .filter(commit => commit.riskScore > 0.3)
          .sort((a, b) => b.riskScore - a.riskScore)
          .slice(0, 5);

        // Store incident
        const incidentId = `inc_${Date.now()}`;
        const stmt = this.db.prepare(`
          INSERT INTO incidents (id, title, description, severity, metadata)
          VALUES (?, ?, ?, ?, ?)
        `);

        stmt.run(
          incidentId,
          'Incident Analysis',
          `Analysis for incident at ${incidentTime.toISOString()}`,
          'medium',
          JSON.stringify({ suspiciousCommits })
        );

        res.json({
          success: true,
          incidentId,
          incidentTime: incidentTime.toISOString(),
          suspiciousCommits,
          recommendations: this.generateRecommendations(suspiciousCommits)
        });

      } catch (error) {
        console.error('Incident analysis error:', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // List recent incidents (requires authentication)
    this.app.get('/api/incidents', rateLimiter.read(), auth.requireAuth(), (req, res) => {
      try {
        const incidents = this.db.prepare(`
          SELECT * FROM incidents
          ORDER BY created_at DESC
          LIMIT 20
        `).all();

        res.json({
          success: true,
          incidents
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Basic web interface
    this.app.get('/', (req, res) => {
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Traversion</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              max-width: 1200px;
              margin: 50px auto;
              padding: 20px;
            }
            h1 { color: #333; }
            .status {
              padding: 20px;
              background: #f0f0f0;
              border-radius: 5px;
              margin: 20px 0;
            }
            .endpoint {
              margin: 10px 0;
              padding: 10px;
              background: white;
              border: 1px solid #ddd;
              border-radius: 3px;
            }
            .method {
              display: inline-block;
              padding: 2px 8px;
              background: #007bff;
              color: white;
              border-radius: 3px;
              font-size: 12px;
              font-weight: bold;
            }
          </style>
        </head>
        <body>
          <h1>🕵️ Traversion</h1>
          <p>Post-incident forensics and impact analysis for development teams</p>

          <div class="status">
            <h2>System Status</h2>
            <p>✅ Application is running</p>
            <p>Port: ${this.port}</p>
            <p>Environment: ${process.env.NODE_ENV || 'development'}</p>
            <p>Uptime: ${Math.floor(process.uptime() / 60)} minutes</p>
          </div>

          <h2>API Endpoints</h2>

          <div class="endpoint">
            <span class="method">GET</span> <code>/health</code>
            <p>Health check endpoint</p>
          </div>

          <div class="endpoint">
            <span class="method">GET</span> <code>/api/info</code>
            <p>Application information</p>
          </div>

          <div class="endpoint">
            <span class="method">GET</span> <code>/api/timeline</code>
            <p>Git commit timeline with risk analysis</p>
          </div>

          <div class="endpoint">
            <span class="method">POST</span> <code>/api/incident</code>
            <p>Analyze incident and find suspicious commits</p>
          </div>

          <div class="endpoint">
            <span class="method">GET</span> <code>/api/incidents</code>
            <p>List recent incidents</p>
          </div>

          <h2>Quick Test</h2>
          <p>Test the API: <a href="/api/timeline">/api/timeline</a></p>
        </body>
        </html>
      `);
    });

    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({
        error: 'Not found',
        path: req.path
      });
    });

    // Error handler
    this.app.use((err, req, res, next) => {
      console.error('Error:', err);
      res.status(500).json({
        error: err.message || 'Internal server error'
      });
    });
  }

  calculateBasicRisk(commit) {
    let risk = 0;

    // Check message for risky keywords
    const riskyKeywords = ['hotfix', 'urgent', 'emergency', 'critical', 'fix', 'bug'];
    const message = commit.message.toLowerCase();

    if (riskyKeywords.some(keyword => message.includes(keyword))) {
      risk += 0.3;
    }

    // Check time (off-hours)
    const hour = new Date(commit.date).getHours();
    if (hour < 6 || hour > 22) {
      risk += 0.2;
    }

    // Weekend
    const day = new Date(commit.date).getDay();
    if (day === 0 || day === 6) {
      risk += 0.2;
    }

    return Math.min(risk, 1.0);
  }

  calculateIncidentRisk(commit, incidentTime) {
    let risk = this.calculateBasicRisk(commit);

    // Time proximity to incident
    const commitTime = new Date(commit.date);
    const timeDiff = Math.abs(incidentTime - commitTime);
    const hoursDiff = timeDiff / (1000 * 60 * 60);

    if (hoursDiff < 1) {
      risk += 0.5;
    } else if (hoursDiff < 6) {
      risk += 0.3;
    } else if (hoursDiff < 24) {
      risk += 0.1;
    }

    return Math.min(risk, 1.0);
  }

  generateRecommendations(suspiciousCommits) {
    const recommendations = [];

    if (suspiciousCommits.length > 0) {
      const topCommit = suspiciousCommits[0];

      recommendations.push({
        priority: 'high',
        action: 'investigate',
        description: `Review commit ${topCommit.hash.substr(0, 7)}: ${topCommit.message}`
      });

      if (topCommit.riskScore > 0.7) {
        recommendations.push({
          priority: 'high',
          action: 'rollback',
          description: `Consider rolling back commit ${topCommit.hash.substr(0, 7)}`
        });
      }
    }

    recommendations.push({
      priority: 'medium',
      action: 'monitor',
      description: 'Check application logs and metrics for anomalies'
    });

    return recommendations;
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, (err) => {
        if (err) {
          console.error('Failed to start server:', err);
          reject(err);
        } else {
          console.log(`
╔════════════════════════════════════════╗
║         Traversion Started             ║
╠════════════════════════════════════════╣
║  Web Interface: http://localhost:${this.port}  ║
║  Health Check:  /health                ║
║  API Info:      /api/info              ║
║  Timeline:      /api/timeline          ║
╚════════════════════════════════════════╝
          `);
          resolve(this.server);
        }
      });
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      console.log('Server stopped');
    }
    if (this.db) {
      this.db.close();
      console.log('Database closed');
    }
  }
}

// Export the app class
export default TraversionApp;

// Start if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const app = new TraversionApp(process.env.PORT || 3335);
  app.start().catch(console.error);

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down...');
    app.stop();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down...');
    app.stop();
    process.exit(0);
  });
}