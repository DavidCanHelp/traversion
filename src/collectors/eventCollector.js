/**
 * Production Event Collector
 * 
 * Collects events from various sources in a production environment:
 * - HTTP requests/responses
 * - Database queries
 * - System metrics
 * - Application logs
 * - Custom events
 */

import EventEmitter from 'events';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';

class EventCollector extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      serviceId: options.serviceId || 'unknown-service',
      serviceName: options.serviceName || process.env.SERVICE_NAME || 'app',
      environment: options.environment || process.env.NODE_ENV || 'development',
      hostname: os.hostname(),
      batchSize: options.batchSize || 100,
      flushInterval: options.flushInterval || 1000, // ms
      enableSystemMetrics: options.enableSystemMetrics !== false,
      enableHttpCapture: options.enableHttpCapture !== false,
      enableDatabaseCapture: options.enableDatabaseCapture !== false,
      samplingRate: options.samplingRate || 1.0, // 1.0 = 100% sampling
      ...options
    };
    
    this.buffer = [];
    this.metrics = {
      eventsCollected: 0,
      eventsSent: 0,
      eventsDropped: 0,
      bytesCollected: 0
    };
    
    this.activeSpans = new Map();
    this.traceContext = new Map();
    
    // Start flush timer
    this.flushTimer = setInterval(() => this.flush(), this.config.flushInterval);
    
    // Start system metrics collection if enabled
    if (this.config.enableSystemMetrics) {
      this.startSystemMetricsCollection();
    }
  }

  /**
   * Create and track a new event
   */
  trackEvent(eventType, data = {}, metadata = {}) {
    // Apply sampling
    if (Math.random() > this.config.samplingRate) {
      this.metrics.eventsDropped++;
      return null;
    }
    
    const event = {
      eventId: uuidv4(),
      timestamp: Date.now(),
      serviceId: this.config.serviceId,
      serviceName: this.config.serviceName,
      hostname: this.config.hostname,
      environment: this.config.environment,
      eventType,
      data: this._sanitizeData(data),
      metadata: {
        ...metadata,
        pid: process.pid,
        nodeVersion: process.version
      }
    };
    
    // Add trace context if available
    const traceContext = this._getCurrentTraceContext();
    if (traceContext) {
      event.traceId = traceContext.traceId;
      event.spanId = traceContext.spanId;
      event.parentSpanId = traceContext.parentSpanId;
    }
    
    // Add to buffer
    this.buffer.push(event);
    this.metrics.eventsCollected++;
    this.metrics.bytesCollected += JSON.stringify(event).length;
    
    // Emit for local processing
    this.emit('event:collected', event);
    
    // Flush if buffer is full
    if (this.buffer.length >= this.config.batchSize) {
      this.flush();
    }
    
    return event.eventId;
  }

  /**
   * Start a new span for distributed tracing
   */
  startSpan(name, parentSpan = null) {
    const span = {
      spanId: uuidv4(),
      traceId: parentSpan?.traceId || uuidv4(),
      parentSpanId: parentSpan?.spanId || null,
      name,
      startTime: Date.now(),
      events: [],
      tags: {},
      status: 'active'
    };
    
    this.activeSpans.set(span.spanId, span);
    
    // Track span start event
    this.trackEvent('span:start', {
      spanName: name,
      spanId: span.spanId,
      traceId: span.traceId
    });
    
    return span;
  }

  /**
   * End a span
   */
  endSpan(spanId, status = 'success', data = {}) {
    const span = this.activeSpans.get(spanId);
    if (!span) return null;
    
    span.endTime = Date.now();
    span.duration = span.endTime - span.startTime;
    span.status = status;
    
    // Track span end event
    this.trackEvent('span:end', {
      spanName: span.name,
      spanId: span.spanId,
      traceId: span.traceId,
      duration: span.duration,
      status,
      ...data
    });
    
    this.activeSpans.delete(spanId);
    return span;
  }

  /**
   * Capture HTTP request/response
   */
  captureHttp(req, res, next) {
    if (!this.config.enableHttpCapture) {
      return next ? next() : undefined;
    }
    
    const span = this.startSpan(`HTTP ${req.method} ${req.path}`);
    const startTime = Date.now();
    
    // Capture request
    this.trackEvent('http:request', {
      method: req.method,
      path: req.path,
      headers: this._sanitizeHeaders(req.headers),
      query: req.query,
      ip: req.ip,
      userAgent: req.get('user-agent')
    }, {
      spanId: span.spanId,
      traceId: span.traceId
    });
    
    // Intercept response
    const originalSend = res.send;
    res.send = (body) => {
      const duration = Date.now() - startTime;
      
      // Capture response
      this.trackEvent('http:response', {
        statusCode: res.statusCode,
        duration,
        contentType: res.get('content-type'),
        bodySize: body ? body.length : 0
      }, {
        spanId: span.spanId,
        traceId: span.traceId
      });
      
      this.endSpan(span.spanId, res.statusCode < 400 ? 'success' : 'error', {
        statusCode: res.statusCode,
        duration
      });
      
      return originalSend.call(res, body);
    };
    
    if (next) next();
  }

  /**
   * Capture database query
   */
  captureQuery(query, params = [], result = null, error = null) {
    if (!this.config.enableDatabaseCapture) return;
    
    const eventData = {
      query: this._sanitizeQuery(query),
      paramCount: params.length,
      hasResult: !!result,
      hasError: !!error
    };
    
    if (result) {
      eventData.rowCount = Array.isArray(result) ? result.length : 1;
      eventData.executionTime = result.executionTime || null;
    }
    
    if (error) {
      eventData.error = {
        message: error.message,
        code: error.code
      };
    }
    
    this.trackEvent('database:query', eventData);
  }

  /**
   * Capture custom application event
   */
  captureCustom(name, data = {}, level = 'info') {
    this.trackEvent(`custom:${name}`, {
      ...data,
      level
    });
  }

  /**
   * Capture error event
   */
  captureError(error, context = {}) {
    const errorData = {
      message: error.message,
      stack: error.stack,
      name: error.name,
      code: error.code,
      ...context
    };
    
    this.trackEvent('error', errorData, {
      severity: 'error'
    });
  }

  /**
   * Start collecting system metrics
   */
  startSystemMetricsCollection() {
    this.metricsInterval = setInterval(() => {
      const metrics = this.collectSystemMetrics();
      this.trackEvent('system:metrics', metrics);
    }, 10000); // Every 10 seconds
  }

  /**
   * Collect current system metrics
   */
  collectSystemMetrics() {
    const cpus = os.cpus();
    const loadAvg = os.loadavg();
    
    return {
      cpu: {
        count: cpus.length,
        usage: this._calculateCpuUsage(cpus),
        loadAverage: {
          '1m': loadAvg[0],
          '5m': loadAvg[1],
          '15m': loadAvg[2]
        }
      },
      memory: {
        total: os.totalmem(),
        free: os.freemem(),
        used: os.totalmem() - os.freemem(),
        usagePercent: ((os.totalmem() - os.freemem()) / os.totalmem()) * 100
      },
      process: {
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        pid: process.pid,
        version: process.version
      },
      network: os.networkInterfaces()
    };
  }

  /**
   * Express middleware
   */
  expressMiddleware() {
    return (req, res, next) => {
      this.captureHttp(req, res, next);
    };
  }

  /**
   * Koa middleware
   */
  koaMiddleware() {
    return async (ctx, next) => {
      const span = this.startSpan(`HTTP ${ctx.method} ${ctx.path}`);
      const startTime = Date.now();
      
      try {
        // Capture request
        this.trackEvent('http:request', {
          method: ctx.method,
          path: ctx.path,
          headers: this._sanitizeHeaders(ctx.headers),
          query: ctx.query,
          ip: ctx.ip
        }, {
          spanId: span.spanId,
          traceId: span.traceId
        });
        
        await next();
        
        // Capture response
        const duration = Date.now() - startTime;
        this.trackEvent('http:response', {
          statusCode: ctx.status,
          duration,
          contentType: ctx.type
        }, {
          spanId: span.spanId,
          traceId: span.traceId
        });
        
        this.endSpan(span.spanId, ctx.status < 400 ? 'success' : 'error', {
          statusCode: ctx.status,
          duration
        });
      } catch (error) {
        const duration = Date.now() - startTime;
        
        this.captureError(error, {
          spanId: span.spanId,
          traceId: span.traceId,
          path: ctx.path,
          method: ctx.method
        });
        
        this.endSpan(span.spanId, 'error', {
          error: error.message,
          duration
        });
        
        throw error;
      }
    };
  }

  /**
   * Flush buffered events
   */
  async flush() {
    if (this.buffer.length === 0) return;
    
    const events = [...this.buffer];
    this.buffer = [];
    
    try {
      // In production, this would send to Traversion ingestion endpoint
      await this._sendEvents(events);
      this.metrics.eventsSent += events.length;
      
      this.emit('events:flushed', {
        count: events.length,
        bytes: JSON.stringify(events).length
      });
    } catch (error) {
      // Re-add to buffer on failure
      this.buffer.unshift(...events);
      
      this.emit('flush:error', error);
    }
  }

  /**
   * Send events to Traversion backend
   */
  async _sendEvents(events) {
    // In production, this would make an HTTP request to the ingestion endpoint
    // For now, just emit them locally
    this.emit('events:batch', events);
    
    // Simulated network call
    return new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }

  /**
   * Helper methods
   */
  
  _sanitizeData(data) {
    // Remove sensitive information
    const sanitized = { ...data };
    const sensitiveKeys = ['password', 'token', 'secret', 'key', 'auth'];
    
    for (const key of Object.keys(sanitized)) {
      if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
        sanitized[key] = '[REDACTED]';
      }
    }
    
    return sanitized;
  }
  
  _sanitizeHeaders(headers) {
    const sanitized = { ...headers };
    const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key'];
    
    for (const header of sensitiveHeaders) {
      if (sanitized[header]) {
        sanitized[header] = '[REDACTED]';
      }
    }
    
    return sanitized;
  }
  
  _sanitizeQuery(query) {
    // Remove potential PII from queries
    return query.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]')
                .replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[PHONE]')
                .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN]');
  }
  
  _getCurrentTraceContext() {
    // In a real implementation, this would get trace context from async hooks
    // or from a context propagation library
    return null;
  }
  
  _calculateCpuUsage(cpus) {
    let totalIdle = 0;
    let totalTick = 0;
    
    for (const cpu of cpus) {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    }
    
    return 100 - ~~(100 * totalIdle / totalTick);
  }

  /**
   * Shutdown collector
   */
  async shutdown() {
    clearInterval(this.flushTimer);
    clearInterval(this.metricsInterval);
    
    // Final flush
    await this.flush();
    
    this.emit('shutdown');
  }

  /**
   * Get collector statistics
   */
  getStats() {
    return {
      ...this.metrics,
      bufferSize: this.buffer.length,
      activeSpans: this.activeSpans.size,
      config: this.config
    };
  }
}

export default EventCollector;