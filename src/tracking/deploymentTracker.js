import EventEmitter from 'events';
import WebSocket from 'ws';
import simpleGit from 'simple-git';
import { MonitoringIntegrations } from '../integrations/monitoringIntegrations.js';
import logger from '../utils/logger.js';

/**
 * Real-time Deployment Tracking System
 *
 * Tracks deployments as they happen and correlates them with monitoring data
 * for instant incident detection and causality analysis.
 */
export class DeploymentTracker extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      port: config.port || 3341,
      checkInterval: config.checkInterval || 5000,
      correlationWindow: config.correlationWindow || 300000, // 5 minutes
      ...config
    };

    // Core components
    this.deployments = new Map();
    this.activeDeployments = new Set();
    this.deploymentMetrics = new Map();

    // Git tracking
    this.git = simpleGit();
    this.lastCommit = null;

    // Monitoring integration
    this.monitoring = new MonitoringIntegrations(config.monitoring || {});

    // WebSocket for real-time updates
    this.wss = null;
    this.clients = new Set();

    // Deployment state
    this.deploymentHistory = [];
    this.correlations = new Map();
  }

  /**
   * Start the deployment tracker
   */
  async start() {
    try {
      // Initialize WebSocket server
      this.setupWebSocketServer();

      // Start deployment detection
      this.startDeploymentDetection();

      // Start monitoring correlation
      this.startMonitoringCorrelation();

      // Initialize webhook listeners
      await this.setupWebhooks();

      logger.info('Deployment tracker started', {
        port: this.config.port,
        checkInterval: this.config.checkInterval
      });

      this.emit('started');

    } catch (error) {
      logger.error('Failed to start deployment tracker', { error: error.message });
      throw error;
    }
  }

  /**
   * Setup WebSocket server for real-time updates
   */
  setupWebSocketServer() {
    this.wss = new WebSocket.Server({ port: this.config.port });

    this.wss.on('connection', (ws, req) => {
      const clientId = this.generateClientId();
      const client = { id: clientId, ws, ip: req.socket.remoteAddress };

      this.clients.add(client);
      logger.info('Client connected to deployment tracker', { clientId, ip: client.ip });

      // Send initial state
      this.sendToClient(client, {
        type: 'initial_state',
        deployments: Array.from(this.deployments.values()),
        activeDeployments: Array.from(this.activeDeployments)
      });

      ws.on('message', (message) => {
        this.handleClientMessage(client, message);
      });

      ws.on('close', () => {
        this.clients.delete(client);
        logger.info('Client disconnected from deployment tracker', { clientId });
      });

      ws.on('error', (error) => {
        logger.error('WebSocket error', { clientId, error: error.message });
      });
    });
  }

  /**
   * Start deployment detection
   */
  startDeploymentDetection() {
    // Check for new deployments periodically
    this.deploymentCheckInterval = setInterval(async () => {
      await this.checkForNewDeployments();
    }, this.config.checkInterval);

    // Initial check
    this.checkForNewDeployments();
  }

  /**
   * Check for new deployments
   */
  async checkForNewDeployments() {
    try {
      // Check Git for new commits
      const currentCommit = await this.getCurrentCommit();

      if (currentCommit && currentCommit !== this.lastCommit) {
        await this.handleNewDeployment(currentCommit);
        this.lastCommit = currentCommit;
      }

      // Check for CI/CD deployments via webhooks
      // This is handled by webhook listeners

    } catch (error) {
      logger.error('Error checking for deployments', { error: error.message });
    }
  }

  /**
   * Get current Git commit
   */
  async getCurrentCommit() {
    try {
      const log = await this.git.log({ n: 1 });
      return log.latest ? log.latest.hash : null;
    } catch (error) {
      logger.error('Error getting current commit', { error: error.message });
      return null;
    }
  }

  /**
   * Handle new deployment
   */
  async handleNewDeployment(commitHash) {
    try {
      const deployment = await this.createDeploymentRecord(commitHash);

      // Store deployment
      this.deployments.set(deployment.id, deployment);
      this.activeDeployments.add(deployment.id);
      this.deploymentHistory.push(deployment);

      // Emit deployment event
      this.emit('deployment', deployment);

      // Broadcast to clients
      this.broadcast({
        type: 'new_deployment',
        deployment
      });

      // Start monitoring this deployment
      this.startDeploymentMonitoring(deployment);

      // Analyze deployment risk
      await this.analyzeDeploymentRisk(deployment);

      logger.info('New deployment detected', {
        deploymentId: deployment.id,
        commit: deployment.commit.hash
      });

    } catch (error) {
      logger.error('Error handling deployment', { error: error.message });
    }
  }

  /**
   * Create deployment record
   */
  async createDeploymentRecord(commitHash) {
    const commit = await this.getCommitDetails(commitHash);
    const timestamp = new Date();

    return {
      id: this.generateDeploymentId(),
      timestamp,
      commit,
      status: 'in_progress',
      environment: this.detectEnvironment(),
      metrics: {
        startTime: timestamp,
        endTime: null,
        duration: null,
        healthChecks: [],
        errorRate: null,
        responseTime: null
      },
      risk: {
        score: 0,
        factors: [],
        warnings: []
      },
      correlations: {
        alerts: [],
        incidents: [],
        metrics: {}
      }
    };
  }

  /**
   * Get commit details
   */
  async getCommitDetails(hash) {
    try {
      const log = await this.git.log({ from: hash, to: hash, n: 1 });
      const commit = log.latest;

      if (!commit) {
        throw new Error(`Commit ${hash} not found`);
      }

      // Get changed files
      const diff = await this.git.diff(['--name-status', `${hash}^`, hash]);
      const files = this.parseDiffOutput(diff);

      return {
        hash: commit.hash,
        message: commit.message,
        author: commit.author_name,
        email: commit.author_email,
        date: commit.date,
        files,
        stats: {
          additions: 0,
          deletions: 0,
          files: files.length
        }
      };

    } catch (error) {
      logger.error('Error getting commit details', { error: error.message, hash });
      throw error;
    }
  }

  /**
   * Start monitoring a deployment
   */
  startDeploymentMonitoring(deployment) {
    const monitoringInterval = setInterval(async () => {
      try {
        // Collect metrics
        const metrics = await this.collectDeploymentMetrics(deployment);
        deployment.metrics = { ...deployment.metrics, ...metrics };

        // Check for anomalies
        const anomalies = await this.detectAnomalies(deployment);

        if (anomalies.length > 0) {
          this.handleDeploymentAnomalies(deployment, anomalies);
        }

        // Update deployment status
        this.updateDeploymentStatus(deployment);

        // Broadcast update
        this.broadcast({
          type: 'deployment_update',
          deployment
        });

        // Stop monitoring if deployment is complete
        if (deployment.status === 'completed' || deployment.status === 'failed') {
          clearInterval(monitoringInterval);
          this.activeDeployments.delete(deployment.id);
        }

      } catch (error) {
        logger.error('Error monitoring deployment', {
          deploymentId: deployment.id,
          error: error.message
        });
      }
    }, 10000); // Check every 10 seconds
  }

  /**
   * Collect deployment metrics
   */
  async collectDeploymentMetrics(deployment) {
    const metrics = {
      healthChecks: [],
      errorRate: 0,
      responseTime: 0,
      cpu: 0,
      memory: 0
    };

    try {
      // Fetch metrics from monitoring integrations
      const monitoringData = await this.monitoring.enrichIncidentWithMonitoringData({
        createdAt: deployment.timestamp,
        resolvedAt: null
      });

      // Extract relevant metrics
      if (monitoringData.metrics) {
        Object.entries(monitoringData.metrics).forEach(([source, sourceMetrics]) => {
          if (sourceMetrics['avg:system.cpu.user']) {
            metrics.cpu = sourceMetrics['avg:system.cpu.user'];
          }
          if (sourceMetrics['avg:system.mem.pct_usable']) {
            metrics.memory = sourceMetrics['avg:system.mem.pct_usable'];
          }
        });
      }

      // Check for correlated alerts
      if (monitoringData.correlatedAlerts) {
        deployment.correlations.alerts = monitoringData.correlatedAlerts;
      }

    } catch (error) {
      logger.error('Error collecting deployment metrics', {
        deploymentId: deployment.id,
        error: error.message
      });
    }

    return metrics;
  }

  /**
   * Detect anomalies in deployment
   */
  async detectAnomalies(deployment) {
    const anomalies = [];

    // Check error rate spike
    if (deployment.metrics.errorRate > 5) {
      anomalies.push({
        type: 'error_rate_spike',
        severity: 'high',
        value: deployment.metrics.errorRate,
        threshold: 5,
        message: `Error rate spiked to ${deployment.metrics.errorRate}%`
      });
    }

    // Check response time degradation
    if (deployment.metrics.responseTime > 1000) {
      anomalies.push({
        type: 'response_time_degradation',
        severity: 'medium',
        value: deployment.metrics.responseTime,
        threshold: 1000,
        message: `Response time degraded to ${deployment.metrics.responseTime}ms`
      });
    }

    // Check for correlated alerts
    if (deployment.correlations.alerts.length > 0) {
      const criticalAlerts = deployment.correlations.alerts.filter(
        alert => alert.severity === 'critical'
      );

      if (criticalAlerts.length > 0) {
        anomalies.push({
          type: 'critical_alerts',
          severity: 'critical',
          value: criticalAlerts.length,
          alerts: criticalAlerts,
          message: `${criticalAlerts.length} critical alerts detected`
        });
      }
    }

    // Check CPU/Memory spikes
    if (deployment.metrics.cpu > 80) {
      anomalies.push({
        type: 'cpu_spike',
        severity: 'medium',
        value: deployment.metrics.cpu,
        threshold: 80,
        message: `CPU usage at ${deployment.metrics.cpu}%`
      });
    }

    if (deployment.metrics.memory > 90) {
      anomalies.push({
        type: 'memory_spike',
        severity: 'high',
        value: deployment.metrics.memory,
        threshold: 90,
        message: `Memory usage at ${deployment.metrics.memory}%`
      });
    }

    return anomalies;
  }

  /**
   * Handle deployment anomalies
   */
  handleDeploymentAnomalies(deployment, anomalies) {
    deployment.anomalies = anomalies;

    // Determine if deployment should be marked as problematic
    const criticalAnomalies = anomalies.filter(a => a.severity === 'critical');
    const highAnomalies = anomalies.filter(a => a.severity === 'high');

    if (criticalAnomalies.length > 0) {
      deployment.status = 'failed';
      this.triggerIncident(deployment, anomalies);
    } else if (highAnomalies.length >= 2) {
      deployment.status = 'degraded';
      this.emit('deployment_degraded', deployment, anomalies);
    }

    // Emit anomaly event
    this.emit('deployment_anomalies', deployment, anomalies);

    // Broadcast to clients
    this.broadcast({
      type: 'deployment_anomalies',
      deploymentId: deployment.id,
      anomalies
    });

    logger.warn('Deployment anomalies detected', {
      deploymentId: deployment.id,
      anomalyCount: anomalies.length,
      severities: anomalies.map(a => a.severity)
    });
  }

  /**
   * Trigger incident from deployment
   */
  triggerIncident(deployment, anomalies) {
    const incident = {
      id: this.generateIncidentId(),
      timestamp: new Date(),
      deploymentId: deployment.id,
      commit: deployment.commit,
      anomalies,
      severity: 'critical',
      status: 'active',
      title: `Deployment ${deployment.id} failed with critical anomalies`,
      description: this.generateIncidentDescription(deployment, anomalies),
      recommendations: this.generateIncidentRecommendations(deployment, anomalies)
    };

    // Store incident correlation
    deployment.correlations.incidents.push(incident);

    // Emit incident event
    this.emit('incident_detected', incident);

    // Broadcast to clients
    this.broadcast({
      type: 'incident_detected',
      incident
    });

    logger.error('Incident triggered from deployment', {
      incidentId: incident.id,
      deploymentId: deployment.id,
      severity: incident.severity
    });

    return incident;
  }

  /**
   * Analyze deployment risk
   */
  async analyzeDeploymentRisk(deployment) {
    const risk = {
      score: 0,
      factors: [],
      warnings: []
    };

    // Time-based risk
    const hour = new Date(deployment.timestamp).getHours();
    const day = new Date(deployment.timestamp).getDay();

    if (day === 0 || day === 6) {
      risk.score += 0.2;
      risk.factors.push('Weekend deployment');
    }

    if (hour < 6 || hour > 22) {
      risk.score += 0.15;
      risk.factors.push('Off-hours deployment');
    }

    // File-based risk
    const riskyFiles = deployment.commit.files.filter(file =>
      file.match(/config|env|database|migration|schema/i)
    );

    if (riskyFiles.length > 0) {
      risk.score += 0.3;
      risk.factors.push(`${riskyFiles.length} risky files modified`);
      risk.warnings.push(`Configuration/database changes detected`);
    }

    // Size-based risk
    if (deployment.commit.files.length > 20) {
      risk.score += 0.2;
      risk.factors.push('Large deployment');
    }

    // Message-based risk
    if (deployment.commit.message.match(/hotfix|emergency|critical|urgent/i)) {
      risk.score += 0.25;
      risk.factors.push('Urgent deployment');
      risk.warnings.push('Deployment marked as urgent/critical');
    }

    // Cap risk score at 1.0
    risk.score = Math.min(risk.score, 1.0);

    deployment.risk = risk;

    // Emit high-risk deployment event
    if (risk.score > 0.7) {
      this.emit('high_risk_deployment', deployment);

      this.broadcast({
        type: 'high_risk_deployment',
        deployment
      });
    }

    return risk;
  }

  /**
   * Start monitoring correlation
   */
  startMonitoringCorrelation() {
    // Correlate deployments with monitoring data every minute
    setInterval(async () => {
      for (const deploymentId of this.activeDeployments) {
        const deployment = this.deployments.get(deploymentId);
        if (deployment) {
          await this.correlateWithMonitoring(deployment);
        }
      }
    }, 60000);
  }

  /**
   * Correlate deployment with monitoring data
   */
  async correlateWithMonitoring(deployment) {
    try {
      const monitoringData = await this.monitoring.enrichIncidentWithMonitoringData({
        createdAt: deployment.timestamp,
        resolvedAt: new Date()
      });

      // Store correlations
      deployment.correlations = {
        alerts: monitoringData.correlatedAlerts || [],
        metrics: monitoringData.metrics || {},
        insights: monitoringData.insights || []
      };

      // Check if deployment caused issues
      if (deployment.correlations.alerts.length > 0) {
        const correlation = {
          deploymentId: deployment.id,
          alerts: deployment.correlations.alerts,
          confidence: this.calculateCorrelationConfidence(deployment, monitoringData),
          timestamp: new Date()
        };

        this.correlations.set(deployment.id, correlation);

        // Emit correlation event
        this.emit('deployment_correlation', correlation);
      }

    } catch (error) {
      logger.error('Error correlating deployment with monitoring', {
        deploymentId: deployment.id,
        error: error.message
      });
    }
  }

  /**
   * Calculate correlation confidence
   */
  calculateCorrelationConfidence(deployment, monitoringData) {
    let confidence = 0;

    // Time proximity
    const alerts = monitoringData.correlatedAlerts || [];
    if (alerts.length > 0) {
      const avgTimeProximity = alerts.reduce((sum, alert) =>
        sum + (alert.correlation?.timeProximity || 0), 0
      ) / alerts.length;
      confidence += avgTimeProximity * 0.5;
    }

    // Service match
    const avgServiceMatch = alerts.reduce((sum, alert) =>
      sum + (alert.correlation?.serviceMatch || 0), 0
    ) / Math.max(alerts.length, 1);
    confidence += avgServiceMatch * 0.3;

    // Severity match
    const criticalAlerts = alerts.filter(a => a.severity === 'critical').length;
    if (criticalAlerts > 0) {
      confidence += 0.2;
    }

    return Math.min(confidence, 1.0);
  }

  /**
   * Setup webhook listeners
   */
  async setupWebhooks() {
    // This would be implemented to listen for CI/CD webhooks
    // GitHub Actions, Jenkins, CircleCI, etc.
    logger.info('Webhook listeners initialized');
  }

  /**
   * Update deployment status
   */
  updateDeploymentStatus(deployment) {
    const now = new Date();
    const deploymentDuration = now - deployment.timestamp;

    // Auto-complete deployment after 10 minutes if no issues
    if (deploymentDuration > 600000 && deployment.status === 'in_progress') {
      deployment.status = 'completed';
      deployment.metrics.endTime = now;
      deployment.metrics.duration = deploymentDuration;
    }
  }

  /**
   * Handle client messages
   */
  handleClientMessage(client, message) {
    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case 'subscribe':
          client.subscriptions = data.subscriptions || ['all'];
          break;

        case 'get_deployment':
          const deployment = this.deployments.get(data.deploymentId);
          if (deployment) {
            this.sendToClient(client, {
              type: 'deployment_details',
              deployment
            });
          }
          break;

        case 'get_history':
          this.sendToClient(client, {
            type: 'deployment_history',
            deployments: this.deploymentHistory.slice(-50)
          });
          break;

        default:
          logger.warn('Unknown client message type', { type: data.type });
      }

    } catch (error) {
      logger.error('Error handling client message', {
        clientId: client.id,
        error: error.message
      });
    }
  }

  /**
   * Broadcast to all connected clients
   */
  broadcast(data) {
    const message = JSON.stringify(data);

    for (const client of this.clients) {
      try {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(message);
        }
      } catch (error) {
        logger.error('Error broadcasting to client', {
          clientId: client.id,
          error: error.message
        });
      }
    }
  }

  /**
   * Send to specific client
   */
  sendToClient(client, data) {
    try {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify(data));
      }
    } catch (error) {
      logger.error('Error sending to client', {
        clientId: client.id,
        error: error.message
      });
    }
  }

  /**
   * Generate deployment ID
   */
  generateDeploymentId() {
    return `dep_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate client ID
   */
  generateClientId() {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate incident ID
   */
  generateIncidentId() {
    return `inc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Parse diff output
   */
  parseDiffOutput(diff) {
    const lines = diff.split('\n');
    return lines
      .filter(line => line.trim())
      .map(line => {
        const parts = line.split('\t');
        return parts[1] || line;
      });
  }

  /**
   * Detect environment
   */
  detectEnvironment() {
    // This would detect the deployment environment
    // Based on branch, CI variables, etc.
    return process.env.NODE_ENV || 'development';
  }

  /**
   * Generate incident description
   */
  generateIncidentDescription(deployment, anomalies) {
    let description = `Deployment ${deployment.id} failed with critical issues.\n\n`;
    description += `Commit: ${deployment.commit.hash}\n`;
    description += `Author: ${deployment.commit.author}\n`;
    description += `Message: ${deployment.commit.message}\n\n`;
    description += `Anomalies detected:\n`;

    anomalies.forEach(anomaly => {
      description += `- ${anomaly.message} (${anomaly.severity})\n`;
    });

    return description;
  }

  /**
   * Generate incident recommendations
   */
  generateIncidentRecommendations(deployment, anomalies) {
    const recommendations = [];

    // Always recommend rollback for critical failures
    recommendations.push({
      priority: 'high',
      action: 'rollback',
      description: `Roll back to previous deployment before ${deployment.commit.hash}`
    });

    // Specific recommendations based on anomaly types
    anomalies.forEach(anomaly => {
      switch (anomaly.type) {
        case 'error_rate_spike':
          recommendations.push({
            priority: 'high',
            action: 'investigate',
            description: 'Check application logs for error details'
          });
          break;

        case 'response_time_degradation':
          recommendations.push({
            priority: 'medium',
            action: 'scale',
            description: 'Consider scaling up resources or optimizing queries'
          });
          break;

        case 'memory_spike':
          recommendations.push({
            priority: 'high',
            action: 'investigate',
            description: 'Check for memory leaks or excessive resource usage'
          });
          break;
      }
    });

    return recommendations;
  }

  /**
   * Stop the deployment tracker
   */
  stop() {
    if (this.deploymentCheckInterval) {
      clearInterval(this.deploymentCheckInterval);
    }

    if (this.wss) {
      this.wss.close();
    }

    this.emit('stopped');
    logger.info('Deployment tracker stopped');
  }
}

export default DeploymentTracker;