import express from 'express';
import { WebSocketServer } from 'ws';
import { IncidentAnalyzer } from '../forensics/incidentAnalyzer.js';
import { AuthMiddleware } from '../security/authMiddleware.js';
import { InputSanitizer } from '../security/inputSanitizer.js';
import logger from '../utils/logger.js';

/**
 * Real-Time Incident Dashboard
 * 
 * Provides live monitoring of incidents, team workloads, and system health
 * with WebSocket updates and responsive web interface.
 */
export class RealTimeDashboard {
  constructor(options = {}) {
    this.port = options.port || 3340;
    this.app = express();
    this.incidents = new Map();
    this.teams = new Map();
    this.metrics = {
      activeIncidents: 0,
      resolvedToday: 0,
      averageMTTR: 0,
      highSeverityCount: 0
    };
    
    this.auth = new AuthMiddleware(options.auth || {});
    this.analyzer = new IncidentAnalyzer();
    this.wsClients = new Set();
    
    this.setupMiddleware();
    this.setupRoutes();
    this.startMetricsCollection();
  }

  setupMiddleware() {
    // Security middleware
    this.app.use(this.auth.securityHeaders);
    this.app.use(this.auth.sanitizeRequest);
    this.app.use(express.json({ limit: '1mb' }));
    
    // Rate limiting for dashboard endpoints
    this.app.use('/api/', this.auth.rateLimit({
      windowMs: 60000, // 1 minute
      max: 200 // Higher limit for dashboard updates
    }));
  }

  setupRoutes() {
    // Dashboard main page
    this.app.get('/', (req, res) => {
      res.send(this.renderDashboard());
    });

    // Get current dashboard data
    this.app.get('/api/dashboard/overview', this.auth.verifyToken, (req, res) => {
      try {
        const overview = this.getDashboardOverview(req.user.tenantId);
        res.json({
          success: true,
          data: overview,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error('Dashboard overview error', { error: error.message });
        res.status(500).json({ success: false, error: 'Failed to get overview' });
      }
    });

    // Get active incidents
    this.app.get('/api/dashboard/incidents', this.auth.verifyToken, (req, res) => {
      try {
        const { status, severity, assignee } = req.query;
        const incidents = this.getIncidents(req.user.tenantId, { status, severity, assignee });
        
        res.json({
          success: true,
          incidents: incidents.map(incident => this.sanitizeIncident(incident)),
          count: incidents.length
        });
      } catch (error) {
        logger.error('Get incidents error', { error: error.message });
        res.status(500).json({ success: false, error: 'Failed to get incidents' });
      }
    });

    // Update incident status
    this.app.patch('/api/dashboard/incidents/:incidentId', this.auth.verifyToken, async (req, res) => {
      try {
        const incidentId = InputSanitizer.sanitizeTenantId(req.params.incidentId);
        const updates = this.sanitizeIncidentUpdates(req.body);
        
        const incident = await this.updateIncident(incidentId, updates, req.user);
        
        if (incident) {
          this.broadcastIncidentUpdate(incident);
          res.json({ success: true, incident: this.sanitizeIncident(incident) });
        } else {
          res.status(404).json({ success: false, error: 'Incident not found' });
        }
      } catch (error) {
        logger.error('Update incident error', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Team workload endpoint
    this.app.get('/api/dashboard/workload', this.auth.verifyToken, (req, res) => {
      try {
        const workload = this.getTeamWorkload(req.user.tenantId);
        res.json({ success: true, workload });
      } catch (error) {
        logger.error('Team workload error', { error: error.message });
        res.status(500).json({ success: false, error: 'Failed to get workload' });
      }
    });

    // SLA status endpoint
    this.app.get('/api/dashboard/sla', this.auth.verifyToken, (req, res) => {
      try {
        const slaStatus = this.getSLAStatus(req.user.tenantId);
        res.json({ success: true, sla: slaStatus });
      } catch (error) {
        logger.error('SLA status error', { error: error.message });
        res.status(500).json({ success: false, error: 'Failed to get SLA status' });
      }
    });

    // Create new incident
    this.app.post('/api/dashboard/incidents', this.auth.verifyToken, async (req, res) => {
      try {
        const incidentData = this.sanitizeNewIncident(req.body);
        incidentData.tenantId = req.user.tenantId;
        incidentData.createdBy = req.user.userId;
        incidentData.createdAt = new Date();
        
        const incident = await this.createIncident(incidentData);
        this.broadcastIncidentUpdate(incident);
        
        res.status(201).json({ 
          success: true, 
          incident: this.sanitizeIncident(incident) 
        });
      } catch (error) {
        logger.error('Create incident error', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });
  }

  getDashboardOverview(tenantId) {
    const tenantIncidents = Array.from(this.incidents.values())
      .filter(incident => incident.tenantId === tenantId);

    const active = tenantIncidents.filter(i => i.status === 'active');
    const resolvedToday = tenantIncidents.filter(i => 
      i.status === 'resolved' && 
      new Date(i.resolvedAt).toDateString() === new Date().toDateString()
    );

    const highSeverity = active.filter(i => ['critical', 'high'].includes(i.severity));
    
    // Calculate average MTTR for resolved incidents
    const resolvedWithTimes = tenantIncidents.filter(i => 
      i.status === 'resolved' && i.createdAt && i.resolvedAt
    );
    
    const totalResolutionTime = resolvedWithTimes.reduce((sum, incident) => {
      return sum + (new Date(incident.resolvedAt) - new Date(incident.createdAt));
    }, 0);
    
    const averageMTTR = resolvedWithTimes.length > 0 
      ? Math.round(totalResolutionTime / resolvedWithTimes.length / 60000) // minutes
      : 0;

    return {
      metrics: {
        activeIncidents: active.length,
        resolvedToday: resolvedToday.length,
        averageMTTR,
        highSeverityCount: highSeverity.length
      },
      recentIncidents: active.slice(0, 10).map(i => this.sanitizeIncident(i)),
      slaBreaches: this.getSLABreaches(tenantId),
      teamWorkload: this.getTeamWorkload(tenantId)
    };
  }

  getIncidents(tenantId, filters = {}) {
    let incidents = Array.from(this.incidents.values())
      .filter(incident => incident.tenantId === tenantId);

    if (filters.status) {
      incidents = incidents.filter(i => i.status === filters.status);
    }
    
    if (filters.severity) {
      incidents = incidents.filter(i => i.severity === filters.severity);
    }
    
    if (filters.assignee) {
      incidents = incidents.filter(i => i.assignedTo === filters.assignee);
    }

    return incidents.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  getTeamWorkload(tenantId) {
    const activeIncidents = this.getIncidents(tenantId, { status: 'active' });
    const workload = {};

    activeIncidents.forEach(incident => {
      if (incident.assignedTo) {
        if (!workload[incident.assignedTo]) {
          workload[incident.assignedTo] = {
            userId: incident.assignedTo,
            activeIncidents: 0,
            highSeverity: 0,
            avgAge: 0
          };
        }
        
        workload[incident.assignedTo].activeIncidents++;
        
        if (['critical', 'high'].includes(incident.severity)) {
          workload[incident.assignedTo].highSeverity++;
        }
      }
    });

    // Calculate average age for each person's incidents
    Object.keys(workload).forEach(userId => {
      const userIncidents = activeIncidents.filter(i => i.assignedTo === userId);
      const totalAge = userIncidents.reduce((sum, incident) => {
        return sum + (Date.now() - new Date(incident.createdAt).getTime());
      }, 0);
      
      workload[userId].avgAge = userIncidents.length > 0 
        ? Math.round(totalAge / userIncidents.length / 3600000) // hours
        : 0;
    });

    return Object.values(workload);
  }

  getSLAStatus(tenantId) {
    const activeIncidents = this.getIncidents(tenantId, { status: 'active' });
    const slaBreaches = [];
    const warningThreshold = 0.8; // 80% of SLA time

    activeIncidents.forEach(incident => {
      const slaMinutes = this.getSLATimeLimit(incident.severity);
      const age = Date.now() - new Date(incident.createdAt).getTime();
      const ageMinutes = age / 60000;
      const slaProgress = ageMinutes / slaMinutes;

      if (slaProgress > 1) {
        slaBreaches.push({
          incidentId: incident.id,
          title: incident.title,
          severity: incident.severity,
          overageMinutes: Math.round(ageMinutes - slaMinutes),
          assignedTo: incident.assignedTo
        });
      } else if (slaProgress > warningThreshold) {
        slaBreaches.push({
          incidentId: incident.id,
          title: incident.title,
          severity: incident.severity,
          warningMinutes: Math.round(slaMinutes - ageMinutes),
          assignedTo: incident.assignedTo,
          warning: true
        });
      }
    });

    return {
      breaches: slaBreaches.filter(b => !b.warning),
      warnings: slaBreaches.filter(b => b.warning),
      compliance: activeIncidents.length > 0 
        ? Math.round((1 - slaBreaches.filter(b => !b.warning).length / activeIncidents.length) * 100)
        : 100
    };
  }

  getSLABreaches(tenantId) {
    return this.getSLAStatus(tenantId).breaches;
  }

  getSLATimeLimit(severity) {
    const slaLimits = {
      'critical': 15,    // 15 minutes
      'high': 60,        // 1 hour
      'medium': 240,     // 4 hours
      'low': 1440        // 24 hours
    };
    
    return slaLimits[severity] || 1440;
  }

  async createIncident(incidentData) {
    const incident = {
      id: this.generateIncidentId(),
      ...incidentData,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Run analysis if we have affected files
    if (incidentData.affectedFiles && incidentData.affectedFiles.length > 0) {
      try {
        incident.analysis = await this.analyzer.analyzeIncident(
          incident.createdAt,
          24, // Look back 24 hours
          incidentData.affectedFiles
        );
      } catch (error) {
        logger.warn('Failed to analyze incident', { error: error.message });
      }
    }

    this.incidents.set(incident.id, incident);
    this.updateMetrics();
    
    logger.info('Incident created', { incidentId: incident.id, severity: incident.severity });
    
    return incident;
  }

  async updateIncident(incidentId, updates, user) {
    const incident = this.incidents.get(incidentId);
    
    if (!incident || incident.tenantId !== user.tenantId) {
      return null;
    }

    // Track status changes
    const oldStatus = incident.status;
    
    Object.assign(incident, updates, {
      updatedAt: new Date(),
      updatedBy: user.userId
    });

    // Set resolution time if being resolved
    if (updates.status === 'resolved' && oldStatus !== 'resolved') {
      incident.resolvedAt = new Date();
    }

    this.incidents.set(incidentId, incident);
    this.updateMetrics();
    
    logger.info('Incident updated', { 
      incidentId, 
      updates: Object.keys(updates),
      user: user.userId 
    });
    
    return incident;
  }

  sanitizeIncident(incident) {
    return {
      id: incident.id,
      title: InputSanitizer.sanitizeHTML(incident.title),
      description: InputSanitizer.sanitizeHTML(incident.description || ''),
      severity: incident.severity,
      status: incident.status,
      assignedTo: incident.assignedTo,
      createdAt: incident.createdAt,
      updatedAt: incident.updatedAt,
      resolvedAt: incident.resolvedAt,
      analysis: incident.analysis ? {
        riskScore: incident.analysis.riskScore,
        suspiciousCommits: incident.analysis.suspiciousCommits?.length || 0,
        affectedFiles: incident.analysis.affectedFiles?.length || 0
      } : null
    };
  }

  sanitizeIncidentUpdates(updates) {
    const sanitized = {};
    
    if (updates.title) {
      sanitized.title = InputSanitizer.sanitizeHTML(updates.title).substring(0, 200);
    }
    
    if (updates.description) {
      sanitized.description = InputSanitizer.sanitizeHTML(updates.description).substring(0, 2000);
    }
    
    if (updates.severity && ['critical', 'high', 'medium', 'low'].includes(updates.severity)) {
      sanitized.severity = updates.severity;
    }
    
    if (updates.status && ['active', 'investigating', 'resolved', 'closed'].includes(updates.status)) {
      sanitized.status = updates.status;
    }
    
    if (updates.assignedTo) {
      sanitized.assignedTo = InputSanitizer.sanitizeTenantId(updates.assignedTo);
    }

    return sanitized;
  }

  sanitizeNewIncident(incidentData) {
    return {
      title: InputSanitizer.sanitizeHTML(incidentData.title || 'Untitled Incident').substring(0, 200),
      description: InputSanitizer.sanitizeHTML(incidentData.description || '').substring(0, 2000),
      severity: ['critical', 'high', 'medium', 'low'].includes(incidentData.severity) 
        ? incidentData.severity : 'medium',
      affectedFiles: Array.isArray(incidentData.affectedFiles) 
        ? incidentData.affectedFiles.map(f => InputSanitizer.sanitizeFilePath(f)).slice(0, 50)
        : [],
      assignedTo: incidentData.assignedTo 
        ? InputSanitizer.sanitizeTenantId(incidentData.assignedTo) 
        : null
    };
  }

  generateIncidentId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 7);
    return `INC-${timestamp}-${random}`.toUpperCase();
  }

  updateMetrics() {
    const allIncidents = Array.from(this.incidents.values());
    const active = allIncidents.filter(i => i.status === 'active');
    const resolvedToday = allIncidents.filter(i => 
      i.status === 'resolved' && 
      new Date(i.resolvedAt).toDateString() === new Date().toDateString()
    );

    this.metrics = {
      activeIncidents: active.length,
      resolvedToday: resolvedToday.length,
      averageMTTR: this.calculateAverageMTTR(allIncidents),
      highSeverityCount: active.filter(i => ['critical', 'high'].includes(i.severity)).length
    };
  }

  calculateAverageMTTR(incidents) {
    const resolved = incidents.filter(i => 
      i.status === 'resolved' && i.createdAt && i.resolvedAt
    );
    
    if (resolved.length === 0) return 0;
    
    const totalTime = resolved.reduce((sum, incident) => {
      return sum + (new Date(incident.resolvedAt) - new Date(incident.createdAt));
    }, 0);
    
    return Math.round(totalTime / resolved.length / 60000); // minutes
  }

  startMetricsCollection() {
    // Update metrics every 30 seconds
    setInterval(() => {
      this.updateMetrics();
      this.broadcastMetricsUpdate();
    }, 30000);
  }

  setupWebSocket(server) {
    this.wss = new WebSocketServer({ server });
    
    this.wss.on('connection', (ws, request) => {
      ws.isAlive = true;
      this.wsClients.add(ws);
      
      ws.on('pong', () => {
        ws.isAlive = true;
      });
      
      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          this.handleWebSocketMessage(ws, data);
        } catch (error) {
          logger.warn('Invalid WebSocket message', { error: error.message });
        }
      });
      
      ws.on('close', () => {
        this.wsClients.delete(ws);
      });
    });

    // Heartbeat to detect broken connections
    setInterval(() => {
      this.wss.clients.forEach(ws => {
        if (!ws.isAlive) {
          this.wsClients.delete(ws);
          return ws.terminate();
        }
        
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);
  }

  handleWebSocketMessage(ws, data) {
    switch (data.type) {
      case 'subscribe':
        ws.tenantId = data.tenantId;
        ws.subscriptions = data.subscriptions || ['incidents', 'metrics'];
        ws.send(JSON.stringify({
          type: 'subscribed',
          subscriptions: ws.subscriptions
        }));
        break;
        
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        break;
    }
  }

  broadcastIncidentUpdate(incident) {
    const message = JSON.stringify({
      type: 'incident_update',
      incident: this.sanitizeIncident(incident),
      timestamp: new Date().toISOString()
    });

    this.wsClients.forEach(client => {
      if (client.readyState === 1 && 
          client.tenantId === incident.tenantId &&
          client.subscriptions?.includes('incidents')) {
        client.send(message);
      }
    });
  }

  broadcastMetricsUpdate() {
    const message = JSON.stringify({
      type: 'metrics_update',
      metrics: this.metrics,
      timestamp: new Date().toISOString()
    });

    this.wsClients.forEach(client => {
      if (client.readyState === 1 && client.subscriptions?.includes('metrics')) {
        client.send(message);
      }
    });
  }

  renderDashboard() {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Traversion - Incident Dashboard</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; }
        .header { background: #1a1a1a; color: white; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; }
        .logo { font-size: 1.5rem; font-weight: bold; }
        .status { display: flex; gap: 1rem; align-items: center; }
        .status-indicator { width: 8px; height: 8px; border-radius: 50%; background: #00ff00; }
        .container { max-width: 1400px; margin: 0 auto; padding: 2rem; }
        .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
        .metric-card { background: white; padding: 1.5rem; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .metric-value { font-size: 2rem; font-weight: bold; color: #333; }
        .metric-label { color: #666; margin-top: 0.5rem; }
        .critical { color: #dc3545; }
        .high { color: #fd7e14; }
        .medium { color: #ffc107; }
        .low { color: #28a745; }
        .incidents { background: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .incidents-header { padding: 1rem 2rem; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; }
        .incident { padding: 1rem 2rem; border-bottom: 1px solid #eee; display: flex; justify-content: between; align-items: center; }
        .incident:last-child { border-bottom: none; }
        .incident-title { font-weight: 500; margin-bottom: 0.25rem; }
        .incident-meta { font-size: 0.875rem; color: #666; }
        .severity-badge { padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: bold; text-transform: uppercase; }
        .severity-critical { background: #dc3545; color: white; }
        .severity-high { background: #fd7e14; color: white; }
        .severity-medium { background: #ffc107; color: black; }
        .severity-low { background: #28a745; color: white; }
        .loading { text-align: center; padding: 2rem; color: #666; }
        .error { background: #f8d7da; color: #721c24; padding: 1rem; border-radius: 4px; margin: 1rem 0; }
        .refresh-btn { background: #007bff; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; }
        .refresh-btn:hover { background: #0056b3; }
    </style>
</head>
<body>
    <div class="header">
        <div class="logo">🔥 Traversion Dashboard</div>
        <div class="status">
            <div class="status-indicator"></div>
            <span>Live</span>
            <button class="refresh-btn" onclick="loadDashboard()">Refresh</button>
        </div>
    </div>
    
    <div class="container">
        <div class="metrics" id="metrics">
            <div class="loading">Loading metrics...</div>
        </div>
        
        <div class="incidents" id="incidents">
            <div class="incidents-header">
                <h2>Active Incidents</h2>
                <span id="incident-count">Loading...</span>
            </div>
            <div id="incident-list">
                <div class="loading">Loading incidents...</div>
            </div>
        </div>
    </div>

    <script>
        let ws;
        const API_BASE = '/api/dashboard';
        
        async function loadDashboard() {
            try {
                const [overviewResponse, incidentsResponse] = await Promise.all([
                    fetch(API_BASE + '/overview'),
                    fetch(API_BASE + '/incidents')
                ]);
                
                if (overviewResponse.ok && incidentsResponse.ok) {
                    const overview = await overviewResponse.json();
                    const incidents = await incidentsResponse.json();
                    
                    renderMetrics(overview.data.metrics);
                    renderIncidents(incidents.incidents);
                    connectWebSocket();
                } else {
                    showError('Failed to load dashboard data');
                }
            } catch (error) {
                showError('Network error: ' + error.message);
            }
        }
        
        function renderMetrics(metrics) {
            document.getElementById('metrics').innerHTML = \`
                <div class="metric-card">
                    <div class="metric-value critical">\${metrics.activeIncidents}</div>
                    <div class="metric-label">Active Incidents</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">\${metrics.resolvedToday}</div>
                    <div class="metric-label">Resolved Today</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">\${metrics.averageMTTR}m</div>
                    <div class="metric-label">Avg MTTR</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value high">\${metrics.highSeverityCount}</div>
                    <div class="metric-label">High Severity</div>
                </div>
            \`;
        }
        
        function renderIncidents(incidents) {
            const incidentList = document.getElementById('incident-list');
            const incidentCount = document.getElementById('incident-count');
            
            incidentCount.textContent = \`\${incidents.length} incidents\`;
            
            if (incidents.length === 0) {
                incidentList.innerHTML = '<div class="loading">No active incidents 🎉</div>';
                return;
            }
            
            incidentList.innerHTML = incidents.map(incident => \`
                <div class="incident">
                    <div>
                        <div class="incident-title">\${incident.title}</div>
                        <div class="incident-meta">
                            \${formatDate(incident.createdAt)} • 
                            \${incident.assignedTo || 'Unassigned'}
                        </div>
                    </div>
                    <div>
                        <span class="severity-badge severity-\${incident.severity}">\${incident.severity}</span>
                    </div>
                </div>
            \`).join('');
        }
        
        function connectWebSocket() {
            const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            ws = new WebSocket(\`\${protocol}//\${location.host}\`);
            
            ws.onopen = () => {
                ws.send(JSON.stringify({
                    type: 'subscribe',
                    subscriptions: ['incidents', 'metrics']
                }));
            };
            
            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                
                if (data.type === 'incident_update') {
                    loadDashboard(); // Reload for simplicity
                } else if (data.type === 'metrics_update') {
                    renderMetrics(data.metrics);
                }
            };
            
            ws.onclose = () => {
                setTimeout(connectWebSocket, 5000);
            };
        }
        
        function formatDate(dateStr) {
            const date = new Date(dateStr);
            const now = new Date();
            const diffMs = now - date;
            const diffMins = Math.floor(diffMs / 60000);
            
            if (diffMins < 1) return 'Just now';
            if (diffMins < 60) return \`\${diffMins}m ago\`;
            if (diffMins < 1440) return \`\${Math.floor(diffMins / 60)}h ago\`;
            return date.toLocaleDateString();
        }
        
        function showError(message) {
            document.body.insertAdjacentHTML('afterbegin', 
                \`<div class="error">\${message}</div>\`);
        }
        
        // Load dashboard on page load
        loadDashboard();
        
        // Auto-refresh every 60 seconds
        setInterval(loadDashboard, 60000);
    </script>
</body>
</html>
    `;
  }

  start() {
    const server = this.app.listen(this.port, () => {
      logger.info('Real-time dashboard started', { port: this.port });
      console.log(`🚀 Dashboard running at http://localhost:${this.port}`);
    });

    this.setupWebSocket(server);
    return server;
  }
}

export default RealTimeDashboard;