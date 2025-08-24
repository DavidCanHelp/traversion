/**
 * Alerting Engine for Traversion Production Platform
 * 
 * Monitors metrics, detects anomalies, and sends alerts for critical issues.
 * Supports multiple notification channels and alert severity levels.
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import nodemailer from 'nodemailer';

class AlertingEngine extends EventEmitter {
  constructor(storage, options = {}) {
    super();
    
    this.storage = storage;
    this.options = {
      checkInterval: options.checkInterval || 60000, // 1 minute
      alertCooldown: options.alertCooldown || 300000, // 5 minutes
      emailConfig: options.emailConfig || null,
      slackWebhook: options.slackWebhook || null,
      pagerDutyKey: options.pagerDutyKey || null,
      ...options
    };
    
    // Alert rules configuration
    this.alertRules = new Map();
    this.activeAlerts = new Map();
    this.alertHistory = [];
    
    // Notification channels
    this.notificationChannels = [];
    this._initializeChannels();
    
    // Initialize default alert rules
    this._initializeDefaultRules();
    
    // Start monitoring
    this.monitoringInterval = setInterval(() => {
      this._checkAlertRules();
    }, this.options.checkInterval);
  }
  
  _initializeChannels() {
    // Email notifications
    if (this.options.emailConfig) {
      this.emailTransporter = nodemailer.createTransporter({
        host: this.options.emailConfig.host,
        port: this.options.emailConfig.port,
        secure: this.options.emailConfig.secure,
        auth: {
          user: this.options.emailConfig.user,
          pass: this.options.emailConfig.pass
        }
      });
      
      this.notificationChannels.push({
        type: 'email',
        name: 'Email',
        send: this._sendEmailAlert.bind(this)
      });
    }
    
    // Slack notifications
    if (this.options.slackWebhook) {
      this.notificationChannels.push({
        type: 'slack',
        name: 'Slack',
        send: this._sendSlackAlert.bind(this)
      });
    }
    
    // PagerDuty notifications
    if (this.options.pagerDutyKey) {
      this.notificationChannels.push({
        type: 'pagerduty',
        name: 'PagerDuty',
        send: this._sendPagerDutyAlert.bind(this)
      });
    }
    
    // Console notifications (always available)
    this.notificationChannels.push({
      type: 'console',
      name: 'Console',
      send: this._sendConsoleAlert.bind(this)
    });
  }
  
  _initializeDefaultRules() {
    // High error rate
    this.addAlertRule({
      name: 'high_error_rate',
      severity: 'critical',
      description: 'High error rate detected',
      condition: 'error_rate > 0.05', // 5% error rate
      query: `
        SELECT 
          tenant_id,
          (COUNT(*) FILTER (WHERE event_type LIKE '%error%' OR event_type LIKE '%exception%')) * 1.0 / COUNT(*) as error_rate
        FROM events 
        WHERE timestamp > NOW() - INTERVAL '5 minutes'
        GROUP BY tenant_id
        HAVING error_rate > 0.05
      `,
      channels: ['email', 'slack', 'pagerduty'],
      cooldown: 300000 // 5 minutes
    });
    
    // Memory usage high
    this.addAlertRule({
      name: 'high_memory_usage',
      severity: 'warning',
      description: 'High memory usage detected',
      condition: 'memory_usage > 0.85', // 85% memory usage
      query: `
        SELECT 
          'system' as component,
          extract(epoch from now()) as timestamp,
          0.9 as memory_usage
        WHERE (SELECT pg_size_pretty(pg_database_size(current_database()))) > '1GB'
      `,
      channels: ['email', 'slack'],
      cooldown: 600000 // 10 minutes
    });
    
    // Database connection issues
    this.addAlertRule({
      name: 'database_connection_issues',
      severity: 'critical',
      description: 'Database connection problems detected',
      condition: 'connection_errors > 10',
      query: `
        SELECT 
          COUNT(*) as connection_errors
        FROM events 
        WHERE 
          timestamp > NOW() - INTERVAL '2 minutes'
          AND (data->>'error' ILIKE '%connection%' OR data->>'error' ILIKE '%timeout%')
        HAVING COUNT(*) > 10
      `,
      channels: ['email', 'slack', 'pagerduty'],
      cooldown: 180000 // 3 minutes
    });
    
    // Causality detection anomalies
    this.addAlertRule({
      name: 'causality_detection_anomaly',
      severity: 'warning',
      description: 'Unusual causality detection patterns',
      condition: 'avg_confidence < 0.3',
      query: `
        SELECT 
          AVG(confidence) as avg_confidence,
          COUNT(*) as detection_count
        FROM causality 
        WHERE detected_at > NOW() - INTERVAL '10 minutes'
        HAVING AVG(confidence) < 0.3 AND COUNT(*) > 100
      `,
      channels: ['slack'],
      cooldown: 900000 // 15 minutes
    });
    
    // Query performance degradation
    this.addAlertRule({
      name: 'slow_query_performance',
      severity: 'warning',
      description: 'Query performance degradation detected',
      condition: 'avg_execution_time > 5000',
      query: `
        SELECT 
          AVG(execution_time_ms) as avg_execution_time,
          COUNT(*) as query_count
        FROM query_cache 
        WHERE created_at > NOW() - INTERVAL '5 minutes'
        HAVING AVG(execution_time_ms) > 5000
      `,
      channels: ['email', 'slack'],
      cooldown: 600000 // 10 minutes
    });
    
    // Disk space warning
    this.addAlertRule({
      name: 'low_disk_space',
      severity: 'warning',
      description: 'Low disk space warning',
      condition: 'disk_usage > 0.8',
      query: `
        SELECT 
          pg_database_size(current_database()) * 1.0 / (1024*1024*1024) as size_gb,
          0.85 as disk_usage
        WHERE pg_database_size(current_database()) > 5 * 1024*1024*1024
      `,
      channels: ['email', 'slack'],
      cooldown: 3600000 // 1 hour
    });
    
    // Authentication failures
    this.addAlertRule({
      name: 'auth_failure_spike',
      severity: 'security',
      description: 'Spike in authentication failures detected',
      condition: 'auth_failures > 50',
      query: `
        SELECT 
          COUNT(*) as auth_failures,
          tenant_id
        FROM audit_log 
        WHERE 
          timestamp > NOW() - INTERVAL '5 minutes'
          AND action = 'auth.login'
          AND details->>'result' = 'failure'
        GROUP BY tenant_id
        HAVING COUNT(*) > 50
      `,
      channels: ['email', 'slack', 'pagerduty'],
      cooldown: 300000 // 5 minutes
    });
  }
  
  // Add custom alert rule
  addAlertRule(rule) {
    const alertRule = {
      id: rule.name,
      name: rule.name,
      severity: rule.severity || 'warning',
      description: rule.description,
      condition: rule.condition,
      query: rule.query,
      channels: rule.channels || ['console'],
      cooldown: rule.cooldown || this.options.alertCooldown,
      enabled: rule.enabled !== false,
      metadata: rule.metadata || {},
      createdAt: new Date(),
      lastTriggered: null
    };
    
    this.alertRules.set(rule.name, alertRule);
    
    this.emit('rule:added', alertRule);
  }
  
  // Remove alert rule
  removeAlertRule(ruleName) {
    const rule = this.alertRules.get(ruleName);
    if (rule) {
      this.alertRules.delete(ruleName);
      this.emit('rule:removed', rule);
    }
  }
  
  // Enable/disable alert rule
  toggleAlertRule(ruleName, enabled) {
    const rule = this.alertRules.get(ruleName);
    if (rule) {
      rule.enabled = enabled;
      this.emit('rule:toggled', rule);
    }
  }
  
  // Check all alert rules
  async _checkAlertRules() {
    for (const [ruleName, rule] of this.alertRules) {
      if (!rule.enabled) continue;
      
      try {
        await this._checkRule(rule);
      } catch (error) {
        logger.error(`Error checking rule ${ruleName}:`, error);
        this.emit('rule:error', { rule, error });
      }
    }
  }
  
  // Check individual alert rule
  async _checkRule(rule) {
    const now = Date.now();
    const lastTriggered = rule.lastTriggered;
    
    // Check cooldown period
    if (lastTriggered && (now - lastTriggered) < rule.cooldown) {
      return;
    }
    
    // Execute query
    const result = await this.storage.query(rule.query);
    
    if (result.rows && result.rows.length > 0) {
      // Alert condition met
      const alertData = result.rows[0];
      
      const alert = {
        id: `${rule.name}_${now}`,
        ruleName: rule.name,
        severity: rule.severity,
        title: rule.description,
        description: this._formatAlertDescription(rule, alertData),
        data: alertData,
        timestamp: new Date(),
        status: 'firing'
      };
      
      await this._triggerAlert(alert, rule);
    } else {
      // Check if there's an active alert to resolve
      const activeAlert = this.activeAlerts.get(rule.name);
      if (activeAlert && activeAlert.status === 'firing') {
        await this._resolveAlert(activeAlert, rule);
      }
    }
  }
  
  // Trigger alert
  async _triggerAlert(alert, rule) {
    // Store active alert
    this.activeAlerts.set(rule.name, alert);
    
    // Update rule last triggered time
    rule.lastTriggered = Date.now();
    
    // Store in database
    await this._storeAlert(alert);
    
    // Send notifications
    await this._sendNotifications(alert, rule);
    
    // Add to history
    this.alertHistory.unshift(alert);
    if (this.alertHistory.length > 1000) {
      this.alertHistory.pop();
    }
    
    this.emit('alert:triggered', alert);
  }
  
  // Resolve alert
  async _resolveAlert(alert, rule) {
    alert.status = 'resolved';
    alert.resolvedAt = new Date();
    
    // Update in database
    await this._updateAlert(alert);
    
    // Send resolution notifications
    await this._sendResolutionNotifications(alert, rule);
    
    // Remove from active alerts
    this.activeAlerts.delete(rule.name);
    
    this.emit('alert:resolved', alert);
  }
  
  // Store alert in database
  async _storeAlert(alert) {
    try {
      await this.storage.query(`
        INSERT INTO alerts (
          id, alert_type, severity, message, metadata, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        alert.id,
        alert.ruleName,
        alert.severity,
        alert.description,
        JSON.stringify(alert.data),
        alert.timestamp
      ]);
    } catch (error) {
      logger.error('Failed to store alert:', error);
    }
  }
  
  // Update alert in database
  async _updateAlert(alert) {
    try {
      await this.storage.query(`
        UPDATE alerts 
        SET resolved_at = $1
        WHERE id = $2
      `, [alert.resolvedAt, alert.id]);
    } catch (error) {
      logger.error('Failed to update alert:', error);
    }
  }
  
  // Send notifications through all configured channels
  async _sendNotifications(alert, rule) {
    const promises = rule.channels.map(async (channelType) => {
      const channel = this.notificationChannels.find(c => c.type === channelType);
      if (channel) {
        try {
          await channel.send(alert, 'triggered');
        } catch (error) {
          logger.error(`Failed to send ${channelType} notification:`, error);
        }
      }
    });
    
    await Promise.all(promises);
  }
  
  // Send resolution notifications
  async _sendResolutionNotifications(alert, rule) {
    const promises = rule.channels.map(async (channelType) => {
      const channel = this.notificationChannels.find(c => c.type === channelType);
      if (channel) {
        try {
          await channel.send(alert, 'resolved');
        } catch (error) {
          logger.error(`Failed to send ${channelType} resolution notification:`, error);
        }
      }
    });
    
    await Promise.all(promises);
  }
  
  // Email notification
  async _sendEmailAlert(alert, type) {
    if (!this.emailTransporter) return;
    
    const subject = type === 'resolved' 
      ? `[RESOLVED] ${alert.severity.toUpperCase()}: ${alert.title}`
      : `[${alert.severity.toUpperCase()}] ${alert.title}`;
    
    const html = `
      <h2>Traversion Alert ${type === 'resolved' ? 'Resolved' : 'Triggered'}</h2>
      <p><strong>Severity:</strong> ${alert.severity}</p>
      <p><strong>Rule:</strong> ${alert.ruleName}</p>
      <p><strong>Description:</strong> ${alert.description}</p>
      <p><strong>Timestamp:</strong> ${alert.timestamp.toISOString()}</p>
      ${type === 'resolved' ? `<p><strong>Resolved At:</strong> ${alert.resolvedAt.toISOString()}</p>` : ''}
      <pre><code>${JSON.stringify(alert.data, null, 2)}</code></pre>
    `;
    
    await this.emailTransporter.sendMail({
      from: this.options.emailConfig.from,
      to: this.options.emailConfig.to,
      subject,
      html
    });
  }
  
  // Slack notification
  async _sendSlackAlert(alert, type) {
    const color = {
      critical: 'danger',
      security: 'danger',
      warning: 'warning',
      info: 'good'
    }[alert.severity] || 'warning';
    
    const emoji = type === 'resolved' ? '✅' : '🚨';
    
    const payload = {
      text: `${emoji} Traversion Alert ${type === 'resolved' ? 'Resolved' : 'Triggered'}`,
      attachments: [{
        color,
        title: alert.title,
        fields: [
          { title: 'Severity', value: alert.severity, short: true },
          { title: 'Rule', value: alert.ruleName, short: true },
          { title: 'Time', value: alert.timestamp.toISOString(), short: true }
        ],
        text: alert.description
      }]
    };
    
    const response = await fetch(this.options.slackWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      throw new Error(`Slack notification failed: ${response.statusText}`);
    }
  }
  
  // PagerDuty notification
  async _sendPagerDutyAlert(alert, type) {
    const payload = {
      routing_key: this.options.pagerDutyKey,
      event_action: type === 'resolved' ? 'resolve' : 'trigger',
      dedup_key: `traversion_${alert.ruleName}`,
      payload: {
        summary: alert.title,
        severity: alert.severity,
        source: 'traversion',
        component: alert.ruleName,
        custom_details: alert.data
      }
    };
    
    const response = await fetch('https://events.pagerduty.com/v2/enqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      throw new Error(`PagerDuty notification failed: ${response.statusText}`);
    }
  }
  
  // Console notification
  async _sendConsoleAlert(alert, type) {
    const timestamp = new Date().toISOString();
    const status = type === 'resolved' ? 'RESOLVED' : 'TRIGGERED';
    
    logger.info(`[${timestamp}] ALERT ${status}: [${alert.severity.toUpperCase()}] ${alert.title}`);
    logger.info(`  Rule: ${alert.ruleName}`);
    logger.info(`  Description: ${alert.description}`);
    if (Object.keys(alert.data).length > 0) {
      logger.info(`  Data:`, JSON.stringify(alert.data, null, 2));
    }
    logger.info('');
  }
  
  // Format alert description with data
  _formatAlertDescription(rule, data) {
    let description = rule.description;
    
    // Replace placeholders with actual values
    Object.entries(data).forEach(([key, value]) => {
      description = description.replace(`{{${key}}}`, value);
    });
    
    return description;
  }
  
  // Get alert statistics
  getAlertStats() {
    const activeAlerts = Array.from(this.activeAlerts.values());
    const recentAlerts = this.alertHistory.slice(0, 100);
    
    const stats = {
      activeAlerts: activeAlerts.length,
      activeAlertsBySeverity: {},
      totalRules: this.alertRules.size,
      enabledRules: Array.from(this.alertRules.values()).filter(r => r.enabled).length,
      recentAlerts: recentAlerts.length,
      alertsByRule: {},
      channels: this.notificationChannels.map(c => c.name)
    };
    
    // Count active alerts by severity
    activeAlerts.forEach(alert => {
      stats.activeAlertsBySeverity[alert.severity] = 
        (stats.activeAlertsBySeverity[alert.severity] || 0) + 1;
    });
    
    // Count recent alerts by rule
    recentAlerts.forEach(alert => {
      stats.alertsByRule[alert.ruleName] = 
        (stats.alertsByRule[alert.ruleName] || 0) + 1;
    });
    
    return stats;
  }
  
  // Get active alerts
  getActiveAlerts() {
    return Array.from(this.activeAlerts.values());
  }
  
  // Get alert history
  getAlertHistory(limit = 100) {
    return this.alertHistory.slice(0, limit);
  }
  
  // Manual alert testing
  async testAlert(ruleName, testData = {}) {
    const rule = this.alertRules.get(ruleName);
    if (!rule) {
      throw new Error(`Alert rule '${ruleName}' not found`);
    }
    
    const alert = {
      id: `test_${ruleName}_${Date.now()}`,
      ruleName: rule.name,
      severity: rule.severity,
      title: `[TEST] ${rule.description}`,
      description: 'This is a test alert triggered manually',
      data: testData,
      timestamp: new Date(),
      status: 'test'
    };
    
    await this._sendNotifications(alert, rule);
    
    this.emit('alert:test', alert);
    return alert;
  }
  
  // Cleanup
  shutdown() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    
    if (this.emailTransporter) {
      this.emailTransporter.close();
    }
    
    this.removeAllListeners();
  }
}

export default AlertingEngine;