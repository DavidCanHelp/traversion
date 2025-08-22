/**
 * Temporal Query Engine
 * 
 * Enables time-travel queries through production system states.
 * This is the core engine that powers Traversion's ability to query
 * any point in time and understand system state at that moment.
 */

import EventEmitter from 'events';

class TemporalQueryEngine extends EventEmitter {
  constructor(causalityEngine) {
    super();
    this.causalityEngine = causalityEngine;
    
    // Query cache for performance
    this.queryCache = new Map();
    this.cacheTimeout = 60000; // 1 minute
    
    // Query statistics
    this.stats = {
      queriesExecuted: 0,
      cacheHits: 0,
      cacheMisses: 0,
      averageQueryTime: 0
    };
  }

  /**
   * Execute a TimeQL query
   * TimeQL is Traversion's temporal query language
   */
  async query(timeql) {
    const startTime = Date.now();
    this.stats.queriesExecuted++;
    
    // Parse TimeQL
    const parsedQuery = this.parseTimeQL(timeql);
    
    // Check cache
    const cacheKey = JSON.stringify(parsedQuery);
    if (this.queryCache.has(cacheKey)) {
      const cached = this.queryCache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTimeout) {
        this.stats.cacheHits++;
        return cached.result;
      }
    }
    
    this.stats.cacheMisses++;
    
    // Execute query based on type
    let result;
    switch (parsedQuery.type) {
      case 'STATE_AT':
        result = await this.queryStateAt(parsedQuery);
        break;
      case 'TRAVERSE':
        result = await this.queryTraverse(parsedQuery);
        break;
      case 'PATTERN':
        result = await this.queryPattern(parsedQuery);
        break;
      case 'TIMELINE':
        result = await this.queryTimeline(parsedQuery);
        break;
      case 'COMPARE':
        result = await this.queryCompare(parsedQuery);
        break;
      case 'PREDICT':
        result = await this.queryPredict(parsedQuery);
        break;
      default:
        throw new Error(`Unknown query type: ${parsedQuery.type}`);
    }
    
    // Cache result
    this.queryCache.set(cacheKey, {
      result,
      timestamp: Date.now()
    });
    
    // Update stats
    const queryTime = Date.now() - startTime;
    this.stats.averageQueryTime = 
      (this.stats.averageQueryTime * (this.stats.queriesExecuted - 1) + queryTime) / 
      this.stats.queriesExecuted;
    
    this.emit('query:executed', {
      query: timeql,
      duration: queryTime,
      resultCount: Array.isArray(result) ? result.length : 1
    });
    
    return result;
  }

  /**
   * Parse TimeQL query string
   */
  parseTimeQL(query) {
    // Remove extra whitespace and normalize
    const normalized = query.trim().replace(/\s+/g, ' ');
    
    // STATE AT query - get system state at specific time
    if (normalized.match(/^STATE AT/i)) {
      const match = normalized.match(/STATE AT '([^']+)'(?:\s+WHERE\s+(.+))?/i);
      if (match) {
        return {
          type: 'STATE_AT',
          timestamp: this.parseTimestamp(match[1]),
          conditions: match[2] ? this.parseConditions(match[2]) : null
        };
      }
    }
    
    // TRAVERSE query - follow causality chains
    if (normalized.match(/^TRAVERSE FROM/i)) {
      const match = normalized.match(/TRAVERSE FROM (\S+)\s+FOLLOWING (\S+)(?:\s+UNTIL\s+(.+))?/i);
      if (match) {
        return {
          type: 'TRAVERSE',
          startEvent: match[1],
          direction: match[2],
          untilCondition: match[3] ? this.parseConditions(match[3]) : null
        };
      }
    }
    
    // PATTERN query - find matching patterns
    if (normalized.match(/^MATCH PATTERN/i)) {
      const match = normalized.match(/MATCH PATTERN\s+WHERE\s+(.+?)\s+(?:FOLLOWED BY\s+(.+?)\s+)?WITHIN\s+(\d+)\s+(\w+)(?:\s+IN LAST\s+(.+))?/i);
      if (match) {
        return {
          type: 'PATTERN',
          firstCondition: this.parseConditions(match[1]),
          secondCondition: match[2] ? this.parseConditions(match[2]) : null,
          withinValue: parseInt(match[3]),
          withinUnit: match[4],
          timeRange: match[5] ? this.parseTimeRange(match[5]) : null
        };
      }
    }
    
    // TIMELINE query - get events in time range
    if (normalized.match(/^TIMELINE/i)) {
      const match = normalized.match(/TIMELINE\s+FROM\s+'([^']+)'\s+TO\s+'([^']+)'(?:\s+WHERE\s+(.+))?/i);
      if (match) {
        return {
          type: 'TIMELINE',
          startTime: this.parseTimestamp(match[1]),
          endTime: this.parseTimestamp(match[2]),
          conditions: match[3] ? this.parseConditions(match[3]) : null
        };
      }
    }
    
    // COMPARE query - compare two time points
    if (normalized.match(/^COMPARE/i)) {
      const match = normalized.match(/COMPARE\s+'([^']+)'\s+WITH\s+'([^']+)'(?:\s+FOR\s+(.+))?/i);
      if (match) {
        return {
          type: 'COMPARE',
          time1: this.parseTimestamp(match[1]),
          time2: this.parseTimestamp(match[2]),
          metrics: match[3] ? match[3].split(',').map(m => m.trim()) : null
        };
      }
    }
    
    // PREDICT query - predict future events
    if (normalized.match(/^PREDICT/i)) {
      const match = normalized.match(/PREDICT\s+NEXT\s+(\d+)\s+(\w+)(?:\s+FROM\s+'([^']+)')?/i);
      if (match) {
        return {
          type: 'PREDICT',
          count: parseInt(match[1]),
          unit: match[2],
          fromTime: match[3] ? this.parseTimestamp(match[3]) : Date.now()
        };
      }
    }
    
    throw new Error(`Invalid TimeQL query: ${query}`);
  }

  /**
   * Query system state at specific time
   */
  async queryStateAt(parsed) {
    const { timestamp, conditions } = parsed;
    
    // Get all events up to this timestamp
    const events = Array.from(this.causalityEngine.causalityGraph.values())
      .filter(event => event.timestamp <= timestamp);
    
    // Build state representation
    const state = {
      timestamp,
      time: new Date(timestamp).toISOString(),
      services: new Map(),
      metrics: {},
      errors: [],
      activeRequests: [],
      summary: {}
    };
    
    // Group events by service
    for (const event of events) {
      if (!state.services.has(event.serviceId)) {
        state.services.set(event.serviceId, {
          id: event.serviceId,
          name: event.serviceName || event.serviceId,
          events: [],
          lastEvent: null,
          status: 'unknown',
          metrics: {}
        });
      }
      
      const service = state.services.get(event.serviceId);
      service.events.push(event);
      service.lastEvent = event;
      
      // Track errors
      if (event.eventType === 'error' || event.data?.error) {
        state.errors.push({
          service: event.serviceId,
          time: event.timestamp,
          message: event.data?.message || event.data?.error,
          event: event.eventId
        });
        service.status = 'error';
      }
      
      // Track active requests (started but not ended)
      if (event.eventType === 'span:start' || event.eventType === 'http:request') {
        state.activeRequests.push({
          id: event.spanId || event.eventId,
          service: event.serviceId,
          startTime: event.timestamp,
          type: event.eventType
        });
      }
      
      if (event.eventType === 'span:end' || event.eventType === 'http:response') {
        const index = state.activeRequests.findIndex(
          req => req.id === event.spanId || req.id === event.eventId
        );
        if (index !== -1) {
          state.activeRequests.splice(index, 1);
        }
      }
      
      // Update metrics
      if (event.eventType === 'system:metrics' && event.data) {
        state.metrics = { ...state.metrics, ...event.data };
        service.metrics = { ...service.metrics, ...event.data };
      }
    }
    
    // Calculate summary
    state.summary = {
      totalEvents: events.length,
      totalServices: state.services.size,
      errorCount: state.errors.length,
      activeRequestCount: state.activeRequests.length,
      health: this.calculateHealth(state)
    };
    
    // Apply conditions if specified
    if (conditions) {
      return this.applyConditions(state, conditions);
    }
    
    return state;
  }

  /**
   * Traverse causality chains
   */
  async queryTraverse(parsed) {
    const { startEvent, direction, untilCondition } = parsed;
    
    // Use causality engine to trace chain
    const chain = this.causalityEngine.traceCausalityChain(startEvent, {
      direction: direction.toLowerCase(),
      maxDepth: 100
    });
    
    // Apply until condition if specified
    if (untilCondition) {
      const filtered = [];
      for (const event of chain.events) {
        filtered.push(event);
        if (this.matchesCondition(event, untilCondition)) {
          break;
        }
      }
      chain.events = filtered;
    }
    
    return chain;
  }

  /**
   * Find matching patterns
   */
  async queryPattern(parsed) {
    const { firstCondition, secondCondition, withinValue, withinUnit, timeRange } = parsed;
    
    // Convert within to milliseconds
    const withinMs = this.convertToMs(withinValue, withinUnit);
    
    // Determine time range to search
    let startTime, endTime;
    if (timeRange) {
      const range = this.parseTimeRange(timeRange);
      startTime = range.start;
      endTime = range.end;
    } else {
      endTime = Date.now();
      startTime = endTime - 86400000; // Default to last 24 hours
    }
    
    // Find events matching first condition
    const firstMatches = Array.from(this.causalityEngine.causalityGraph.values())
      .filter(event => 
        event.timestamp >= startTime && 
        event.timestamp <= endTime &&
        this.matchesCondition(event, firstCondition)
      );
    
    const patterns = [];
    
    // For each first match, look for second match within window
    for (const first of firstMatches) {
      if (secondCondition) {
        const windowEnd = first.timestamp + withinMs;
        const secondMatches = Array.from(this.causalityEngine.causalityGraph.values())
          .filter(event =>
            event.timestamp > first.timestamp &&
            event.timestamp <= windowEnd &&
            this.matchesCondition(event, secondCondition)
          );
        
        for (const second of secondMatches) {
          patterns.push({
            pattern: [first.eventId, second.eventId],
            events: [first, second],
            duration: second.timestamp - first.timestamp,
            timestamp: first.timestamp
          });
        }
      } else {
        patterns.push({
          pattern: [first.eventId],
          events: [first],
          duration: 0,
          timestamp: first.timestamp
        });
      }
    }
    
    return patterns;
  }

  /**
   * Get timeline of events
   */
  async queryTimeline(parsed) {
    const { startTime, endTime, conditions } = parsed;
    
    // Get events in time range
    let events = Array.from(this.causalityEngine.causalityGraph.values())
      .filter(event => 
        event.timestamp >= startTime && 
        event.timestamp <= endTime
      );
    
    // Apply conditions if specified
    if (conditions) {
      events = events.filter(event => this.matchesCondition(event, conditions));
    }
    
    // Sort by timestamp
    events.sort((a, b) => a.timestamp - b.timestamp);
    
    // Build timeline with additional context
    const timeline = {
      startTime,
      endTime,
      duration: endTime - startTime,
      events: events.map(event => ({
        ...event,
        relativeTime: event.timestamp - startTime,
        timePercent: ((event.timestamp - startTime) / (endTime - startTime)) * 100
      })),
      summary: {
        totalEvents: events.length,
        eventsPerSecond: events.length / ((endTime - startTime) / 1000),
        services: [...new Set(events.map(e => e.serviceId))],
        eventTypes: [...new Set(events.map(e => e.eventType))]
      }
    };
    
    return timeline;
  }

  /**
   * Compare two time points
   */
  async queryCompare(parsed) {
    const { time1, time2, metrics } = parsed;
    
    // Get states at both times
    const state1 = await this.queryStateAt({ timestamp: time1 });
    const state2 = await this.queryStateAt({ timestamp: time2 });
    
    const comparison = {
      time1: {
        timestamp: time1,
        iso: new Date(time1).toISOString(),
        state: state1
      },
      time2: {
        timestamp: time2,
        iso: new Date(time2).toISOString(),
        state: state2
      },
      changes: {
        services: {
          added: [],
          removed: [],
          modified: []
        },
        metrics: {},
        errors: {
          added: [],
          resolved: []
        }
      },
      delta: {
        duration: time2 - time1,
        eventCount: state2.summary.totalEvents - state1.summary.totalEvents,
        errorCount: state2.summary.errorCount - state1.summary.errorCount,
        serviceCount: state2.summary.totalServices - state1.summary.totalServices
      }
    };
    
    // Compare services
    const services1 = new Set(state1.services.keys());
    const services2 = new Set(state2.services.keys());
    
    comparison.changes.services.added = [...services2].filter(s => !services1.has(s));
    comparison.changes.services.removed = [...services1].filter(s => !services2.has(s));
    
    // Find modified services
    for (const serviceId of services1) {
      if (services2.has(serviceId)) {
        const s1 = state1.services.get(serviceId);
        const s2 = state2.services.get(serviceId);
        if (s1.status !== s2.status) {
          comparison.changes.services.modified.push({
            id: serviceId,
            oldStatus: s1.status,
            newStatus: s2.status
          });
        }
      }
    }
    
    // Compare metrics if specified
    if (metrics) {
      for (const metric of metrics) {
        const value1 = this.getMetricValue(state1, metric);
        const value2 = this.getMetricValue(state2, metric);
        comparison.changes.metrics[metric] = {
          before: value1,
          after: value2,
          change: value2 - value1,
          changePercent: value1 !== 0 ? ((value2 - value1) / value1) * 100 : null
        };
      }
    }
    
    // Compare errors
    const errors1 = new Set(state1.errors.map(e => e.message));
    const errors2 = new Set(state2.errors.map(e => e.message));
    
    comparison.changes.errors.added = state2.errors.filter(e => !errors1.has(e.message));
    comparison.changes.errors.resolved = state1.errors.filter(e => !errors2.has(e.message));
    
    return comparison;
  }

  /**
   * Predict future events
   */
  async queryPredict(parsed) {
    const { count, unit, fromTime } = parsed;
    
    // Convert prediction horizon to milliseconds
    const horizonMs = this.convertToMs(count, unit);
    
    // Find the most recent event before fromTime
    const events = Array.from(this.causalityEngine.causalityGraph.values())
      .filter(e => e.timestamp <= fromTime)
      .sort((a, b) => b.timestamp - a.timestamp);
    
    if (events.length === 0) {
      return { predictions: [], confidence: 0, message: 'No historical data available' };
    }
    
    const lastEvent = events[0];
    
    // Use causality engine to predict
    const predictions = this.causalityEngine.predictNextEvents(lastEvent.eventId, {
      horizon: horizonMs,
      minConfidence: 0.3
    });
    
    // Format predictions
    const formattedPredictions = predictions.slice(0, 10).map(pred => ({
      ...pred,
      predictedTime: new Date(pred.timestamp).toISOString(),
      timeFromNow: pred.timestamp - fromTime,
      likelihood: this.confidenceToLikelihood(pred.confidence)
    }));
    
    return {
      predictions: formattedPredictions,
      fromTime: new Date(fromTime).toISOString(),
      horizon: `${count} ${unit}`,
      basedOn: {
        eventId: lastEvent.eventId,
        eventType: lastEvent.eventType,
        timestamp: lastEvent.timestamp
      },
      confidence: formattedPredictions.length > 0 
        ? formattedPredictions.reduce((sum, p) => sum + p.confidence, 0) / formattedPredictions.length 
        : 0
    };
  }

  /**
   * Helper methods
   */
  
  parseTimestamp(str) {
    // Handle relative times
    if (str.toLowerCase() === 'now') return Date.now();
    if (str.match(/^\d+$/)) return parseInt(str);
    
    // Handle ISO strings
    const date = new Date(str);
    if (!isNaN(date.getTime())) return date.getTime();
    
    // Handle relative expressions like "5 minutes ago"
    const match = str.match(/^(\d+)\s+(\w+)\s+ago$/i);
    if (match) {
      const value = parseInt(match[1]);
      const unit = match[2].toLowerCase();
      return Date.now() - this.convertToMs(value, unit);
    }
    
    throw new Error(`Invalid timestamp: ${str}`);
  }
  
  parseConditions(str) {
    const conditions = {};
    
    // Parse simple conditions like "service = 'api' AND status = 'error'"
    const parts = str.split(/\s+AND\s+/i);
    
    for (const part of parts) {
      const match = part.match(/(\w+)\s*([=<>]+)\s*['"]?([^'"]+)['"]?/);
      if (match) {
        const [, field, operator, value] = match;
        conditions[field] = { operator, value };
      }
    }
    
    return conditions;
  }
  
  parseTimeRange(str) {
    const match = str.match(/(\d+)\s+(\w+)/);
    if (match) {
      const value = parseInt(match[1]);
      const unit = match[2].toLowerCase();
      const ms = this.convertToMs(value, unit);
      return {
        end: Date.now(),
        start: Date.now() - ms
      };
    }
    throw new Error(`Invalid time range: ${str}`);
  }
  
  convertToMs(value, unit) {
    const units = {
      millisecond: 1,
      milliseconds: 1,
      ms: 1,
      second: 1000,
      seconds: 1000,
      s: 1000,
      minute: 60000,
      minutes: 60000,
      m: 60000,
      hour: 3600000,
      hours: 3600000,
      h: 3600000,
      day: 86400000,
      days: 86400000,
      d: 86400000
    };
    
    const multiplier = units[unit.toLowerCase()];
    if (!multiplier) throw new Error(`Unknown time unit: ${unit}`);
    
    return value * multiplier;
  }
  
  matchesCondition(event, conditions) {
    if (!conditions) return true;
    
    for (const [field, condition] of Object.entries(conditions)) {
      const eventValue = this.getFieldValue(event, field);
      const { operator, value } = condition;
      
      switch (operator) {
        case '=':
        case '==':
          if (eventValue != value) return false;
          break;
        case '>':
          if (!(eventValue > value)) return false;
          break;
        case '<':
          if (!(eventValue < value)) return false;
          break;
        case '>=':
          if (!(eventValue >= value)) return false;
          break;
        case '<=':
          if (!(eventValue <= value)) return false;
          break;
        case '!=':
          if (eventValue == value) return false;
          break;
      }
    }
    
    return true;
  }
  
  getFieldValue(event, field) {
    // Handle nested fields with dot notation
    const parts = field.split('.');
    let value = event;
    
    for (const part of parts) {
      value = value[part];
      if (value === undefined) return null;
    }
    
    return value;
  }
  
  applyConditions(state, conditions) {
    // Filter state based on conditions
    const filtered = { ...state };
    
    if (conditions.service) {
      const serviceCondition = conditions.service.value;
      filtered.services = new Map(
        [...state.services].filter(([id]) => id === serviceCondition)
      );
    }
    
    return filtered;
  }
  
  calculateHealth(state) {
    if (state.errors.length === 0 && state.activeRequests.length < 100) {
      return 'healthy';
    }
    if (state.errors.length < 5 && state.activeRequests.length < 200) {
      return 'degraded';
    }
    return 'critical';
  }
  
  getMetricValue(state, metricPath) {
    const parts = metricPath.split('.');
    let value = state.metrics;
    
    for (const part of parts) {
      value = value[part];
      if (value === undefined) return 0;
    }
    
    return value;
  }
  
  confidenceToLikelihood(confidence) {
    if (confidence > 0.8) return 'very likely';
    if (confidence > 0.6) return 'likely';
    if (confidence > 0.4) return 'possible';
    if (confidence > 0.2) return 'unlikely';
    return 'very unlikely';
  }

  /**
   * Get query statistics
   */
  getStats() {
    return {
      ...this.stats,
      cacheSize: this.queryCache.size,
      cacheHitRate: this.stats.cacheHits / (this.stats.cacheHits + this.stats.cacheMisses) || 0
    };
  }

  /**
   * Clear query cache
   */
  clearCache() {
    this.queryCache.clear();
    this.emit('cache:cleared');
  }
}

export default TemporalQueryEngine;