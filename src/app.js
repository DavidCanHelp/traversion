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
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import logger from './utils/logger.js';
import config from './config/environment.js';
import { RiskAnalyzer } from './utils/riskAnalyzer.js';
import causalityService from './services/causalityService.js';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';

/**
 * Traversion - Open Source Incident Analysis Platform
 * Real-time post-incident forensics and impact analysis for development teams
 */
class TraversionApp {
  constructor(port = null) {
    this.port = port || config.get('app.port');
    this.app = express();
    this.server = createServer(this.app);
    this.git = simpleGit();
    this.riskAnalyzer = new RiskAnalyzer();
    this.wsClients = new Set();

    this.setupDataDirectory();
    this.setupDatabase();
    this.setupSwagger();
    this.setupMiddleware();
    this.setupWebSocket();
    this.setupRoutes();
    this.startRealtimeFeatures();
  }

  setupSwagger() {
    try {
      // Get current directory
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);

      // Load OpenAPI spec
      const swaggerDocument = YAML.load(path.join(__dirname, '../swagger.yaml'));

      // Configure Swagger UI
      const options = {
        customCss: `
          .swagger-ui .topbar { display: none }
          .swagger-ui .info .title { color: #2c3e50; }
          .swagger-ui .info .description { font-size: 16px; }
        `,
        customSiteTitle: "Traversion API Documentation",
        swaggerOptions: {
          persistAuthorization: true,
          displayRequestDuration: true,
          docExpansion: 'list',
          filter: true
        }
      };

      // Serve documentation
      this.app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, options));

      logger.info('Swagger documentation initialized');
    } catch (error) {
      logger.warn('Swagger setup failed (non-critical)', { error: error.message });
    }
  }

  setupDataDirectory() {
    const dataDir = './.traversion';
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
      logger.info(`Created data directory: ${dataDir}`);
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

      logger.info('Database initialized');
    } catch (error) {
      logger.error('Database setup failed', { error: error.message, stack: error.stack });
    }
  }

  setupWebSocket() {
    this.wss = new WebSocketServer({
      server: this.server,
      path: '/ws'
    });

    this.wss.on('connection', (ws, req) => {
      const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      ws.clientId = clientId;
      ws.isAlive = true;
      this.wsClients.add(ws);

      logger.info('WebSocket client connected', {
        clientId,
        totalClients: this.wsClients.size,
        ip: req.socket.remoteAddress
      });

      // Send welcome message
      ws.send(JSON.stringify({
        type: 'connected',
        clientId,
        timestamp: new Date().toISOString(),
        message: 'Welcome to Traversion Real-time Updates'
      }));

      // Handle client messages
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          this.handleWebSocketMessage(ws, message);
        } catch (error) {
          logger.error('Invalid WebSocket message', { error: error.message });
        }
      });

      // Handle ping/pong for connection health
      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('close', () => {
        this.wsClients.delete(ws);
        logger.info('WebSocket client disconnected', {
          clientId,
          remainingClients: this.wsClients.size
        });
      });

      ws.on('error', (error) => {
        logger.error('WebSocket error', { clientId, error: error.message });
      });
    });

    // Keep connections alive
    this.wsHeartbeat = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (!ws.isAlive) {
          this.wsClients.delete(ws);
          return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);

    logger.info('WebSocket server initialized');
  }

  handleWebSocketMessage(ws, message) {
    const { type, data } = message;

    switch (type) {
      case 'subscribe':
        ws.subscriptions = ws.subscriptions || new Set();
        ws.subscriptions.add(data.channel);
        ws.send(JSON.stringify({
          type: 'subscribed',
          channel: data.channel
        }));
        break;

      case 'unsubscribe':
        if (ws.subscriptions) {
          ws.subscriptions.delete(data.channel);
        }
        break;

      case 'ping':
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        break;

      default:
        logger.debug('Unknown WebSocket message type', { type });
    }
  }

  broadcast(data, channel = null) {
    const message = JSON.stringify({
      ...data,
      timestamp: new Date().toISOString()
    });

    this.wss.clients.forEach((client) => {
      if (client.readyState === 1) { // WebSocket.OPEN
        // If channel specified, only send to subscribed clients
        if (channel && client.subscriptions && !client.subscriptions.has(channel)) {
          return;
        }
        client.send(message);
      }
    });
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
      logger.logApiRequest(req.method, req.path, 0, 0);
      rateLimiter.logRequest(req, false);
      next();
    });
  }

  startRealtimeFeatures() {
    // Monitor Git repository for changes
    if (config.get('features.realtime')) {
      setInterval(async () => {
        try {
          const status = await this.git.status();
          if (status.modified.length > 0 || status.created.length > 0) {
            this.broadcast({
              type: 'git_change',
              data: {
                modified: status.modified,
                created: status.created,
                deleted: status.deleted,
                branch: status.current
              }
            }, 'git');
          }
        } catch (error) {
          logger.debug('Git status check failed', { error: error.message });
        }
      }, 5000); // Check every 5 seconds

      logger.info('Real-time Git monitoring started');
    }

    // Send metrics updates
    setInterval(() => {
      const metrics = {
        type: 'metrics',
        data: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          clients: this.wsClients.size,
          timestamp: Date.now()
        }
      };
      this.broadcast(metrics, 'metrics');
    }, 10000); // Every 10 seconds
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

        const timeline = await Promise.all(log.all.map(async commit => {
          // Get file changes for the commit
          const diff = await this.git.show([commit.hash, '--stat']);
          const filesChanged = diff.split('\n')
            .filter(line => line.includes('|'))
            .map(line => line.split('|')[0].trim());

          const riskAnalysis = this.riskAnalyzer.calculateCommitRisk({
            date: commit.date,
            message: commit.message,
            filesChanged,
            linesChanged: commit.body?.length || 0
          });

          return {
            hash: commit.hash,
            message: commit.message,
            author: commit.author_name,
            date: commit.date,
            risk: riskAnalysis.score,
            riskLevel: riskAnalysis.level,
            riskFactors: riskAnalysis.factors
          };
        }));

        res.json({
          success: true,
          commits: timeline,
          total: log.total
        });
      } catch (error) {
        logger.error('Timeline error', { error: error.message, stack: error.stack });
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
        const suspiciousCommits = await Promise.all(
          log.all.map(async commit => {
            // Get file changes for better risk analysis
            const diff = await this.git.show([commit.hash, '--stat']);
            const filesChanged = diff.split('\n')
              .filter(line => line.includes('|'))
              .map(line => line.split('|')[0].trim());

            const riskAnalysis = this.riskAnalyzer.calculateCommitRisk({
              date: commit.date,
              message: commit.message,
              filesChanged,
              linesChanged: commit.body?.length || 0
            }, {
              affectedFiles: req.body.files
            });

            // Calculate incident proximity score
            const commitTime = new Date(commit.date);
            const timeDiff = Math.abs(incidentTime - commitTime);
            const hoursDiff = timeDiff / (1000 * 60 * 60);

            let proximityBoost = 0;
            if (hoursDiff < 1) proximityBoost = 0.5;
            else if (hoursDiff < 6) proximityBoost = 0.3;
            else if (hoursDiff < 24) proximityBoost = 0.1;

            return {
              ...commit,
              riskScore: Math.min(riskAnalysis.score + proximityBoost, 1.0),
              risk: riskAnalysis.score,
              riskLevel: riskAnalysis.level,
              riskFactors: riskAnalysis.factors,
              proximityHours: hoursDiff
            };
          })
        );

        // Filter and sort suspicious commits
        const filteredCommits = suspiciousCommits
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
          JSON.stringify({ suspiciousCommits: filteredCommits })
        );

        // Perform causality analysis if enabled
        let causalityAnalysis = null;
        if (config.get('features.ml')) {
          try {
            causalityAnalysis = await causalityService.analyzeCommitCausality(
              filteredCommits,
              incidentTime
            );

            // Get additional insights
            const insights = causalityService.getIncidentInsights(incidentId);
            causalityAnalysis.insights = insights;
          } catch (error) {
            logger.warn('Causality analysis failed', { error: error.message });
          }
        }

        // Broadcast incident to WebSocket clients
        this.broadcast({
          type: 'new_incident',
          data: {
            incidentId,
            incidentTime: incidentTime.toISOString(),
            suspiciousCommits: filteredCommits.length,
            topRisk: filteredCommits[0]?.riskScore || 0,
            analyzedBy: req.user?.username || 'anonymous'
          }
        }, 'incidents');

        res.json({
          success: true,
          incidentId,
          incidentTime: incidentTime.toISOString(),
          suspiciousCommits: filteredCommits,
          recommendations: this.generateRecommendations(filteredCommits),
          causalityAnalysis
        });

      } catch (error) {
        logger.error('Incident analysis error', { error: error.message, stack: error.stack });
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

    // Serve static files (including dashboard)
    this.app.use('/public', express.static('public'));

    // Dashboard route
    this.app.get('/dashboard', (req, res) => {
      res.sendFile(path.join(process.cwd(), 'public', 'dashboard.html'));
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

          <h2>🚀 Features</h2>

          <div class="endpoint">
            <span class="method" style="background: #10b981">NEW</span> <a href="/dashboard" target="_blank"><code>/dashboard</code></a>
            <p>📊 Real-time Dashboard with WebSocket Updates</p>
          </div>

          <div class="endpoint">
            <span class="method">DOCS</span> <a href="/api-docs" target="_blank"><code>/api-docs</code></a>
            <p>📚 Interactive API Documentation (Swagger UI)</p>
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
      logger.error('Unhandled error', { error: err.message, stack: err.stack });
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
      this.server.listen(this.port, (err) => {
        if (err) {
          logger.error('Failed to start server', { error: err.message });
          reject(err);
        } else {
          logger.info('═════════════════════════════════════════');
          logger.info('        Traversion Started                ');
          logger.info('═════════════════════════════════════════');
          logger.info(`Web Interface: http://localhost:${this.port}`);
          logger.info('Health Check:  /health');
          logger.info('API Info:      /api/info');
          logger.info('Timeline:      /api/timeline');
          logger.info('API Docs:      /api-docs');
          logger.info('WebSocket:     ws://localhost:' + this.port + '/ws');
          logger.info('═════════════════════════════════════════');
          resolve(this.server);
        }
      });
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      logger.info('Server stopped');
    }
    if (this.db) {
      this.db.close();
      logger.info('Database closed');
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
    logger.warn('SIGTERM received, shutting down...');
    app.stop();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    logger.warn('SIGINT received, shutting down...');
    app.stop();
    process.exit(0);
  });
}