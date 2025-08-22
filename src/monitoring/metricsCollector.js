/**
 * Metrics Collector for Traversion Production Platform
 * 
 * Collects and exposes Prometheus-compatible metrics for monitoring
 * system health, performance, and business metrics.
 */

import { EventEmitter } from 'events';

class MetricsCollector extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.namespace = options.namespace || 'traversion';
    this.labels = options.labels || {};
    
    // Metrics storage
    this.counters = new Map();
    this.gauges = new Map();
    this.histograms = new Map();
    this.summaries = new Map();
    
    // Histogram buckets for latency metrics
    this.latencyBuckets = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
    
    // Initialize core metrics
    this._initializeCoreMetrics();
    
    // Start collection interval
    this.collectionInterval = setInterval(() => {
      this._collectSystemMetrics();
    }, options.collectionInterval || 15000); // Every 15 seconds
  }
  
  _initializeCoreMetrics() {
    // Event processing metrics
    this.incrementCounter('events_total', 'Total number of events processed', ['tenant_id', 'event_type', 'service_id']);
    this.incrementCounter('events_errors_total', 'Total number of event processing errors', ['tenant_id', 'error_type']);
    
    // Causality detection metrics
    this.incrementCounter('causality_detections_total', 'Total causality relationships detected', ['tenant_id', 'causality_type']);
    this.setGauge('causality_graph_size', 'Current size of causality graph', ['tenant_id']);
    
    // Query metrics
    this.incrementCounter('queries_total', 'Total number of queries executed', ['tenant_id', 'query_type']);
    this.observeHistogram('query_duration_seconds', 'Query execution duration', ['tenant_id', 'query_type']);
    
    // API metrics
    this.incrementCounter('http_requests_total', 'Total HTTP requests', ['method', 'endpoint', 'status_code']);
    this.observeHistogram('http_request_duration_seconds', 'HTTP request duration', ['method', 'endpoint']);
    
    // WebSocket metrics
    this.setGauge('websocket_connections', 'Active WebSocket connections', ['tenant_id']);
    this.incrementCounter('websocket_messages_total', 'Total WebSocket messages', ['tenant_id', 'message_type']);
    
    // Storage metrics
    this.setGauge('storage_events_count', 'Total events in storage', ['tenant_id']);
    this.observeHistogram('storage_operation_duration_seconds', 'Storage operation duration', ['operation']);
    this.setGauge('storage_size_bytes', 'Storage size in bytes', ['tenant_id']);
    
    // Authentication metrics
    this.incrementCounter('auth_attempts_total', 'Authentication attempts', ['tenant_id', 'method', 'result']);
    this.setGauge('active_sessions', 'Active user sessions', ['tenant_id']);
    
    // System metrics
    this.setGauge('memory_usage_bytes', 'Memory usage in bytes', ['type']);
    this.setGauge('cpu_usage_percent', 'CPU usage percentage');
    this.setGauge('uptime_seconds', 'Application uptime in seconds');
  }
  
  // Counter metrics (monotonically increasing)
  incrementCounter(name, help, labels = [], value = 1) {
    const key = this._getMetricKey(name, labels);
    
    if (!this.counters.has(name)) {
      this.counters.set(name, {
        name,
        help,
        type: 'counter',
        values: new Map(),
        labels: labels
      });
    }
    
    const metric = this.counters.get(name);
    const currentValue = metric.values.get(key) || 0;
    metric.values.set(key, currentValue + value);
    
    // Emit metric update
    this.emit('metric:counter', { name, key, value: currentValue + value });
  }
  
  // Gauge metrics (can go up or down)
  setGauge(name, help, labels = [], value = 0) {
    const key = this._getMetricKey(name, labels);
    
    if (!this.gauges.has(name)) {
      this.gauges.set(name, {
        name,
        help,
        type: 'gauge',
        values: new Map(),
        labels: labels
      });
    }
    
    const metric = this.gauges.get(name);
    metric.values.set(key, value);
    
    // Emit metric update
    this.emit('metric:gauge', { name, key, value });
  }
  
  // Histogram metrics (for distributions)
  observeHistogram(name, help, labels = [], value = 0) {
    const key = this._getMetricKey(name, labels);
    
    if (!this.histograms.has(name)) {
      this.histograms.set(name, {
        name,
        help,
        type: 'histogram',
        buckets: new Map(),
        sums: new Map(),
        counts: new Map(),
        labels: labels
      });
    }
    
    const metric = this.histograms.get(name);
    
    // Update buckets
    if (!metric.buckets.has(key)) {
      metric.buckets.set(key, new Map());
      this.latencyBuckets.forEach(bucket => {
        metric.buckets.get(key).set(bucket, 0);
      });
      metric.buckets.get(key).set('+Inf', 0);
    }
    
    // Increment appropriate buckets
    const buckets = metric.buckets.get(key);
    this.latencyBuckets.forEach(bucket => {
      if (value <= bucket) {
        buckets.set(bucket, buckets.get(bucket) + 1);
      }
    });
    buckets.set('+Inf', buckets.get('+Inf') + 1);
    
    // Update sum and count
    const currentSum = metric.sums.get(key) || 0;
    const currentCount = metric.counts.get(key) || 0;
    metric.sums.set(key, currentSum + value);
    metric.counts.set(key, currentCount + 1);
    
    // Emit metric update
    this.emit('metric:histogram', { name, key, value });
  }
  
  // Summary metrics (quantiles)
  observeSummary(name, help, labels = [], value = 0, quantiles = [0.5, 0.9, 0.95, 0.99]) {
    const key = this._getMetricKey(name, labels);
    
    if (!this.summaries.has(name)) {
      this.summaries.set(name, {
        name,
        help,
        type: 'summary',
        observations: new Map(),
        sums: new Map(),
        counts: new Map(),
        quantiles,
        labels: labels
      });
    }
    
    const metric = this.summaries.get(name);
    
    // Store observations for quantile calculation
    if (!metric.observations.has(key)) {
      metric.observations.set(key, []);
    }
    metric.observations.get(key).push(value);
    
    // Limit observations to prevent memory growth
    const observations = metric.observations.get(key);
    if (observations.length > 10000) {
      observations.splice(0, observations.length - 10000);
    }
    
    // Update sum and count
    const currentSum = metric.sums.get(key) || 0;
    const currentCount = metric.counts.get(key) || 0;
    metric.sums.set(key, currentSum + value);
    metric.counts.set(key, currentCount + 1);
    
    // Emit metric update
    this.emit('metric:summary', { name, key, value });
  }
  
  // Get current metric values
  getMetrics() {
    const metrics = {
      counters: this._serializeCounters(),
      gauges: this._serializeGauges(),
      histograms: this._serializeHistograms(),
      summaries: this._serializeSummaries()
    };
    
    return metrics;
  }
  
  // Export metrics in Prometheus format
  exportPrometheusFormat() {
    let output = '';
    
    // Export counters
    for (const [name, metric] of this.counters) {
      output += `# HELP ${this.namespace}_${name} ${metric.help}\n`;
      output += `# TYPE ${this.namespace}_${name} counter\n`;
      
      for (const [key, value] of metric.values) {
        const labels = this._parseLabelsFromKey(key);
        const labelStr = this._formatLabels(labels);
        output += `${this.namespace}_${name}${labelStr} ${value}\n`;
      }
      output += '\n';
    }
    
    // Export gauges
    for (const [name, metric] of this.gauges) {
      output += `# HELP ${this.namespace}_${name} ${metric.help}\n`;
      output += `# TYPE ${this.namespace}_${name} gauge\n`;
      
      for (const [key, value] of metric.values) {
        const labels = this._parseLabelsFromKey(key);
        const labelStr = this._formatLabels(labels);
        output += `${this.namespace}_${name}${labelStr} ${value}\n`;
      }
      output += '\n';
    }
    
    // Export histograms
    for (const [name, metric] of this.histograms) {
      output += `# HELP ${this.namespace}_${name} ${metric.help}\n`;
      output += `# TYPE ${this.namespace}_${name} histogram\n`;
      
      for (const [key, buckets] of metric.buckets) {
        const labels = this._parseLabelsFromKey(key);
        
        // Bucket counts
        for (const [bucket, count] of buckets) {
          const bucketLabels = { ...labels, le: bucket };
          const labelStr = this._formatLabels(bucketLabels);
          output += `${this.namespace}_${name}_bucket${labelStr} ${count}\n`;
        }
        
        // Sum and count
        const labelStr = this._formatLabels(labels);
        output += `${this.namespace}_${name}_sum${labelStr} ${metric.sums.get(key) || 0}\n`;
        output += `${this.namespace}_${name}_count${labelStr} ${metric.counts.get(key) || 0}\n`;
      }
      output += '\n';
    }
    
    // Export summaries
    for (const [name, metric] of this.summaries) {
      output += `# HELP ${this.namespace}_${name} ${metric.help}\n`;
      output += `# TYPE ${this.namespace}_${name} summary\n`;
      
      for (const [key, observations] of metric.observations) {
        const labels = this._parseLabelsFromKey(key);
        const sortedObs = [...observations].sort((a, b) => a - b);
        
        // Quantiles
        metric.quantiles.forEach(quantile => {
          const index = Math.floor(sortedObs.length * quantile);
          const value = sortedObs[index] || 0;
          const quantileLabels = { ...labels, quantile: quantile.toString() };
          const labelStr = this._formatLabels(quantileLabels);
          output += `${this.namespace}_${name}${labelStr} ${value}\n`;
        });
        
        // Sum and count
        const labelStr = this._formatLabels(labels);
        output += `${this.namespace}_${name}_sum${labelStr} ${metric.sums.get(key) || 0}\n`;
        output += `${this.namespace}_${name}_count${labelStr} ${metric.counts.get(key) || 0}\n`;
      }
      output += '\n';
    }
    
    return output;
  }
  
  // Collect system metrics
  _collectSystemMetrics() {
    // Memory usage
    const memUsage = process.memoryUsage();
    this.setGauge('memory_usage_bytes', 'Memory usage in bytes', ['rss'], memUsage.rss);
    this.setGauge('memory_usage_bytes', 'Memory usage in bytes', ['heapTotal'], memUsage.heapTotal);
    this.setGauge('memory_usage_bytes', 'Memory usage in bytes', ['heapUsed'], memUsage.heapUsed);
    this.setGauge('memory_usage_bytes', 'Memory usage in bytes', ['external'], memUsage.external);
    
    // CPU usage (approximation)
    const cpuUsage = process.cpuUsage();
    this.setGauge('cpu_usage_percent', 'CPU usage percentage', [], (cpuUsage.user + cpuUsage.system) / 1000000);
    
    // Uptime
    this.setGauge('uptime_seconds', 'Application uptime in seconds', [], process.uptime());
    
    // Event loop lag (if available)
    if (process.hrtime) {
      const start = process.hrtime();
      setImmediate(() => {
        const lag = process.hrtime(start);
        const lagMs = lag[0] * 1000 + lag[1] * 1e-6;
        this.observeHistogram('event_loop_lag_seconds', 'Event loop lag in seconds', [], lagMs / 1000);
      });
    }
  }
  
  // Helper methods
  _getMetricKey(name, labelValues = []) {
    if (labelValues.length === 0) return 'default';
    return labelValues.join('|');
  }
  
  _parseLabelsFromKey(key) {
    if (key === 'default') return {};
    // Simple parsing - in production, use proper label parsing
    return { key };
  }
  
  _formatLabels(labels) {
    const entries = Object.entries(labels);
    if (entries.length === 0) return '';
    
    const formatted = entries.map(([key, value]) => `${key}="${value}"`).join(',');
    return `{${formatted}}`;
  }
  
  _serializeCounters() {
    const result = {};
    for (const [name, metric] of this.counters) {
      result[name] = {
        help: metric.help,
        type: metric.type,
        values: Object.fromEntries(metric.values)
      };
    }
    return result;
  }
  
  _serializeGauges() {
    const result = {};
    for (const [name, metric] of this.gauges) {
      result[name] = {
        help: metric.help,
        type: metric.type,
        values: Object.fromEntries(metric.values)
      };
    }
    return result;
  }
  
  _serializeHistograms() {
    const result = {};
    for (const [name, metric] of this.histograms) {
      result[name] = {
        help: metric.help,
        type: metric.type,
        buckets: {},
        sums: Object.fromEntries(metric.sums),
        counts: Object.fromEntries(metric.counts)
      };
      
      for (const [key, buckets] of metric.buckets) {
        result[name].buckets[key] = Object.fromEntries(buckets);
      }
    }
    return result;
  }
  
  _serializeSummaries() {
    const result = {};
    for (const [name, metric] of this.summaries) {
      result[name] = {
        help: metric.help,
        type: metric.type,
        quantiles: metric.quantiles,
        sums: Object.fromEntries(metric.sums),
        counts: Object.fromEntries(metric.counts)
      };
    }
    return result;
  }
  
  // Method to record API request
  recordAPIRequest(method, endpoint, statusCode, duration) {
    this.incrementCounter('http_requests_total', '', [method, endpoint, statusCode.toString()]);
    this.observeHistogram('http_request_duration_seconds', '', [method, endpoint], duration / 1000);
  }
  
  // Method to record event processing
  recordEventProcessing(tenantId, eventType, serviceId, processingTime) {
    this.incrementCounter('events_total', '', [tenantId, eventType, serviceId]);
    this.observeHistogram('event_processing_duration_seconds', 'Event processing duration', [tenantId, eventType], processingTime / 1000);
  }
  
  // Method to record causality detection
  recordCausalityDetection(tenantId, causalityType, confidence) {
    this.incrementCounter('causality_detections_total', '', [tenantId, causalityType]);
    this.observeHistogram('causality_confidence', 'Causality detection confidence', [tenantId, causalityType], confidence);
  }
  
  // Method to record query execution
  recordQueryExecution(tenantId, queryType, duration, resultCount) {
    this.incrementCounter('queries_total', '', [tenantId, queryType]);
    this.observeHistogram('query_duration_seconds', '', [tenantId, queryType], duration / 1000);
    this.observeHistogram('query_result_count', 'Query result count', [tenantId, queryType], resultCount);
  }
  
  // Cleanup
  shutdown() {
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
    }
    this.removeAllListeners();
  }
}

export default MetricsCollector;