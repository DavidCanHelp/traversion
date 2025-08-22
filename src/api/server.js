/**
 * Production API Server
 * 
 * RESTful API and WebSocket server for Traversion production debugging platform.
 * Provides TimeQL queries, real-time events, and system monitoring.
 */

import express from 'express';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { AuthMiddleware } from '../security/authMiddleware.js';
import TimescaleAdapter from '../storage/timescaleAdapter.js';
import CausalityEngine from '../engine/causalityEngine.js';
import TemporalQueryEngine from '../engine/temporalQueryEngine.js';
import EventCollector from '../collectors/eventCollector.js';
import AuthService from '../auth/authService.js';
import MetricsCollector from '../monitoring/metricsCollector.js';
import AlertingEngine from '../monitoring/alertingEngine.js';
import BackupManager from '../backup/backupManager.js';
import DataExporter from '../export/dataExporter.js';
import ScheduledBackupService from '../backup/scheduledBackups.js';

// Initialize components
const storage = new TimescaleAdapter({
  dbHost: process.env.DB_HOST,
  dbPort: process.env.DB_PORT,
  dbName: process.env.DB_NAME,
  dbUser: process.env.DB_USER,
  dbPassword: process.env.DB_PASSWORD,
  redisHost: process.env.REDIS_HOST,
  redisPort: process.env.REDIS_PORT,
  redisPassword: process.env.REDIS_PASSWORD
});

const causalityEngine = new CausalityEngine();
const queryEngine = new TemporalQueryEngine(causalityEngine);

// Initialize authentication service
const authService = new AuthService(storage, {
  jwtSecret: process.env.JWT_SECRET || 'traversion-dev-secret',
  jwtExpiry: process.env.JWT_EXPIRY || '7d',
  apiKeySecret: process.env.API_KEY_SECRET || 'api-key-dev-secret'
});

// Initialize secure authentication middleware
const authMiddleware = new AuthMiddleware({
  jwtSecret: process.env.JWT_SECRET || 'traversion-dev-secret',
  sessionTimeout: 3600000 // 1 hour
});

// Initialize monitoring
const metrics = new MetricsCollector({
  namespace: 'traversion',
  labels: { service: 'api-server' },
  collectionInterval: 15000
});

const alerting = new AlertingEngine(storage, {
  checkInterval: 60000,
  emailConfig: process.env.SMTP_HOST ? {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT || 587,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.ALERT_FROM_EMAIL,
    to: process.env.ALERT_TO_EMAIL
  } : null,
  slackWebhook: process.env.SLACK_WEBHOOK,
  pagerDutyKey: process.env.PAGERDUTY_KEY
});

// Initialize backup and export services
const backupManager = new BackupManager(storage, {
  backupDir: process.env.BACKUP_DIR || './backups',
  retentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS) || 90,
  s3Config: process.env.AWS_ACCESS_KEY_ID ? {
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    },
    bucket: process.env.AWS_S3_BUCKET
  } : null,
  gcsConfig: process.env.GOOGLE_APPLICATION_CREDENTIALS ? {
    projectId: process.env.GCP_PROJECT_ID,
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    bucket: process.env.GCS_BUCKET
  } : null
});

const dataExporter = new DataExporter(storage, {
  exportDir: process.env.EXPORT_DIR || './exports',
  rateLimitRpm: parseInt(process.env.EXPORT_RATE_LIMIT) || 60,
  maxLimit: parseInt(process.env.EXPORT_MAX_LIMIT) || 100000
});

const scheduledBackups = new ScheduledBackupService(backupManager, storage, {
  timezone: process.env.BACKUP_TIMEZONE || 'UTC'
});

// Initialize Express app
const app = express();
const PORT = process.env.API_PORT || 3338;
const WS_PORT = process.env.WS_PORT || 3339;

// Security middleware
app.use(authMiddleware.securityHeaders);
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));

// Performance middleware
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(authMiddleware.sanitizeRequest);

// Rate limiting using secure middleware
app.use('/api/', authMiddleware.rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
}));

// Authentication middleware for protected routes
const authenticateJWT = authService.authenticateJWT();
const authenticateAPIKey = authService.authenticateAPIKey();
const requireRole = authService.requireRole.bind(authService);
const requirePermission = authService.requirePermission.bind(authService);

// Combined authentication using secure middleware
const authenticate = (req, res, next) => {
  // First use secure auth middleware
  authMiddleware.verifyToken(req, res, (err) => {
    if (err || !req.user) {
      // Fallback to legacy authentication
      authenticateJWT(req, res, (err) => {
        if (err || !req.user) {
          authenticateAPIKey(req, res, next);
        } else {
          next();
        }
      });
    } else {
      next();
    }
  });
};

// Request logging and metrics middleware
app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
    
    // Record metrics
    metrics.recordAPIRequest(req.method, req.route?.path || req.path, res.statusCode, duration);
    
    // Update WebSocket connection count
    if (req.path === '/websocket') {
      metrics.setGauge('websocket_connections', '', [req.user?.tenantId || 'unknown'], wsClients.size);
    }
  });
  
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  const health = {
    status: storage.connected ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    storage: storage.connected,
    causality: causalityEngine.causalityGraph.size
  };
  
  res.status(storage.connected ? 200 : 503).json(health);
});

// Metrics endpoint for Prometheus
app.get('/metrics', (req, res) => {
  try {
    const prometheusFormat = metrics.exportPrometheusFormat();
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(prometheusFormat);
  } catch (error) {
    console.error('Error exporting metrics:', error);
    res.status(500).send('Error exporting metrics');
  }
});

// Internal metrics endpoint (JSON format)
app.get('/api/internal/metrics', authenticate, requireRole('admin'), (req, res) => {
  try {
    const jsonMetrics = metrics.getMetrics();
    const alertStats = alerting.getAlertStats();
    
    res.json({
      success: true,
      metrics: jsonMetrics,
      alerts: alertStats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting internal metrics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve metrics'
    });
  }
});

// Public API Routes (no authentication required)

// Authentication endpoints
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, tenantId } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email and password required' 
      });
    }
    
    const result = await authService.login(email, password, tenantId);
    
    if (result.success) {
      res.json({
        success: true,
        token: result.token,
        user: result.user,
        tenant: result.tenant
      });
    } else {
      res.status(401).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name, tenantName, role = 'viewer' } = req.body;
    
    if (!email || !password || !name) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email, password, and name required' 
      });
    }
    
    const result = await authService.createUser(email, password, name, null, role, tenantName);
    
    if (result.success) {
      res.status(201).json({
        success: true,
        user: result.user,
        tenant: result.tenant
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

app.post('/api/auth/refresh', authenticateJWT, async (req, res) => {
  try {
    const result = await authService.refreshToken(req.user.id);
    
    if (result.success) {
      res.json({
        success: true,
        token: result.token
      });
    } else {
      res.status(401).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

app.post('/api/auth/logout', authenticateJWT, async (req, res) => {
  try {
    await authService.logout(req.user.id, req.sessionId);
    res.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

// User management endpoints (admin only)
app.get('/api/auth/users', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const users = await authService.getUsers(req.user.tenantId);
    res.json({ success: true, users });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

app.patch('/api/auth/users/:userId', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { userId } = req.params;
    const updates = req.body;
    
    const result = await authService.updateUser(userId, updates, req.user.tenantId);
    
    if (result.success) {
      res.json({ success: true, user: result.user });
    } else {
      res.status(400).json({ 
        success: false, 
        error: result.error 
      });
    }
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

// API key management
app.get('/api/auth/api-keys', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const apiKeys = await authService.getAPIKeys(req.user.tenantId);
    res.json({ success: true, apiKeys });
  } catch (error) {
    console.error('Get API keys error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

app.post('/api/auth/api-keys', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { name, permissions, expiresAt } = req.body;
    
    if (!name) {
      return res.status(400).json({ 
        success: false, 
        error: 'API key name required' 
      });
    }
    
    const result = await authService.createAPIKey(
      name, 
      req.user.tenantId, 
      req.user.id,
      permissions,
      expiresAt
    );
    
    if (result.success) {
      res.status(201).json({ success: true, apiKey: result.apiKey });
    } else {
      res.status(400).json({ 
        success: false, 
        error: result.error 
      });
    }
  } catch (error) {
    console.error('Create API key error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

app.delete('/api/auth/api-keys/:keyId', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { keyId } = req.params;
    
    const result = await authService.deleteAPIKey(keyId, req.user.tenantId);
    
    if (result.success) {
      res.json({ success: true });
    } else {
      res.status(400).json({ 
        success: false, 
        error: result.error 
      });
    }
  } catch (error) {
    console.error('Delete API key error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

// Data Export Endpoints
app.post('/api/export', authenticate, requirePermission('data:export'), async (req, res) => {
  try {
    const { query, format, destination, options = {} } = req.body;
    
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Query is required'
      });
    }
    
    const exportOptions = {
      ...options,
      format: format || 'json',
      destination: destination || 'response'
    };
    
    const result = await dataExporter.exportData(req.user.tenantId, query, exportOptions);
    
    if (destination === 'response') {
      // Return data directly
      res.json({
        success: true,
        ...result
      });
    } else {
      // Return export info
      res.json({
        success: true,
        exportId: result.exportId,
        message: 'Export completed successfully',
        ...result
      });
    }
    
  } catch (error) {
    console.error('Export error:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/export/:exportId/status', authenticate, async (req, res) => {
  try {
    const { exportId } = req.params;
    const status = await dataExporter.getExportStatus(exportId);
    
    if (!status) {
      return res.status(404).json({
        success: false,
        error: 'Export not found'
      });
    }
    
    res.json({
      success: true,
      export: status
    });
    
  } catch (error) {
    console.error('Export status error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/export/stream', authenticate, requirePermission('data:export'), (req, res) => {
  try {
    const { query, format = 'ndjson', ...options } = req.query;
    
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Query parameter is required'
      });
    }
    
    const parsedQuery = JSON.parse(query);
    const exportStream = dataExporter.createExportStream(req.user.tenantId, parsedQuery, {
      format,
      ...options
    });
    
    // Set appropriate headers
    res.setHeader('Content-Type', format === 'csv' ? 'text/csv' : 'application/json');
    res.setHeader('Transfer-Encoding', 'chunked');
    
    exportStream.pipe(res);
    
  } catch (error) {
    console.error('Export stream error:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Backup Management Endpoints
app.post('/api/backup', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const {
      tables,
      format = 'json',
      compression = true,
      storageBackend = 'local',
      description,
      ...options
    } = req.body;
    
    const backupOptions = {
      tables,
      format,
      compression,
      storageBackend,
      createdBy: req.user.email,
      description: description || 'Manual backup via API',
      tenantId: req.user.role === 'superadmin' ? options.tenantId : req.user.tenantId,
      ...options
    };
    
    const result = await backupManager.createBackup(backupOptions);
    
    res.json({
      success: true,
      backup: result
    });
    
  } catch (error) {
    console.error('Backup creation error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/backup', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { storageBackend = 'local' } = req.query;
    const backups = await backupManager.listBackups(storageBackend);
    
    res.json({
      success: true,
      backups,
      storageBackend
    });
    
  } catch (error) {
    console.error('List backups error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/backup/:backupId/status', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { backupId } = req.params;
    const status = await backupManager.getBackupStatus(backupId);
    
    if (!status) {
      return res.status(404).json({
        success: false,
        error: 'Backup not found'
      });
    }
    
    res.json({
      success: true,
      backup: status
    });
    
  } catch (error) {
    console.error('Backup status error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/backup/:backupId/restore', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { backupId } = req.params;
    const { tables, truncate = true, storageBackend = 'local' } = req.body;
    
    const restoreOptions = {
      tables,
      truncate,
      storageBackend
    };
    
    const result = await backupManager.restoreBackup(backupId, restoreOptions);
    
    res.json({
      success: true,
      restore: result
    });
    
  } catch (error) {
    console.error('Backup restore error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.delete('/api/backup/:backupId', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { backupId } = req.params;
    const { storageBackend = 'local' } = req.query;
    
    await backupManager.deleteBackup(backupId, storageBackend);
    
    res.json({
      success: true,
      message: 'Backup deleted successfully'
    });
    
  } catch (error) {
    console.error('Backup deletion error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Scheduled Backup Management
app.get('/api/backup/schedules', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const schedules = scheduledBackups.getSchedules();
    
    res.json({
      success: true,
      schedules
    });
    
  } catch (error) {
    console.error('Get schedules error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/backup/schedules', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const scheduleConfig = req.body;
    const schedule = scheduledBackups.addSchedule(scheduleConfig);
    
    res.status(201).json({
      success: true,
      schedule
    });
    
  } catch (error) {
    console.error('Add schedule error:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

app.patch('/api/backup/schedules/:name', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { name } = req.params;
    const updates = req.body;
    
    const schedule = scheduledBackups.updateSchedule(name, updates);
    
    res.json({
      success: true,
      schedule
    });
    
  } catch (error) {
    console.error('Update schedule error:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/backup/schedules/:name/trigger', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { name } = req.params;
    
    // Trigger the backup job
    scheduledBackups.triggerSchedule(name);
    
    res.json({
      success: true,
      message: 'Backup job triggered successfully'
    });
    
  } catch (error) {
    console.error('Trigger schedule error:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

app.delete('/api/backup/schedules/:name', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { name } = req.params;
    const removed = scheduledBackups.removeSchedule(name);
    
    if (!removed) {
      return res.status(404).json({
        success: false,
        error: 'Schedule not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Schedule removed successfully'
    });
    
  } catch (error) {
    console.error('Remove schedule error:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Protected API Routes (require authentication)

// TimeQL query endpoint
app.post('/api/query', authenticate, requirePermission('query:read'), async (req, res) => {
  try {
    const { query } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }
    
    // Add tenant context to query
    const queryStart = Date.now();
    const result = await queryEngine.query(query, { tenantId: req.user.tenantId });
    const queryDuration = Date.now() - queryStart;
    
    // Record query metrics
    metrics.recordQueryExecution(
      req.user.tenantId, 
      result.type || 'unknown', 
      queryDuration,
      result.events?.length || result.chain?.length || 1
    );
    res.json({ success: true, result });
  } catch (error) {
    console.error('Query error:', error);
    res.status(400).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get events in time range
app.get('/api/events', authenticate, requirePermission('events:read'), async (req, res) => {
  try {
    const { start, end, service, type, anomaly } = req.query;
    
    const startTime = start ? parseInt(start) : Date.now() - 3600000;
    const endTime = end ? parseInt(end) : Date.now();
    
    const filters = { tenantId: req.user.tenantId };
    if (service) filters.serviceId = service;
    if (type) filters.eventType = type;
    if (anomaly) filters.minAnomalyScore = parseFloat(anomaly);
    
    const events = await storage.queryTimeRange(startTime, endTime, filters);
    res.json({ success: true, events });
  } catch (error) {
    console.error('Events query error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get system state at specific time
app.get('/api/state/:timestamp', authenticate, requirePermission('state:read'), async (req, res) => {
  try {
    const timestamp = parseInt(req.params.timestamp);
    const state = await storage.getSystemStateAt(timestamp, req.user.tenantId);
    res.json({ success: true, state });
  } catch (error) {
    console.error('State query error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Find root cause
app.get('/api/root-cause/:eventId', authenticate, requirePermission('causality:read'), async (req, res) => {
  try {
    const { eventId } = req.params;
    const chain = await storage.findRootCause(eventId, req.user.tenantId);
    res.json({ success: true, chain });
  } catch (error) {
    console.error('Root cause error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get causality chain
app.get('/api/causality/:eventId', authenticate, requirePermission('causality:read'), async (req, res) => {
  try {
    const { eventId } = req.params;
    const { direction = 'backward', depth = 50 } = req.query;
    
    const chain = await storage.getCausalityChain(
      eventId, 
      direction, 
      parseInt(depth),
      req.user.tenantId
    );
    
    res.json({ success: true, chain });
  } catch (error) {
    console.error('Causality query error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get metrics
app.get('/api/metrics', authenticate, requirePermission('metrics:read'), async (req, res) => {
  try {
    const { start, end, name } = req.query;
    
    const startTime = start ? parseInt(start) : Date.now() - 3600000;
    const endTime = end ? parseInt(end) : Date.now();
    
    const metrics = await storage.getMetrics(startTime, endTime, name, req.user.tenantId);
    res.json({ success: true, metrics });
  } catch (error) {
    console.error('Metrics query error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get statistics
app.get('/api/stats', authenticate, requirePermission('stats:read'), async (req, res) => {
  try {
    const dbStats = await storage.getStats(req.user.tenantId);
    const engineStats = {
      causalityGraphSize: causalityEngine.causalityGraph.size,
      patternsDetected: causalityEngine.patterns.size,
      activeChainsSize: causalityEngine.activeChains.size
    };
    const queryStats = queryEngine.getStats();
    
    res.json({ 
      success: true, 
      stats: {
        database: dbStats,
        engine: engineStats,
        queries: queryStats
      }
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Ingest events endpoint
app.post('/api/events', authenticate, requirePermission('events:write'), async (req, res) => {
  try {
    const events = Array.isArray(req.body) ? req.body : [req.body];
    
    // Add tenant context to events
    events.forEach(event => {
      event.tenantId = req.user.tenantId;
      if (!event.userId) event.userId = req.user.id;
    });
    
    // Process through causality engine and record metrics
    const processStart = Date.now();
    for (const event of events) {
      causalityEngine.processEvent(event);
      
      // Record event processing metrics
      metrics.recordEventProcessing(
        event.tenantId,
        event.eventType,
        event.serviceId,
        Date.now() - processStart
      );
    }
    
    // Store in database
    const stored = await storage.storeEvents(events);
    
    // Update storage metrics
    metrics.setGauge('storage_events_count', '', [req.user.tenantId], stored);
    
    // Broadcast to WebSocket clients
    broadcastEvents(events);
    
    res.json({ 
      success: true, 
      stored,
      message: `${stored} events stored successfully`
    });
  } catch (error) {
    console.error('Event ingestion error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// WebSocket server for real-time events
const wss = new WebSocketServer({ port: WS_PORT });
const wsClients = new Set();

wss.on('connection', (ws) => {
  wsClients.add(ws);
  console.log('WebSocket client connected. Total clients:', wsClients.size);
  
  // Send connection confirmation
  ws.send(JSON.stringify({ 
    type: 'connected', 
    timestamp: Date.now() 
  }));
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      // Handle different message types
      switch (data.type) {
        case 'authenticate':
          try {
            // Authenticate WebSocket connection
            if (data.token) {
              const decoded = await authService.verifyToken(data.token);
              if (decoded.success) {
                ws.user = decoded.user;
                ws.tenantId = decoded.user.tenantId;
                ws.authenticated = true;
                ws.send(JSON.stringify({ 
                  type: 'authenticated', 
                  user: decoded.user 
                }));
              } else {
                ws.send(JSON.stringify({ 
                  type: 'auth_error', 
                  message: 'Invalid token' 
                }));
              }
            } else if (data.apiKey) {
              const decoded = await authService.verifyAPIKey(data.apiKey);
              if (decoded.success) {
                ws.user = { id: 'api-key', tenantId: decoded.tenantId };
                ws.tenantId = decoded.tenantId;
                ws.authenticated = true;
                ws.send(JSON.stringify({ 
                  type: 'authenticated', 
                  user: ws.user 
                }));
              } else {
                ws.send(JSON.stringify({ 
                  type: 'auth_error', 
                  message: 'Invalid API key' 
                }));
              }
            } else {
              ws.send(JSON.stringify({ 
                type: 'auth_error', 
                message: 'Token or API key required' 
              }));
            }
          } catch (error) {
            ws.send(JSON.stringify({ 
              type: 'auth_error', 
              message: 'Authentication failed' 
            }));
          }
          break;
          
        case 'subscribe':
          if (!ws.authenticated) {
            ws.send(JSON.stringify({ 
              type: 'error', 
              message: 'Authentication required' 
            }));
            break;
          }
          
          ws.subscriptions = data.subscriptions || [];
          ws.send(JSON.stringify({ 
            type: 'subscribed', 
            subscriptions: ws.subscriptions 
          }));
          break;
          
        case 'query':
          if (!ws.authenticated) {
            ws.send(JSON.stringify({ 
              type: 'error', 
              message: 'Authentication required' 
            }));
            break;
          }
          
          const result = await queryEngine.query(data.query, { tenantId: ws.tenantId });
          ws.send(JSON.stringify({ 
            type: 'query_result', 
            id: data.id,
            result 
          }));
          break;
          
        default:
          ws.send(JSON.stringify({ 
            type: 'error', 
            message: 'Unknown message type' 
          }));
      }
    } catch (error) {
      ws.send(JSON.stringify({ 
        type: 'error', 
        message: error.message 
      }));
    }
  });
  
  ws.on('close', () => {
    wsClients.delete(ws);
    console.log('WebSocket client disconnected. Total clients:', wsClients.size);
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    wsClients.delete(ws);
  });
});

// Broadcast events to WebSocket clients
function broadcastEvents(events) {
  wsClients.forEach(client => {
    if (client.readyState === 1 && client.authenticated) { // WebSocket.OPEN and authenticated
      // Filter events by tenant
      const tenantEvents = events.filter(event => 
        event.tenantId === client.tenantId
      );
      
      if (tenantEvents.length === 0) return;
      
      // Check subscriptions
      let filteredEvents = tenantEvents;
      
      if (client.subscriptions && client.subscriptions.length > 0) {
        // Filter events based on subscriptions
        filteredEvents = tenantEvents.filter(event => {
          return client.subscriptions.some(sub => {
            if (sub.service && event.serviceId !== sub.service) return false;
            if (sub.type && event.eventType !== sub.type) return false;
            if (sub.minAnomalyScore && event.anomalyScore < sub.minAnomalyScore) return false;
            return true;
          });
        });
      }
      
      if (filteredEvents.length > 0) {
        client.send(JSON.stringify({ 
          type: 'events', 
          events: filteredEvents,
          timestamp: Date.now()
        }));
      }
    }
  });
}

// Connect event collector to storage
const collector = new EventCollector({
  serviceId: 'traversion-api',
  serviceName: 'Traversion API'
});

collector.on('event:collected', async (event) => {
  try {
    // Process through causality engine
    causalityEngine.processEvent(event);
    
    // Store in database
    await storage.storeEvent(event);
    
    // Broadcast to clients
    broadcastEvents([event]);
  } catch (error) {
    console.error('Failed to process collected event:', error);
  }
});

// Connect causality engine to storage
causalityEngine.on('causality:detected', async ({ cause, effect, confidence, type }) => {
  try {
    await storage.storeCausality(cause, effect, confidence, type);
    
    // Record causality metrics
    metrics.recordCausalityDetection(cause.tenantId || 'unknown', type, confidence);
    metrics.setGauge('causality_graph_size', '', [cause.tenantId || 'unknown'], causalityEngine.causalityGraph.size);
  } catch (error) {
    console.error('Failed to store causality:', error);
  }
});

causalityEngine.on('pattern:matched', async ({ pattern }) => {
  try {
    await storage.storePattern(pattern);
  } catch (error) {
    console.error('Failed to store pattern:', error);
  }
});

// Error handling middleware with security sanitization
app.use(authMiddleware.sanitizeErrors);
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    success: false, 
    error: 'Internal server error' 
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    error: 'Endpoint not found' 
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  
  // Close WebSocket server
  wss.close(() => {
    console.log('WebSocket server closed');
  });
  
  // Disconnect from databases
  await storage.disconnect();
  await collector.shutdown();
  
  // Shutdown monitoring
  metrics.shutdown();
  alerting.shutdown();
  
  // Shutdown backup and export services
  await backupManager.shutdown();
  await dataExporter.shutdown();
  await scheduledBackups.shutdown();
  
  process.exit(0);
});

// Start server
async function start() {
  try {
    // Connect to database
    await storage.connect();
    
    // Initialize authentication service
    console.log('Initializing authentication service...');
    await authService.initialize();
    
    // Create default admin user if none exists
    const adminExists = await storage.query(
      'SELECT COUNT(*) as count FROM users WHERE role = $1', 
      ['admin']
    );
    
    if (adminExists.rows[0].count === '0') {
      console.log('Creating default admin user...');
      const defaultTenant = await authService.createTenant('Default Organization');
      if (defaultTenant.success) {
        const adminResult = await authService.createUser(
          'admin@traversion.local',
          'admin123',
          'System Administrator',
          defaultTenant.tenant.id,
          'admin'
        );
        
        if (adminResult.success) {
          console.log('✓ Default admin created: admin@traversion.local / admin123');
          console.log('✓ Change the default password after first login');
        }
      }
    }
    
    // Load historical events into causality engine (last hour)
    console.log('Loading recent events...');
    const recentEvents = await storage.queryTimeRange(
      Date.now() - 3600000,
      Date.now()
    );
    
    for (const event of recentEvents) {
      causalityEngine.processEvent(event);
    }
    
    console.log(`Loaded ${recentEvents.length} recent events`);
    
    // Start cleanup timer for rate limiting
    authMiddleware.startCleanupTimer();
    
    // Start API server
    app.listen(PORT, () => {
      console.log(`✓ API server running on http://localhost:${PORT}`);
      console.log(`✓ WebSocket server running on ws://localhost:${WS_PORT}`);
      console.log(`✓ Security middleware enabled with rate limiting and input sanitization`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
start();