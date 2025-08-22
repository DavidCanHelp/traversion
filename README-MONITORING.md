# Traversion Monitoring & Alerting Guide

This document covers the comprehensive monitoring and alerting system built into Traversion production platform.

## 🎯 Overview

Traversion includes enterprise-grade monitoring with:

- **Prometheus Metrics**: 40+ production metrics 
- **Grafana Dashboards**: 3 specialized dashboards (Overview, Causality, Security)
- **Smart Alerting**: 15+ alert rules with multi-channel notifications
- **Real-time Monitoring**: Sub-second metric collection
- **Multi-tenant Aware**: All metrics isolated by tenant

## 📊 Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Traversion    │    │   Prometheus    │    │     Grafana     │
│   Services      │───▶│   (Metrics)     │───▶│   (Dashboards)  │
│                 │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │ Alerting Engine │
                       │                 │
                       └─────────────────┘
                                │
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
                 ┌─────┐    ┌─────┐    ┌─────────┐
                 │Email│    │Slack│    │PagerDuty│
                 └─────┘    └─────┘    └─────────┘
```

## 🚀 Quick Start

### 1. Start Monitoring Stack

```bash
# Start with Docker Compose (includes monitoring)
docker-compose up -d

# Check monitoring services
docker-compose ps prometheus grafana
```

### 2. Access Dashboards

- **Grafana**: http://localhost:3000 (admin/admin)
- **Prometheus**: http://localhost:9090
- **Metrics Endpoint**: http://localhost:3338/metrics

### 3. Import Dashboards

Dashboards are auto-imported from:
- `monitoring/grafana/dashboards/traversion-overview.json`
- `monitoring/grafana/dashboards/traversion-causality.json`
- `monitoring/grafana/dashboards/traversion-security.json`

## 📈 Key Metrics

### API Performance
- `traversion_http_requests_total` - Total HTTP requests by endpoint/status
- `traversion_http_request_duration_seconds` - Request latency histograms
- `traversion_websocket_connections` - Active WebSocket connections

### Event Processing
- `traversion_events_total` - Events processed by tenant/type/service
- `traversion_event_processing_duration_seconds` - Processing time per event
- `traversion_storage_events_count` - Total events in storage

### Causality Intelligence
- `traversion_causality_detections_total` - Causality relationships detected
- `traversion_causality_graph_size` - Current graph size per tenant
- `traversion_causality_confidence` - Detection confidence distribution

### Security & Auth
- `traversion_auth_attempts_total` - Authentication attempts (success/failure)
- `traversion_active_sessions` - Active user sessions by tenant
- `traversion_permission_violations_total` - Authorization failures

### System Health
- `traversion_memory_usage_bytes` - Memory usage by type (RSS, heap)
- `traversion_cpu_usage_percent` - CPU utilization
- `traversion_uptime_seconds` - Application uptime

## 🚨 Alert Rules

### Critical Alerts
- **API Down**: Service unavailable for >1 minute
- **Database Down**: TimescaleDB unreachable for >30 seconds  
- **High Error Rate**: >5% 5xx responses for >2 minutes
- **Auth Failure Spike**: >10 failed logins/sec for >1 minute

### Warning Alerts
- **High Memory**: >85% memory usage for >5 minutes
- **Slow Queries**: P95 query time >5 seconds
- **Low Disk Space**: <20% free space
- **Suspicious IP**: >5 failed attempts/sec from single IP

### Security Alerts
- **Permission Violations**: >20 violations in 10 minutes
- **Cross-tenant Access**: Any cross-tenant access attempts
- **Brute Force**: Coordinated login attacks

## 🔔 Notification Channels

### Email Configuration
```bash
# SMTP settings in .env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=alerts@company.com
SMTP_PASS=app-password
ALERT_FROM_EMAIL=traversion@company.com
ALERT_TO_EMAIL=ops-team@company.com
```

### Slack Integration
```bash
# Slack webhook in .env
SLACK_WEBHOOK=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

### PagerDuty Integration  
```bash
# PagerDuty integration key in .env
PAGERDUTY_KEY=your-integration-key
```

## 📱 Grafana Dashboards

### 1. Traversion Production Overview
**URL**: `/d/traversion-overview`

Key panels:
- **System Health**: Service status indicators
- **Events/sec**: Real-time event ingestion rate
- **API Performance**: Request rate and latency
- **Active Alerts**: Current firing alerts
- **Memory & CPU**: Resource utilization
- **WebSocket Connections**: Real-time connection count

### 2. Traversion Causality Intelligence
**URL**: `/d/traversion-causality`

Advanced panels:
- **Causality Detection Rate**: Relationships found per second
- **Confidence Distribution**: Quality of detections
- **Pattern Detection**: Recurring issue patterns
- **Chain Length Analysis**: Root cause investigation depth
- **Processing Performance**: Causality engine speed

### 3. Traversion Security & Authentication  
**URL**: `/d/traversion-security`

Security-focused panels:
- **Authentication Timeline**: Login attempts and failures
- **Suspicious IP Activity**: Potential attacks
- **Permission Violations**: Authorization failures
- **Session Management**: Active user sessions
- **Audit Trail**: Security event timeline

## ⚙️ Configuration

### Metrics Collection
```javascript
// Disable metrics collection
process.env.ENABLE_METRICS = 'false'

// Adjust collection interval (milliseconds)  
process.env.METRICS_COLLECTION_INTERVAL = '30000'
```

### Alert Tuning
```javascript
// Alert check frequency
process.env.ALERT_CHECK_INTERVAL = '60000'

// Minimum time between same alert
process.env.ALERT_COOLDOWN = '300000'
```

### Custom Alert Rules
```javascript
// Add custom alert via API
const alertRule = {
  name: 'custom_high_latency',
  severity: 'warning', 
  description: 'Custom high latency alert',
  query: 'SELECT AVG(duration) FROM requests WHERE timestamp > NOW() - INTERVAL \'5m\' HAVING AVG(duration) > 1000',
  channels: ['slack', 'email'],
  cooldown: 600000
};

alertingEngine.addAlertRule(alertRule);
```

## 🔍 Troubleshooting

### Common Issues

#### Metrics Not Appearing
```bash
# Check metrics endpoint
curl http://localhost:3338/metrics

# Verify Prometheus scraping
curl http://localhost:9090/api/v1/targets

# Check service logs
docker-compose logs prometheus grafana
```

#### Alerts Not Firing
```bash
# Check alert rules
curl http://localhost:9090/api/v1/rules

# Test alert manually
POST /api/internal/alerts/test
{
  "ruleName": "traversion_high_error_rate",
  "testData": {"error_rate": 0.1}
}
```

#### Dashboard Loading Issues
```bash
# Check Grafana datasources  
curl http://admin:admin@localhost:3000/api/datasources

# Verify dashboard files
ls -la monitoring/grafana/dashboards/

# Restart with fresh data
docker-compose down grafana
docker volume rm traversion_grafana_data
docker-compose up -d grafana
```

## 📊 Performance Impact

Monitoring overhead:
- **CPU**: <2% additional CPU usage
- **Memory**: ~50MB additional memory per service
- **Storage**: ~1GB/month for metrics (configurable retention)
- **Network**: ~1KB/sec metrics traffic

## 🎛️ Advanced Features

### Custom Metrics
```javascript
import { metrics } from './monitoring/metricsCollector.js';

// Custom counter
metrics.incrementCounter('custom_events_total', '', ['tenant1', 'custom']);

// Custom gauge  
metrics.setGauge('queue_size', '', ['processing'], queueLength);

// Custom histogram
metrics.observeHistogram('custom_duration_seconds', '', ['operation'], duration/1000);
```

### Dynamic Dashboards
```javascript
// Create tenant-specific dashboard
const tenantDashboard = {
  title: `Tenant ${tenantId} Dashboard`,
  panels: [/* custom panels */]
};

// Import via Grafana API
POST /api/dashboards/db
```

### Alert Integrations
```javascript
// Custom webhook handler
app.post('/webhook/alerts', (req, res) => {
  const alert = req.body;
  
  // Custom logic
  if (alert.severity === 'critical') {
    // Escalate to oncall
    pagerDuty.trigger(alert);
  }
  
  res.json({success: true});
});
```

## 📚 Best Practices

### 1. Alert Hygiene
- **Meaningful Names**: Clear, actionable alert names
- **Proper Severity**: Critical = wake up oncall, Warning = investigate
- **Runbook Links**: Every alert should have resolution steps
- **Regular Review**: Monthly alert effectiveness review

### 2. Dashboard Design
- **User-Focused**: Design for different audiences (ops, dev, business)
- **Actionable**: Every chart should drive decisions
- **Context**: Annotations for deployments, incidents
- **Performance**: Limit time ranges and query complexity

### 3. Metric Naming
- **Consistent**: Follow Prometheus conventions
- **Descriptive**: Include units and context
- **Cardinality**: Avoid high-cardinality labels
- **Documentation**: Document all custom metrics

### 4. Retention Policies
- **Metrics**: 30 days default, extend for long-term trends
- **Alerts**: 90 days for incident correlation
- **Logs**: Coordinate with log retention
- **Dashboards**: Version control for changes

## 🆘 Emergency Procedures

### Monitoring System Down
```bash
# Check system status
curl -f http://localhost:3000/api/health
curl -f http://localhost:9090/-/healthy

# Emergency restart
docker-compose restart prometheus grafana

# Recover from backup
docker-compose down
docker volume rm traversion_prometheus_data
docker-compose up -d
```

### Alert Storm
```bash
# Temporary silence all alerts
curl -X POST http://localhost:9090/api/v1/alerts/silence \
  -d '{"matchers":[{"name":"alertname","value":".*","isRegex":true}],"endsAt":"2024-01-01T12:00:00Z"}'

# Disable specific rule
alertingEngine.toggleAlertRule('traversion_high_error_rate', false);
```

This monitoring system provides enterprise-grade observability for the Traversion platform, ensuring you can detect, diagnose, and resolve issues before they impact users! 🚀📊