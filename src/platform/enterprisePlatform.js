import express from 'express';
import { WebSocketServer } from 'ws';
import { AuthMiddleware } from '../security/authMiddleware.js';
import { RealTimeDashboard } from '../dashboard/realTimeDashboard.js';
import { SeverityAnalyzer } from '../analysis/severityAnalyzer.js';
import { TeamPerformanceAnalytics } from '../analytics/teamPerformance.js';
import { PostMortemGenerator } from '../postmortem/postMortemGenerator.js';
import { MonitoringIntegrations } from '../integrations/monitoringIntegrations.js';
import { IncidentAnalyzer } from '../forensics/incidentAnalyzer.js';
import { SecureGitIntegration } from '../security/secureGitIntegration.js';
import { SlackBot } from '../integrations/slackBot.js';
import { GitHubIntegration } from '../integrations/githubIntegration.js';
import logger from '../utils/logger.js';

/**
 * Enterprise Traversion Platform
 * 
 * Unified platform that integrates all incident management capabilities:
 * - Real-time dashboard and monitoring
 * - Intelligent severity scoring and escalation
 * - Team performance analytics
 * - Automated post-mortem generation
 * - Monitoring tool integrations
 * - Full incident lifecycle management
 */
export class EnterprisePlatform {
  constructor(config = {}) {
    this.config = config;
    this.app = express();
    
    // Initialize core components
    this.auth = new AuthMiddleware(config.auth || {});
    this.git = new SecureGitIntegration();
    this.incidentAnalyzer = new IncidentAnalyzer();
    this.severityAnalyzer = new SeverityAnalyzer();
    this.performanceAnalytics = new TeamPerformanceAnalytics();
    this.postMortemGenerator = new PostMortemGenerator();
    this.monitoringIntegrations = new MonitoringIntegrations(config.monitoring || {});
    
    // Initialize dashboard
    this.dashboard = new RealTimeDashboard({
      port: config.dashboardPort || 3340,
      auth: config.auth
    });

    // Initialize integrations
    if (config.slack) {
      this.slackBot = new SlackBot(config.slack);
    }
    
    if (config.github) {
      this.githubIntegration = new GitHubIntegration(config.github);
    }

    // Platform state
    this.incidents = new Map();
    this.users = new Map();
    this.teams = new Map();
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupEventHandlers();
  }

  setupMiddleware() {
    // Security middleware
    this.app.use(this.auth.securityHeaders);
    this.app.use(this.auth.sanitizeRequest);
    this.app.use(express.json({ limit: '10mb' }));
    
    // Rate limiting
    this.app.use('/api/', this.auth.rateLimit({
      windowMs: 60000, // 1 minute
      max: 500 // Higher limit for enterprise platform
    }));

    // Authentication for all API routes
    this.app.use('/api/', this.auth.verifyToken);
    this.app.use('/api/', this.auth.enforceTenantIsolation);
  }

  setupRoutes() {
    // Platform status
    this.app.get('/api/platform/status', (req, res) => {
      res.json({
        status: 'healthy',
        version: '2.0.0',
        features: this.getEnabledFeatures(),
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      });
    });

    // Incident Management APIs
    this.setupIncidentRoutes();
    
    // Analytics APIs
    this.setupAnalyticsRoutes();
    
    // Post-mortem APIs
    this.setupPostMortemRoutes();
    
    // Integration APIs
    this.setupIntegrationRoutes();
    
    // Dashboard APIs (proxy to dashboard)
    this.app.use('/api/dashboard', this.createDashboardProxy());
  }

  setupIncidentRoutes() {
    // Create incident with intelligent severity analysis
    this.app.post('/api/incidents', async (req, res) => {
      try {
        const incidentData = req.body;
        incidentData.tenantId = req.user.tenantId;
        incidentData.createdBy = req.user.userId;
        incidentData.createdAt = new Date();

        // Analyze severity if not provided
        if (!incidentData.severity && incidentData.affectedFiles) {
          const severityAnalysis = await this.severityAnalyzer.analyzeSeverity(incidentData);
          incidentData.severity = severityAnalysis.suggestedSeverity;
          incidentData.severityAnalysis = severityAnalysis;
        }

        // Enrich with git analysis
        if (incidentData.affectedFiles?.length > 0) {
          try {
            incidentData.gitAnalysis = await this.incidentAnalyzer.analyzeIncident(
              incidentData.createdAt,
              24,
              incidentData.affectedFiles
            );
          } catch (error) {
            logger.warn('Git analysis failed for new incident', { error: error.message });
          }
        }

        // Enrich with monitoring data
        try {
          incidentData.monitoringData = await this.monitoringIntegrations.enrichIncidentWithMonitoringData(incidentData);
        } catch (error) {
          logger.warn('Monitoring enrichment failed', { error: error.message });
        }

        const incident = await this.createIncident(incidentData);
        
        // Notify integrations
        await this.notifyIncidentCreated(incident);

        res.status(201).json({
          success: true,
          incident: this.sanitizeIncidentForAPI(incident)
        });

      } catch (error) {
        logger.error('Failed to create incident', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get incident with full context
    this.app.get('/api/incidents/:incidentId', async (req, res) => {
      try {
        const incident = await this.getIncidentWithContext(req.params.incidentId, req.user.tenantId);
        
        if (!incident) {
          return res.status(404).json({ success: false, error: 'Incident not found' });
        }

        res.json({
          success: true,
          incident: this.sanitizeIncidentForAPI(incident)
        });

      } catch (error) {
        logger.error('Failed to get incident', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Update incident
    this.app.patch('/api/incidents/:incidentId', async (req, res) => {
      try {
        const incident = await this.updateIncident(
          req.params.incidentId,
          req.body,
          req.user
        );

        if (!incident) {
          return res.status(404).json({ success: false, error: 'Incident not found' });
        }

        await this.notifyIncidentUpdated(incident);

        res.json({
          success: true,
          incident: this.sanitizeIncidentForAPI(incident)
        });

      } catch (error) {
        logger.error('Failed to update incident', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Generate post-mortem
    this.app.post('/api/incidents/:incidentId/postmortem', async (req, res) => {
      try {
        const incident = this.incidents.get(req.params.incidentId);
        
        if (!incident || incident.tenantId !== req.user.tenantId) {
          return res.status(404).json({ success: false, error: 'Incident not found' });
        }

        const postMortem = await this.postMortemGenerator.generatePostMortem(
          incident,
          req.body.options || {}
        );

        res.json({
          success: true,
          postMortem
        });

      } catch (error) {
        logger.error('Failed to generate post-mortem', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });
  }

  setupAnalyticsRoutes() {
    // Team performance report
    this.app.get('/api/analytics/team-performance', async (req, res) => {
      try {
        const { timeframe = '30d' } = req.query;
        
        const report = this.performanceAnalytics.generateTeamReport(
          req.user.tenantId,
          timeframe
        );

        res.json({
          success: true,
          report
        });

      } catch (error) {
        logger.error('Failed to generate team performance report', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Individual performance metrics
    this.app.get('/api/analytics/individual/:userId', async (req, res) => {
      try {
        const { timeframe = '30d' } = req.query;
        const userId = req.params.userId;
        
        // Ensure user can only access their own data or has admin role
        if (userId !== req.user.userId && !req.user.permissions.includes('analytics:all')) {
          return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const metrics = await this.getIndividualPerformanceMetrics(
          userId,
          req.user.tenantId,
          timeframe
        );

        res.json({
          success: true,
          metrics
        });

      } catch (error) {
        logger.error('Failed to get individual metrics', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // MTTR trends
    this.app.get('/api/analytics/mttr-trends', async (req, res) => {
      try {
        const { timeframe = '90d', granularity = 'daily' } = req.query;
        
        const trends = await this.getMTTRTrends(
          req.user.tenantId,
          timeframe,
          granularity
        );

        res.json({
          success: true,
          trends
        });

      } catch (error) {
        logger.error('Failed to get MTTR trends', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });
  }

  setupPostMortemRoutes() {
    // List post-mortems
    this.app.get('/api/postmortems', async (req, res) => {
      try {
        const { limit = 50, offset = 0 } = req.query;
        
        const postMortems = await this.getPostMortems(
          req.user.tenantId,
          parseInt(limit),
          parseInt(offset)
        );

        res.json({
          success: true,
          postMortems,
          total: postMortems.length
        });

      } catch (error) {
        logger.error('Failed to get post-mortems', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get specific post-mortem
    this.app.get('/api/postmortems/:postMortemId', async (req, res) => {
      try {
        const postMortem = await this.getPostMortem(
          req.params.postMortemId,
          req.user.tenantId
        );

        if (!postMortem) {
          return res.status(404).json({ success: false, error: 'Post-mortem not found' });
        }

        res.json({
          success: true,
          postMortem
        });

      } catch (error) {
        logger.error('Failed to get post-mortem', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Update post-mortem action items
    this.app.patch('/api/postmortems/:postMortemId/action-items/:actionItemId', async (req, res) => {
      try {
        const actionItem = await this.updateActionItem(
          req.params.postMortemId,
          req.params.actionItemId,
          req.body,
          req.user
        );

        if (!actionItem) {
          return res.status(404).json({ success: false, error: 'Action item not found' });
        }

        res.json({
          success: true,
          actionItem
        });

      } catch (error) {
        logger.error('Failed to update action item', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });
  }

  setupIntegrationRoutes() {
    // Slack integration endpoints
    if (this.slackBot) {
      this.app.post('/api/integrations/slack/events', (req, res) => {
        this.slackBot.handleSlackEvent(req, res);
      });

      this.app.post('/api/integrations/slack/slash-commands', (req, res) => {
        this.slackBot.handleSlashCommand(req, res);
      });
    }

    // GitHub integration webhooks
    if (this.githubIntegration) {
      this.app.post('/api/integrations/github/webhooks', (req, res) => {
        this.githubIntegration.handleWebhook(req, res);
      });
    }

    // Monitoring integrations
    this.app.post('/api/integrations/monitoring/webhook', async (req, res) => {
      try {
        const alert = req.body;
        const source = req.headers['x-source'] || 'unknown';
        
        // Create incident from monitoring alert
        const incident = await this.monitoringIntegrations.createIncidentFromAlert(alert, source);
        
        if (incident) {
          const createdIncident = await this.createIncident({
            ...incident,
            tenantId: req.user.tenantId
          });

          await this.notifyIncidentCreated(createdIncident);

          res.json({
            success: true,
            incident: this.sanitizeIncidentForAPI(createdIncident),
            message: 'Incident created from monitoring alert'
          });
        } else {
          res.json({
            success: false,
            message: 'Alert did not meet incident creation criteria'
          });
        }

      } catch (error) {
        logger.error('Failed to process monitoring webhook', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get monitoring dashboard URLs for incident
    this.app.get('/api/integrations/monitoring/dashboards/:incidentId', async (req, res) => {
      try {
        const incident = this.incidents.get(req.params.incidentId);
        
        if (!incident || incident.tenantId !== req.user.tenantId) {
          return res.status(404).json({ success: false, error: 'Incident not found' });
        }

        const dashboards = await this.monitoringIntegrations.getDashboardUrls(incident);

        res.json({
          success: true,
          dashboards
        });

      } catch (error) {
        logger.error('Failed to get dashboard URLs', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });
  }

  setupEventHandlers() {
    // Handle dashboard events
    this.dashboard.on('incident_created', (incident) => {
      this.handleDashboardIncident(incident);
    });

    this.dashboard.on('incident_updated', (incident) => {
      this.handleDashboardIncidentUpdate(incident);
    });

    // Handle performance analytics events
    this.performanceAnalytics.on('performance_alert', (alert) => {
      this.handlePerformanceAlert(alert);
    });
  }

  // Core incident management methods

  async createIncident(incidentData) {
    const incident = {
      id: this.generateIncidentId(),
      ...incidentData,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.incidents.set(incident.id, incident);
    
    // Add to analytics
    this.performanceAnalytics.addIncident(incident);

    logger.info('Incident created', {
      incidentId: incident.id,
      severity: incident.severity,
      tenantId: incident.tenantId
    });

    return incident;
  }

  async updateIncident(incidentId, updates, user) {
    const incident = this.incidents.get(incidentId);
    
    if (!incident || incident.tenantId !== user.tenantId) {
      return null;
    }

    const previousStatus = incident.status;
    
    Object.assign(incident, updates, {
      updatedAt: new Date(),
      updatedBy: user.userId
    });

    // Track status changes
    if (updates.status && updates.status !== previousStatus) {
      if (!incident.statusChanges) incident.statusChanges = [];
      incident.statusChanges.push({
        timestamp: new Date(),
        previousStatus,
        status: updates.status,
        changedBy: user.userId
      });

      // Set resolution time if resolving
      if (updates.status === 'resolved' && previousStatus !== 'resolved') {
        incident.resolvedAt = new Date();
        incident.resolvedBy = user.userId;
      }
    }

    // Update analytics
    this.performanceAnalytics.updateIncident(incidentId, updates);

    this.incidents.set(incidentId, incident);
    
    logger.info('Incident updated', {
      incidentId,
      updates: Object.keys(updates),
      user: user.userId
    });

    return incident;
  }

  async getIncidentWithContext(incidentId, tenantId) {
    const incident = this.incidents.get(incidentId);
    
    if (!incident || incident.tenantId !== tenantId) {
      return null;
    }

    // Enrich with additional context
    const enrichedIncident = { ...incident };

    // Add monitoring data if available
    if (incident.monitoringData) {
      enrichedIncident.monitoringContext = incident.monitoringData;
    }

    // Add related incidents
    enrichedIncident.relatedIncidents = await this.findRelatedIncidents(incident);

    // Add team context
    enrichedIncident.teamContext = await this.getTeamContext(incident);

    return enrichedIncident;
  }

  // Notification and integration methods

  async notifyIncidentCreated(incident) {
    try {
      // Notify Slack
      if (this.slackBot) {
        await this.slackBot.notifyIncidentCreated(incident);
      }

      // Notify GitHub if relevant
      if (this.githubIntegration && incident.affectedFiles) {
        await this.githubIntegration.notifyIncident(incident);
      }

      // Send escalation notifications based on severity
      await this.handleEscalationNotifications(incident);

    } catch (error) {
      logger.error('Failed to send incident notifications', { error: error.message });
    }
  }

  async notifyIncidentUpdated(incident) {
    try {
      // Notify all interested parties
      if (this.slackBot) {
        await this.slackBot.notifyIncidentUpdated(incident);
      }

    } catch (error) {
      logger.error('Failed to send update notifications', { error: error.message });
    }
  }

  async handleEscalationNotifications(incident) {
    const escalationRules = this.severityAnalyzer.getEscalationTimeline(incident.severity);
    
    if (escalationRules?.immediateAction && incident.severity === 'critical') {
      // Send immediate notifications for critical incidents
      logger.info('Sending immediate escalation for critical incident', { incidentId: incident.id });
      
      if (this.slackBot) {
        await this.slackBot.createWarRoom(incident);
      }
    }
  }

  // Helper methods

  createDashboardProxy() {
    return (req, res, next) => {
      // Proxy dashboard requests to the dashboard instance
      req.url = req.url.replace('/api/dashboard', '');
      this.dashboard.app(req, res, next);
    };
  }

  generateIncidentId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 7);
    return `INC-${timestamp}-${random}`.toUpperCase();
  }

  sanitizeIncidentForAPI(incident) {
    const sanitized = { ...incident };
    
    // Remove sensitive or internal fields
    delete sanitized.internalNotes;
    delete sanitized.debugInfo;
    
    // Sanitize text fields
    if (sanitized.title) sanitized.title = this.auth.sanitizeHTML(sanitized.title);
    if (sanitized.description) sanitized.description = this.auth.sanitizeHTML(sanitized.description);
    
    return sanitized;
  }

  getEnabledFeatures() {
    return {
      realTimeDashboard: true,
      severityAnalysis: true,
      performanceAnalytics: true,
      postMortemGeneration: true,
      monitoringIntegrations: true,
      slackIntegration: !!this.slackBot,
      githubIntegration: !!this.githubIntegration,
      teamCollaboration: true,
      incidentForensics: true
    };
  }

  // Placeholder methods for complex operations
  async findRelatedIncidents(incident) { return []; }
  async getTeamContext(incident) { return {}; }
  async getIndividualPerformanceMetrics(userId, tenantId, timeframe) { return {}; }
  async getMTTRTrends(tenantId, timeframe, granularity) { return {}; }
  async getPostMortems(tenantId, limit, offset) { return []; }
  async getPostMortem(postMortemId, tenantId) { return null; }
  async updateActionItem(postMortemId, actionItemId, updates, user) { return null; }
  
  handleDashboardIncident(incident) {
    logger.info('Dashboard incident event', { incidentId: incident.id });
  }
  
  handleDashboardIncidentUpdate(incident) {
    logger.info('Dashboard incident update event', { incidentId: incident.id });
  }
  
  handlePerformanceAlert(alert) {
    logger.info('Performance alert', { alert });
  }

  /**
   * Start the enterprise platform
   */
  async start() {
    try {
      // Start the main platform server
      const port = this.config.port || 3350;
      
      const server = this.app.listen(port, () => {
        logger.info('Enterprise Traversion Platform started', { port });
        console.log(`🚀 Enterprise Platform running at http://localhost:${port}`);
      });

      // Start dashboard
      await this.dashboard.start();

      // Start integrations
      if (this.slackBot) {
        await this.slackBot.start();
      }

      logger.info('All platform components started successfully');

      return server;

    } catch (error) {
      logger.error('Failed to start enterprise platform', { error: error.message });
      throw error;
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    logger.info('Shutting down enterprise platform');

    try {
      // Cleanup integrations
      if (this.slackBot) {
        await this.slackBot.shutdown();
      }

      // Save state
      await this.saveState();

      logger.info('Enterprise platform shutdown complete');

    } catch (error) {
      logger.error('Error during platform shutdown', { error: error.message });
    }
  }

  async saveState() {
    // Save platform state to persistent storage
    // This would typically save incidents, analytics, etc.
  }
}

export default EnterprisePlatform;